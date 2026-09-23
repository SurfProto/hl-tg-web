-- Stop a season's fill checkpoints granting XP after that season has ended.
--
-- Checkpoints are keyed (user, season, wallet), and 009's header explains why:
-- "a season boundary starts a fresh window ... neither may inherit the other's
-- cursor". That was right, and it covered only half of the boundary. It says
-- the new season's checkpoint must not inherit the old cursor; it never says
-- the old checkpoint must stop. Nothing did. rewards_claim_fill_sync_batch
-- selected due checkpoints with no reference to their season at all, and the
-- worker clamped each window only to `now` -- so on 2026-09-01 every August
-- checkpoint kept reading [cursor, now] straight into September, beside the
-- September checkpoint the backfill had just created for the same wallet.
--
-- Both wrote the same fills. The grant key embeds the season --
-- volume_xp:{season}:{user}:{fill} -- and reward_ledger is unique on the key
-- alone, so the two keys never collided and both rows inserted. Quests went
-- the same way: the old claim evaluated September's deposits and fills and
-- keyed the result under August. The current season's rank, volume and XP
-- headline stayed correct, because the duplicates carry the *old* season's id
-- and every season-scoped read filters on it. What broke is everything that
-- is not season-scoped -- rewards_lifetime_xp and the reward history, which
-- is what users see -- and every ledger read of the closed season itself.
-- Its projection (user_points, weekly_rewards) was mostly spared, only
-- because nothing rebuilds a season's projection once it has ended.
--
-- One knock-on the ledger does not show: referral rungs sum builder fees over
-- every posted volume row in every season, so the duplicates doubled each
-- referee's fee total against the 'traded' and 'retained' thresholds.
--
-- It compounds: October would have added a third live checkpoint per wallet.
-- And the fixed batch of 25 per ten-minute run was being spent on checkpoints
-- that had no work left in their own season, so real sync cadence halved.
--
-- Nothing surfaced it. rewards_reconciliation_report scopes checkpoints to one
-- season, and its drift compares a projection against a rebuild from the same
-- ledger, so a duplicate agrees with itself.
--
-- What this migration does:
--
--   1. The claim retires a checkpoint once its cursor reaches its season's
--      end. The worker (api/rewards/_lib/fill-sync.ts) independently clamps
--      every window to the season's last millisecond and, on reaching it,
--      writes the cursor to `ends_at` exactly -- which is the value this
--      predicate treats as done.
--
--      The two layers are NOT interchangeable, and the order matters. The
--      worker's bound alone stops every new duplicate. This predicate alone
--      does not: it retires a checkpoint only once its cursor has reached
--      ends_at, so a worker that predates the fix still reads one window
--      across the next rollover for every checkpoint that straddles it, and
--      double-grants that window before the cursor jumps past and retires
--      it. What this predicate does on its own is stop the checkpoints that
--      are already stranded past their season -- every August checkpoint
--      whose cursor has passed Sep 1 -- from being claimed at all, which ends
--      their duplication and gives the batch its slots back. An August
--      checkpoint that was lagging or failing, cursor still before Sep 1, is
--      still offered, and a pre-fix worker would read one window of
--      September for it. Before applying this ahead of the code, check:
--
--        select count(*) from rewards_fill_checkpoints c
--        join seasons s on s.id = c.season_id
--        where s.ends_at <= now() and c.cursor_time < s.ends_at;
--
--      Zero means this predicate alone stops the bleeding today.
--
--      So the worker code must be live before the next rollover, whichever
--      of the two lands first.
--
--   2. It defines, and does NOT run, a report, a repair, a durable release
--      for any one hold, and a read-only check on referral rungs, for the
--      rows the defect already wrote. See the runbook in section 2.
--
--   3. It narrows the reconciliation report's held-cash count to cash, which
--      the repair would otherwise have inflated with held XP -- tripping the
--      very alarm that column exists to raise.
--
--   4. It adds markers for 027-030 to migrations_report.
--
-- It deletes nothing. The ledger is append-only by design.

-- ---------------------------------------------------------------------------
-- 1. Retire checkpoints whose season has been fully ingested
-- ---------------------------------------------------------------------------

