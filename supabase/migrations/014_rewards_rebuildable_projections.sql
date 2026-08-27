-- Make the leaderboard projections derivable from the ledger, and self-healing.
--
-- Two problems, one cause. Making the dashboard read-only removed the only
-- caller of upsertUserPoints and upsertWeeklyReward, and the ingestion worker
-- never took over. So `user_points.total_volume` — which the leaderboard ranks
-- on — has been frozen at whatever the old write path last left there.
--
-- Re-adding the write would fix the symptom. The deeper problem is that XP was
-- rebuildable from the ledger and volume was not, so a drifted volume figure
-- had no remedy at all. Volume *is* recoverable: every volume_xp row already
-- carries the notional it was granted for in `metadata.volumeUsd`. This makes
-- that explicit and rebuilds both columns from the same source of truth.
--
-- The worker calls this once per run, which means the projection reconciles
-- itself continuously rather than depending on every writer being correct.

-- Supports the per-user and per-week aggregates below. `metadata` is not
-- indexed and does not need to be: the filter is on the indexed columns and
-- the JSON is only read from rows that already matched.
create index if not exists reward_ledger_volume_xp_idx
  on reward_ledger(season_id, user_id, week_start)
  where source = 'volume_xp' and reward_kind = 'xp' and status = 'posted';

/**
 * Rebuild `user_points` and `weekly_rewards` for a season from the ledger.
 *
 * Upserts rather than updates, so a user with ledger history but no projection
 * row is repaired rather than skipped — that gap was previously only reported
 * by the drift function and never fixed.
 *
 * Deliberately does not touch `referral_volume` or `multiplier`. Neither is
 * derivable from the ledger — referral volume comes from on-ramp records and
 * the multiplier is program state — so rebuilding them here would overwrite
 * real data with nulls, which is exactly the failure the XP rebuild avoids by
 * touching only its own column.
 */
create or replace function rewards_rebuild_projections(p_season_id uuid)
returns table (points_rows bigint, weekly_rows bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points bigint;
  v_weekly bigint;
begin
  with ledger as (
    select
      l.user_id,
      sum(l.amount) filter (where l.reward_kind = 'xp') as xp,
      coalesce(
        sum((l.metadata->>'volumeUsd')::numeric)
          filter (where l.source = 'volume_xp' and l.metadata ? 'volumeUsd'),
        0
      ) as volume
    from reward_ledger l
    where l.season_id = p_season_id
      and l.status = 'posted'
    group by l.user_id
  ),
  upserted as (
    insert into user_points (user_id, season_id, xp, total_volume, updated_at)
    select ledger.user_id, p_season_id, coalesce(ledger.xp, 0), ledger.volume, now()
    from ledger
    on conflict (user_id, season_id) do update
      set xp = excluded.xp,
          total_volume = excluded.total_volume,
          updated_at = now()
      where user_points.xp is distinct from excluded.xp
         or user_points.total_volume is distinct from excluded.total_volume
    returning 1
  )
  select count(*) into v_points from upserted;

  with weekly as (
    select
      l.user_id,
      l.week_start,
      coalesce(sum((l.metadata->>'volumeUsd')::numeric), 0) as volume
    from reward_ledger l
    where l.season_id = p_season_id
      and l.status = 'posted'
      and l.source = 'volume_xp'
      and l.week_start is not null
      and l.metadata ? 'volumeUsd'
    group by l.user_id, l.week_start
  ),
  upserted_weekly as (
    insert into weekly_rewards (user_id, season_id, week_start, user_volume)
    select weekly.user_id, p_season_id, weekly.week_start, weekly.volume
    from weekly
    on conflict (user_id, season_id, week_start) do update
      set user_volume = excluded.user_volume
      where weekly_rewards.user_volume is distinct from excluded.user_volume
    returning 1
  )
  select count(*) into v_weekly from upserted_weekly;

  return query select v_points, v_weekly;
end;
$$;

-- security definer and it writes. Revoking from PUBLIC alone is not enough:
-- default privileges grant EXECUTE on new functions in `public` to anon and
-- authenticated by name. See the note in 008_rewards_xp_accounting.sql.
revoke execute on function public.rewards_rebuild_projections(uuid) from public;
revoke execute on function public.rewards_rebuild_projections(uuid) from anon, authenticated;
