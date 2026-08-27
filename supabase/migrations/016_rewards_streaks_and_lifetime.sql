-- Daily check-in streaks and lifetime XP, both derived rather than stored.
--
-- A streak is the obvious candidate for a counter column, and a counter is the
-- wrong shape. It can drift from the grants it is supposed to describe, it
-- cannot be rebuilt if it does, and it needs its own correctness argument about
-- timezones and double-increments. Check-in grants are already dated ledger
-- rows, so the streak is a query over them — reconstructible like every other
-- total in this program, and incapable of disagreeing with what was paid.
--
-- Lifetime XP is the same aggregate the season totals use, without the season
-- filter. It exists as its own concept because XP does two jobs: season XP
-- resets and drives ranks, lifetime XP never resets and is the permanent
-- record. Users should never watch a redemption reduce their standing.

-- Serves both functions below. Check-in rows are a small fraction of the
-- ledger, so a partial index keeps this cheap.
create index if not exists reward_ledger_checkin_idx
  on reward_ledger(user_id, season_id, week_start)
  where source = 'daily_check_in' and status = 'posted';

/**
 * Check-in streak for one user in one season.
 *
 * A day counts when a check-in grant exists for it. UTC throughout, matching
 * the idempotency key the endpoint writes — a streak that depended on the
 * viewer's timezone could be broken or extended by travelling.
 *
 * `current_days` counts back from today or yesterday. Yesterday still counts
 * because a user who checked in at 23:00 has not lost the streak at 00:01;
 * they simply have not taken today's yet.
 */
create or replace function rewards_check_in_streak(
  p_user_id uuid,
  p_season_id uuid,
  p_now timestamptz default now()
)
returns table (
  current_days int,
  longest_days int,
  available_today boolean,
  last_check_in_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with days as (
    select distinct (l.created_at at time zone 'utc')::date as day, max(l.created_at) as at
    from reward_ledger l
    where l.user_id = p_user_id
      and l.season_id = p_season_id
      and l.source = 'daily_check_in'
      and l.status = 'posted'
    group by 1
  ),
  -- Consecutive days collapse to a single group: subtracting a dense rank from
  -- the date leaves every day in a run sharing an anchor.
  runs as (
    select day, at, day - (dense_rank() over (order by day))::int as run_anchor
    from days
  ),
  grouped as (
    select run_anchor, count(*)::int as length, max(day) as ends_on, max(at) as last_at
    from runs
    group by run_anchor
  ),
  today as (select (p_now at time zone 'utc')::date as d)
  select
    coalesce(
      (select g.length from grouped g, today
        where g.ends_on >= today.d - 1
        order by g.ends_on desc limit 1),
      0
    ),
    coalesce((select max(g.length) from grouped g), 0),
    not exists (select 1 from days, today where days.day = today.d),
    (select max(days.at) from days);
$$;

/**
 * Lifetime XP for a user, across every season.
 *
 * Deliberately unfiltered by season and deliberately not the same number the
 * dashboard headline shows. Season XP drives rank and resets; this does not.
 */
create or replace function rewards_lifetime_xp(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(l.amount), 0)::numeric
  from reward_ledger l
  where l.user_id = p_user_id
    and l.reward_kind = 'xp'
    and l.status = 'posted';
$$;

-- security definer, and both read across accounts. Revoking from PUBLIC alone
-- is not enough: default privileges grant EXECUTE on new functions in `public`
-- to anon and authenticated by name. See 008_rewards_xp_accounting.sql.
revoke execute on function public.rewards_check_in_streak(uuid, uuid, timestamptz) from public;
revoke execute on function public.rewards_lifetime_xp(uuid) from public;

revoke execute on function public.rewards_check_in_streak(uuid, uuid, timestamptz) from anon, authenticated;
revoke execute on function public.rewards_lifetime_xp(uuid) from anon, authenticated;