/**
 * Claim a bounded batch of accounts to sync, marking them attempted.
 *
 * Unchanged from 009 except for the season predicate. A checkpoint is due only
 * while it still has fills to read *inside its own season*: once cursor_time
 * reaches the season's ends_at there is nothing left for it to do, and a
 * checkpoint claimed past that point is precisely the one that granted
 * September's trades under August.
 *
 * `< ends_at`, not `<=`. Seasons are half-open -- [starts_at, ends_at) -- so
 * ends_at is the first instant of the next season, and the worker marks a
 * season complete by writing exactly that value.
 *
 * `for update of c`, not `for update`. With the join, a bare `for update`
 * would also lock the seasons row, and under `skip locked` a second worker
 * would then skip every checkpoint in the season rather than the rows the
 * first worker actually holds.
 *
 * Same signature and return shape as 009, so the worker needs no change to
 * call it, and a worker that predates this migration keeps working.
 */
create or replace function rewards_claim_fill_sync_batch(
  p_limit int default 25,
  p_stale_after_seconds int default 900
)
returns table (
  checkpoint_id uuid,
  user_id uuid,
  season_id uuid,
  wallet_address text,
  cursor_time timestamptz,
  fills_ingested bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select c.id
    from rewards_fill_checkpoints c
    join seasons s on s.id = c.season_id
    where c.cursor_time < s.ends_at
      and (
        c.last_attempt_at is null
        or c.last_attempt_at < now() - make_interval(secs => p_stale_after_seconds)
      )
    order by c.last_attempt_at nulls first
    limit greatest(1, least(p_limit, 200))
    for update of c skip locked
  )
  update rewards_fill_checkpoints c
     set last_attempt_at = now(),
         updated_at = now()
    from due
   where c.id = due.id
  returning c.id, c.user_id, c.season_id, c.wallet_address, c.cursor_time, c.fills_ingested;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Report and repair for the rows already written
