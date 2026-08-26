-- Make the reward ledger the authoritative source of XP totals.
--
-- The dashboard computed a user's season XP by summing the reward history it
-- had already fetched for display -- and that fetch is capped at 150 rows,
-- ordered by created_at desc. A user with more than 150 ledger rows therefore
-- had their XP silently recomputed from a recent window and written back over
-- the projection, so the number went *down* as they earned more. Volume XP
-- writes one row per fill, so 150 is not a distant ceiling.
--
-- Totals now come from an aggregate over every applicable row. `user_points`
-- becomes a cache of that answer rather than the place the answer lives, which
-- is why the rebuild and drift functions below exist: a projection you cannot
-- recompute is indistinguishable from a source of truth that happens to be
-- wrong.

-- Serves the aggregate directly: the filters below are exactly its WHERE
-- clause, and `source` is included so the per-source breakdown is an
-- index-only scan.
create index if not exists reward_ledger_xp_totals_idx
  on reward_ledger(user_id, season_id, source)
  where reward_kind = 'xp' and status = 'posted';

-- ---------------------------------------------------------------------------
-- Totals
-- ---------------------------------------------------------------------------

/**
 * Season XP for one user, broken down by source.
 *
 * Only 'posted' XP counts. Held cash rows and any future non-terminal XP row
 * are excluded rather than filtered out downstream, so a caller cannot
 * accidentally total something that was never awarded.
 *
 * Returns one row per source that has entries; a user with no XP returns no
 * rows, and the caller is responsible for treating that as zero.
 */
create or replace function rewards_season_xp_totals(
  p_user_id uuid,
  p_season_id uuid
)
returns table (source text, xp numeric)
language sql
stable
security definer
set search_path = public
as $$
  select l.source, coalesce(sum(l.amount), 0)::numeric
  from reward_ledger l
  where l.user_id = p_user_id
    and l.season_id = p_season_id
    and l.reward_kind = 'xp'
    and l.status = 'posted'
  group by l.source;
$$;

-- ---------------------------------------------------------------------------
-- Reconciliation
-- ---------------------------------------------------------------------------

/**
 * Where the stored projection disagrees with the ledger, for one season.
 *
 * Reports only -- it never writes. A reconciliation tool that mutates by
 * default cannot be run to answer "is anything wrong?", because running it
 * destroys the evidence of what was wrong.
 *
 * Uses a full outer join so both failure directions are visible: a projection
 * row with no ledger behind it, and ledger XP with no projection row at all.
 */
create or replace function rewards_xp_projection_drift(p_season_id uuid)
returns table (
  user_id uuid,
  projected_xp numeric,
  ledger_xp numeric,
  drift numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with ledger as (
    select l.user_id, coalesce(sum(l.amount), 0)::numeric as xp
    from reward_ledger l
    where l.season_id = p_season_id
      and l.reward_kind = 'xp'
      and l.status = 'posted'
    group by l.user_id
  ),
  projected as (
    select p.user_id, coalesce(p.xp, 0)::numeric as xp
    from user_points p
    where p.season_id = p_season_id
  )
  select
    coalesce(projected.user_id, ledger.user_id),
    coalesce(projected.xp, 0),
    coalesce(ledger.xp, 0),
    coalesce(projected.xp, 0) - coalesce(ledger.xp, 0)
  from projected
  full outer join ledger on ledger.user_id = projected.user_id
  where coalesce(projected.xp, 0) is distinct from coalesce(ledger.xp, 0);
$$;

/**
 * Rebuild the XP projection for a season from the ledger. Returns rows changed.
 *
 * Deliberately touches only `xp`. `total_volume` and `referral_volume` are not
 * derivable from the ledger -- they come from exchange fills -- so rebuilding
 * them here would overwrite real data with zeroes. Those become rebuildable
 * once fill ingestion is checkpointed and durable.
 *
 * Only updates existing rows. Creating a projection row for a user who has
 * ledger XP but no `user_points` row is a repair, not a rebuild, and the drift
 * report above surfaces that case for a human to look at instead.
 */
create or replace function rewards_rebuild_xp_projection(p_season_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  with ledger as (
    select l.user_id, coalesce(sum(l.amount), 0)::numeric as xp
    from reward_ledger l
    where l.season_id = p_season_id
      and l.reward_kind = 'xp'
      and l.status = 'posted'
    group by l.user_id
  )
  update user_points p
     set xp = ledger.xp,
         updated_at = now()
    from ledger
   where p.season_id = p_season_id
     and p.user_id = ledger.user_id
     and p.xp is distinct from ledger.xp;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- These are security definer, so an EXECUTE grant to anon or authenticated
-- lets anyone holding the publishable key read every user's XP breakdown via
-- /rest/v1/rpc/rewards_xp_projection_drift, and write to user_points via
-- rewards_rebuild_xp_projection. Only the API calls them, with the service role
-- key, which keeps its own grant.
--
-- Both revokes are required, and the second is the one that actually bites.
-- 006_weekly_raffle_runs.sql claims anon/authenticated "hold no explicit grant"
-- so that revoking from PUBLIC suffices — that is not true in this project.
-- Default privileges grant EXECUTE on new functions in `public` to anon and
-- authenticated by name, so a freshly created function carries
-- `anon=X/postgres` in its ACL and survives the PUBLIC revoke untouched.
-- Verified after applying: proacl is {postgres=X,service_role=X}.
revoke execute on function public.rewards_season_xp_totals(uuid, uuid) from public;
revoke execute on function public.rewards_xp_projection_drift(uuid) from public;
revoke execute on function public.rewards_rebuild_xp_projection(uuid) from public;

revoke execute on function public.rewards_season_xp_totals(uuid, uuid) from anon, authenticated;
revoke execute on function public.rewards_xp_projection_drift(uuid) from anon, authenticated;
revoke execute on function public.rewards_rebuild_xp_projection(uuid) from anon, authenticated;