-- ---------------------------------------------------------------------------
--
-- A cross-season grant is an XP row attributed to a season for activity that
-- happened after that season ended. Which rows those are is defined once, in
-- rewards_cross_season_grant_candidates, and read by both the report and the
-- repair, so the two cannot drift apart.
--
--   volume_xp -- held, precisely. Every volume grant records
--                metadata.occurredAt, the fill's own time, so a row whose fill
--                is at or after its season's ends_at is unambiguous. Rows
--                written before occurredAt existed carry NULL and are left
--                alone, as is any value that does not parse.
--
--   quests    -- it depends on the quest, because the pre-fix worker read a
--                different thing for each:
--
--     first_deposit, second_deposit_7d -- held. Their deposit read started at
--       the *current* season's start, so an old-season row written after
--       rollover can only have come from the next season's deposits.
--
--     first_trade -- held only when nothing suggests it was earned in-season.
--       It was evaluated against the fills of the window being read, and a
--       stale checkpoint's first run after rollover also read that season's
--       unread tail. That tail can be hours long, not minutes -- each account
--       is revisited every ceil(N / 25) ten-minute runs, and the backfill's new
--       checkpoints were served first -- so a genuinely late first trade
--       ingested after midnight is a real case, not a curiosity. If the user
--       has an in-season volume grant that was written after rollover, the
--       quest may be that one's and is left for review instead.
--
--     join_telegram_channel, and anything else -- review, never held.
--       Channel membership has no date: nothing in the ledger can say whether
--       the user was in the channel before the season ended.
--
-- 'review' rows are reported and left posted. Taking earned XP from a real
-- user is the worse error in an XP-only program; a person can decide them.
--
-- The quest arm reads "written after its season ended" as "written by the
-- pre-fix worker", and that holds because the fixed worker never writes a
-- quest once its claim's season has ended (fill-sync.ts, questsAllowed) --
-- including in a run that straddles midnight. So this can be re-run after a
-- future rollover without sweeping up that rollover's legitimate quests.
--
-- Why 'held' rather than a delete or a reversal entry.
--
-- 007 says "'posted' is not touched, here or anywhere", and gives its reason:
-- a posted row that says money left the treasury is the evidence
-- reconciliation runs against. That reason is about cash. A duplicated XP
-- grant evidences no transfer -- only this defect -- and 'held' destroys
-- nothing: the row, its key and its metadata all stay, it simply stops being
-- counted. Every XP aggregate already filters on status = 'posted'
-- (rewards_lifetime_xp, rewards_rebuild_projections,
-- rewards_largest_trade_usd, rewards_referral_milestones), so a held row drops
-- out of each of them without a reader changing. Everything here is
-- restricted to reward_kind = 'xp', so no cash row is reachable under any
-- input, and 007's rule stands exactly as written for the rows it was written
-- for.
--
-- What changes for users, in production. lifetime XP and the reward history
-- stop counting the duplicates. The closed season's leaderboard probably does
-- NOT move: nothing rebuilds a closed season's projection after it ends --
-- the worker rebuilds only the current one -- so August's user_points were
-- never refreshed with September's rows, bar a run that straddled midnight.
-- The zeroing in the repair is there to make that case, and any future
-- rebuild of a closed season, come out right.
--
-- ---------------------------------------------------------------------------
-- RUNBOOK. None of this is run by the migration.
-- ---------------------------------------------------------------------------
--
-- Preconditions, all four, or rows written afterwards are not held:
--
--   a. The fixed worker is serving. A run log line reads
--      `[rewards-sync] run complete ... retired=... skipped=...`; the old
--      worker never prints those fields. Until it is live, the pre-fix
--      dashboard still lists held rows in history while totals drop.
--   b. This migration is applied. Checking the marker is not enough -- it
--      proves the repair exists, not that the claim changed:
--        select pg_get_functiondef(
--          'public.rewards_claim_fill_sync_batch(int,int)'::regprocedure
--        ) like '%s.ends_at%';                       -- must be true
--   c. One full cron cycle (10 minutes) has passed since both.
--   d. The report reads the same twice, ten minutes apart. If it grows,
--      something is still writing across the boundary; find it first.
--
-- Then, in the Supabase SQL editor (service role), not over REST:
--
--   select * from rewards_cross_season_grant_report();
--   select * from rewards_cross_season_grant_candidates()
--    where decision = 'review';                      -- decide these by hand
--   select * from rewards_hold_cross_season_grants();
--   select * from rewards_unqualified_referral_rungs_report();
--
-- The last one only means anything after the hold. Referral rungs sum builder
-- fees over every posted volume row regardless of season, so while the
-- duplicates were posted they doubled each referee's fee total against the
-- 'traded' and 'retained' thresholds. Rungs are permanent by design (019), so
-- this lists the ones that no longer qualify rather than holding them.
--
-- To undo one hold -- say, a first_trade a person decides was earned:
--
--   select rewards_release_cross_season_hold('<ledger id>');
--
-- which marks the row exempt, so a later run of the repair does not simply
-- hold it again. Every held row is stamped metadata.heldBy =
-- '030_cross_season' with heldAt, so what was held is always listable:
--
--   select * from reward_ledger where metadata ->> 'heldBy' = '030_cross_season';
--
-- Re-run the repair after any rollover that happened before the fixed worker
-- was live, and run the hold soon once it is: until then every run can grant
-- more referral rungs off the doubled fee sums.

/**
 * A timestamp from ledger metadata, or null when it is not one.
 *
 * The candidates read metadata.occurredAt, and a bare `::timestamptz` cast
 * raises on the first value it cannot parse -- which, executed, aborted the
 * whole report and the whole repair over a single row. The only writer this
 * repo has is `new Date(fill.time).toISOString()`, so a malformed value should
 * not exist; this is here so that if one does, it costs that row rather than
 * the operation. An unparseable value reads as null and is left alone.
 *
 * STABLE, not IMMUTABLE: text-to-timestamptz depends on the session TimeZone
 * for any string without an offset.
 */
create or replace function rewards_try_timestamptz(p_value text)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
begin
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;

/**
 * Every XP row the defect wrote, one per ledger row, with what to do about it.
 *
 * decision is 'hold' for rows that are provably from after the season ended,
 * and 'review' for rows written after the season ended whose activity cannot
 * be dated from the ledger. See the section note above for which is which and
 * why. Only 'posted' rows, and never one a person has released
 * (metadata.holdExempt), so this is also the report's and the repair's sole
 * definition of the problem.
 */
create or replace function rewards_cross_season_grant_candidates()
returns table (
  ledger_id uuid,
  season_id uuid,
  user_id uuid,
  source text,
  quest_id text,
  amount numeric,
  created_at timestamptz,
  decision text
)
language sql
stable
security definer
set search_path = public
as $$
  with tail as (
    -- (user, season) pairs whose checkpoint ingested an in-season fill after
    -- the season had ended: the one way an old-season first_trade written
    -- after rollover can have been earned inside the season.
    select distinct l.user_id, l.season_id
    from reward_ledger l
    join seasons s on s.id = l.season_id
    where l.reward_kind = 'xp'
      and l.source = 'volume_xp'
      and l.status = 'posted'
      and l.created_at >= s.ends_at
      and rewards_try_timestamptz(l.metadata ->> 'occurredAt') < s.ends_at
  ),
  late as (
    select
      l.id,
      l.season_id,
      l.user_id,
      l.source,
      l.quest_id,
      l.amount,
      l.created_at,
      case
        when l.source = 'volume_xp' then 'hold'
        when l.quest_id in ('first_deposit', 'second_deposit_7d') then 'hold'
        when l.quest_id = 'first_trade' and not exists (
          select 1 from tail t
          where t.user_id = l.user_id and t.season_id = l.season_id
        ) then 'hold'
        else 'review'
      end as decision
    from reward_ledger l
    join seasons s on s.id = l.season_id
    where l.reward_kind = 'xp'
      and l.status = 'posted'
      and coalesce(l.metadata ->> 'holdExempt', '') <> 'true'
      and (
        (
          l.source = 'volume_xp'
          and rewards_try_timestamptz(l.metadata ->> 'occurredAt') >= s.ends_at
        )
        or (
          l.source = 'quest'
          and l.created_at >= s.ends_at
        )
      )
  )
  select id, season_id, user_id, source, quest_id, amount, created_at, decision
  from late;
$$;

/**
 * The candidates, summarised per season, source, quest and decision.
 * Read-only.
 */
create or replace function rewards_cross_season_grant_report()
returns table (
  season_id uuid,
  season_name text,
  season_ends_at timestamptz,
  source text,
  quest_id text,
  decision text,
  grant_rows bigint,
  grant_xp numeric,
  affected_users bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.season_id,
    s.name,
    s.ends_at,
    c.source,
    c.quest_id,
    c.decision,
    count(*),
    coalesce(sum(c.amount), 0)::numeric,
    count(distinct c.user_id)
  from rewards_cross_season_grant_candidates() c
  join seasons s on s.id = c.season_id
  group by c.season_id, s.name, s.ends_at, c.source, c.quest_id, c.decision
  order by s.ends_at, c.source, c.quest_id, c.decision;
$$;

/**
 * Hold every 'hold' candidate, stamp it, and repair the affected projections.
 *
 * Idempotent: it only ever moves 'posted' to 'held', so a second call holds
 * nothing new. Each held row is stamped with heldBy and heldAt, which is what
 * makes the hold listable afterwards and what the projection repair below is
 * keyed on -- not a re-derivation of the predicate. Returns what this call
 * held, shaped like the report so the two can be compared.
 */
create or replace function rewards_hold_cross_season_grants()
returns table (
  season_id uuid,
  source text,
  quest_id text,
  held_rows bigint,
  held_xp numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season uuid;
begin
  return query
  with held as (
    update reward_ledger l
       set status = 'held',
           -- Quest rows carry NULL metadata; anything that is not an object is
           -- replaced rather than concatenated, since `'null'::jsonb || {...}`
           -- builds an array instead of adding keys.
           metadata = (
             case when jsonb_typeof(l.metadata) = 'object' then l.metadata else '{}'::jsonb end
           ) || jsonb_build_object('heldBy', '030_cross_season', 'heldAt', now())
      from rewards_cross_season_grant_candidates() c
     where l.id = c.ledger_id
       and c.decision = 'hold'
       and l.status = 'posted'
    returning l.season_id, l.source, l.quest_id, l.amount
  )
  select h.season_id, h.source, h.quest_id, count(*)::bigint, coalesce(sum(h.amount), 0)::numeric
  from held h
  group by h.season_id, h.source, h.quest_id
  order by h.season_id, h.source, h.quest_id;

  -- Repair the projections of every season carrying stamped holds.
  --
  -- rewards_rebuild_projections cannot shrink a projection on its own: it
  -- upserts only the users -- and user-weeks -- that still have posted rows,
  -- so anyone whose rows in the season were all duplicates is absent from its
  -- input and keeps the figure they had. Executed against the migrations,
  -- that is exactly what a rebuild alone left behind. So the keys the hold
  -- touched are zeroed first, then rebuilt: users with a stamped hold in the
  -- season, and user-weeks with a stamped volume hold. Only those keys, and
  -- only the columns the rebuild owns. Everything else in the season is left
  -- as it was, which matters: user_points also carries referral_volume and
  -- multiplier, weekly_rewards carries the raffle's pool_share, raffle_rank,
  -- raffle_prize and drawn_at, and some rows predate the ledger rebuild
  -- entirely. The function is one transaction, so nothing reads the zeros.
  --
  -- Every such season is closed -- a hold needs activity at or after ends_at
  -- -- so the live season's projection is never touched here. Repeating this
  -- gives identical values, which means a crash between the hold and the
  -- rebuild is recovered by calling it again.
  for v_season in
    select distinct l.season_id
    from reward_ledger l
    where l.status = 'held'
      and l.metadata ->> 'heldBy' = '030_cross_season'
  loop
    -- Qualified, and not as a matter of style: this function returns
    -- season_id and source, which makes them PL/pgSQL variables, and an
    -- unqualified reference is then ambiguous. Executed, that aborted the
    -- repair on its first run.
    update user_points up
       set xp = 0,
           total_volume = 0,
           updated_at = now()
     where up.season_id = v_season
       and up.user_id in (
         select l.user_id
         from reward_ledger l
         where l.season_id = v_season
           and l.status = 'held'
           and l.metadata ->> 'heldBy' = '030_cross_season'
       );

    update weekly_rewards wr
       set user_volume = 0
     where wr.season_id = v_season
       and (wr.user_id, wr.week_start) in (
         select l.user_id, l.week_start
         from reward_ledger l
         where l.season_id = v_season
           and l.status = 'held'
           and l.source = 'volume_xp'
           and l.week_start is not null
           and l.metadata ->> 'heldBy' = '030_cross_season'
       );

    perform rewards_rebuild_projections(v_season);
  end loop;
end;
$$;

/**
 * Undo one hold, durably.
 *
 * Setting a held row back to 'posted' by hand would not last: it still matches
 * the candidates, so the next run of the repair would hold it again, silently.
 * This marks it holdExempt, which the candidates exclude, keeps the heldBy
 * stamp as the record of what happened, and rebuilds its season so the
 * restored XP is counted again. Returns false for a row this repair did not
 * hold, and changes nothing.
 */
create or replace function rewards_release_cross_season_hold(p_ledger_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season uuid;
begin
  update reward_ledger l
     set status = 'posted',
         metadata = l.metadata
           || jsonb_build_object('holdExempt', true, 'releasedAt', now())
   where l.id = p_ledger_id
     and l.status = 'held'
     and l.metadata ->> 'heldBy' = '030_cross_season'
  returning l.season_id into v_season;

  if v_season is null then
    return false;
  end if;

  -- The user has a posted row in the season again, so the rebuild's upsert
  -- reaches them and restores the figure; no zeroing is needed going this way.
  perform rewards_rebuild_projections(v_season);
  return true;
end;
$$;

/**
 * Referral rungs granted that no longer qualify. Read-only.
 *
 * rewards_referral_milestones sums each referee's builder fees over every
 * posted volume row, in every season. While the duplicates were posted, each
 * duplicated fill counted twice, doubling the fee total against the 'traded'
 * and 'retained' thresholds -- so a referee could reach either on half the
 * real fee. The rungs are keyed per referee with no season, so nothing in the
 * hold can match them, and they are permanent by design (019).
 *
 * Meaningful only after the hold, when the milestone function is answering
 * from the true ledger again: it lists the 'traded' and 'retained' rungs a
 * person may want to hold, and decides nothing. 'funded' is omitted because it
 * rests on deposits, which the defect never doubled. Called with the same
 * defaults the worker uses (api/rewards/_lib/supabase-admin.ts).
 */
create or replace function rewards_unqualified_referral_rungs_report()
returns table (
  ledger_id uuid,
  user_id uuid,
  source text,
  milestone text,
  referee_id text,
  amount numeric,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with qualified as (
    select m.referee_id::text as referee_id, m.milestone
    from rewards_referral_milestones() m
  )
  select
    l.id,
    l.user_id,
    l.source,
    split_part(l.idempotency_key, ':', 2),
    split_part(l.idempotency_key, ':', 3),
    l.amount,
    l.created_at
  from reward_ledger l
  where l.reward_kind = 'xp'
    and l.status = 'posted'
    and l.source in ('referral', 'referral_bonus')
    and l.idempotency_key ~ '^referral:(traded|retained):'
    and not exists (
      select 1
      from qualified q
      where q.milestone = split_part(l.idempotency_key, ':', 2)
        and q.referee_id = split_part(l.idempotency_key, ':', 3)
    )
  order by l.created_at;
$$;

-- ---------------------------------------------------------------------------
-- 3. Keep the reconciliation report's cash alarm about cash
-- ---------------------------------------------------------------------------

/**
 * Unchanged from 013 except the held CTE, which now counts cash only.
 *
 * 013 counted every held row as held cash, which was true when it was written:
 * 007 introduced 'held' for parked usdc and raffle entitlements and nothing
 * else ever used it. The repair above now holds XP too, and 013's own note says
 * what a rising held_cash count means — "something is still creating cash
 * entitlements while the program is XP-only". Left alone, running the repair
 * would have fired that alarm with duplicated XP, and the column would have
 * gone on reporting XP as cash owed. XP is the one non-cash kind, so the
 * filter excludes it rather than naming the cash kinds; a future cash kind is
 * then counted without anyone remembering to add it here.
 */
create or replace function rewards_reconciliation_report(
  p_season_id uuid,
  p_stale_after_seconds int default 1800,
  p_failing_after_attempts int default 3
)
returns table (
  accounts_total bigint,
  accounts_never_synced bigint,
  accounts_stale bigint,
  accounts_failing bigint,
  accounts_retention_risk bigint,
  max_ingestion_lag_seconds numeric,
  oldest_cursor_time timestamptz,
  fills_ingested bigint,
  wallets_without_checkpoint bigint,
  drift_accounts bigint,
  drift_total_xp numeric,
  held_cash_rows bigint,
  held_cash_amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with checkpoints as (
    select * from rewards_fill_checkpoints where season_id = p_season_id
  ),
  drift as (
    select * from rewards_xp_projection_drift(p_season_id)
  ),
  held as (
    select count(*) as rows, coalesce(sum(amount), 0)::numeric as amount
    from reward_ledger
    where status = 'held'
      and reward_kind <> 'xp'
  )
  select
    (select count(*) from checkpoints),
    (select count(*) from checkpoints where last_success_at is null),
    (select count(*) from checkpoints
      where last_success_at is not null
        and last_success_at < now() - make_interval(secs => p_stale_after_seconds)),
    (select count(*) from checkpoints where consecutive_failures >= p_failing_after_attempts),
    (select count(*) from checkpoints where retention_risk),
    -- Lag is measured from the cursor, not from last_success_at: a checkpoint
    -- that succeeds every ten minutes while its cursor sits a month back is
    -- running perfectly and still has a month of unread history.
    (select coalesce(max(extract(epoch from (now() - cursor_time))), 0)::numeric from checkpoints),
    (select min(cursor_time) from checkpoints),
    (select coalesce(sum(fills_ingested), 0)::bigint from checkpoints),
    (select count(*) from users u
      where u.wallet_address is not null
        and not exists (
          select 1 from checkpoints c
          where c.user_id = u.id and c.wallet_address = u.wallet_address
        )),
    (select count(*) from drift),
    (select coalesce(sum(abs(drift.drift)), 0)::numeric from drift),
    (select rows from held),
    (select amount from held);
$$;

-- ---------------------------------------------------------------------------
-- Markers
-- ---------------------------------------------------------------------------

/**
 * One marker per migration. Redefined here because the list stopped at 026,
 * which left /api/health/migrations reporting ok while 027-029 were unapplied
 * -- and this migration is one whose absence matters: until it runs, a
 * pre-fix worker keeps granting across the season boundary.
 */
create or replace function migrations_report()
returns table (migration text, marker text, present boolean)
language sql
stable
security definer
set search_path = public
as $$
  with markers(migration, kind, marker) as (
    values
      ('000_baseline_schema', 'table', 'users'),
      ('001_identity_and_rls', 'table', 'notification_preferences'),
      ('002_onramp_v1', 'table', 'onramp_orders'),
      ('003_notifications', 'table', 'notification_events'),
      ('003_rewards_v1', 'table', 'reward_ledger'),
      ('004_platform_orchestration', 'table', 'merchants'),
      ('005_platform_hardening', 'table', 'user_risk_profiles'),
      ('006_weekly_raffle_runs', 'table', 'weekly_raffle_runs'),
      ('008_rewards_xp_accounting', 'function', 'rewards_season_xp_totals'),
      ('009_rewards_fill_checkpoints', 'table', 'rewards_fill_checkpoints'),
      ('011_rewards_leaderboard_privacy', 'function', 'rewards_season_leaderboard'),
      ('012_rewards_atomicity', 'function', 'rewards_claim_referrer'),
      ('013_rewards_reconciliation', 'function', 'rewards_reconciliation_report'),
      ('014_rewards_rebuildable_projections', 'function', 'rewards_rebuild_projections'),
      ('015_notifications_status', 'function', 'notifications_status_report'),
      ('016_rewards_streaks_and_lifetime', 'function', 'rewards_check_in_streak'),
      ('017_rewards_backfill_and_standing', 'function', 'rewards_season_user_standing'),
      ('018_rewards_attribution_recovery', 'function', 'rewards_rewind_fill_cursors'),
      ('019_rewards_referral_milestones', 'function', 'rewards_referral_milestones'),
      ('020_hl_deposit_ledger', 'table', 'hl_deposits'),
      ('021_builder_fill_verification', 'table', 'builder_fills'),
      ('022_builder_fill_day_ordering', 'function', 'rewards_pending_builder_fill_days'),
      ('023_largest_trade_progress', 'function', 'rewards_largest_trade_usd'),
      ('024_price_alerts', 'table', 'price_alerts'),
      ('025_ramp_provenance', 'column', 'hl_deposits.source_rail'),
      ('026_migrations_report', 'function', 'migrations_report'),
      ('027_wnft_conversions', 'table', 'wnft_conversions'),
      ('028_user_attribution', 'table', 'user_attribution'),
      ('029_growth_funnel', 'table', 'campaign_spend'),
      ('030_rewards_season_bounded_checkpoints', 'function', 'rewards_hold_cross_season_grants')
  )
  select
    m.migration,
    m.marker,
    case m.kind
      when 'table' then to_regclass('public.' || m.marker) is not null
      when 'column' then exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = split_part(m.marker, '.', 1)
          and c.column_name = split_part(m.marker, '.', 2)
      )
      else exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = m.marker
      )
    end as present
  from markers m
  order by m.migration;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- These are security definer. Revoking from PUBLIC alone is not enough: default
-- privileges grant EXECUTE on new functions in `public` to anon and
-- authenticated by name. See 008_rewards_xp_accounting.sql. Re-stated for the
-- replaced functions too, so this file is correct on its own.
revoke execute on function public.rewards_claim_fill_sync_batch(int, int) from public;
revoke execute on function public.rewards_try_timestamptz(text) from public;
revoke execute on function public.rewards_cross_season_grant_candidates() from public;
revoke execute on function public.rewards_cross_season_grant_report() from public;
revoke execute on function public.rewards_hold_cross_season_grants() from public;
revoke execute on function public.rewards_release_cross_season_hold(uuid) from public;
revoke execute on function public.rewards_unqualified_referral_rungs_report() from public;
revoke execute on function public.rewards_reconciliation_report(uuid, int, int) from public;
revoke execute on function public.migrations_report() from public;

revoke execute on function public.rewards_claim_fill_sync_batch(int, int) from anon, authenticated;
revoke execute on function public.rewards_try_timestamptz(text) from anon, authenticated;
revoke execute on function public.rewards_cross_season_grant_candidates() from anon, authenticated;
revoke execute on function public.rewards_cross_season_grant_report() from anon, authenticated;
revoke execute on function public.rewards_hold_cross_season_grants() from anon, authenticated;
revoke execute on function public.rewards_release_cross_season_hold(uuid) from anon, authenticated;
revoke execute on function public.rewards_unqualified_referral_rungs_report() from anon, authenticated;
revoke execute on function public.rewards_reconciliation_report(uuid, int, int) from anon, authenticated;
revoke execute on function public.migrations_report() from anon, authenticated;
