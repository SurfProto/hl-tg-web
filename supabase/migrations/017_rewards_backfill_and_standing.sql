-- Two defects in the rewards read and ingestion paths.
--
-- 1. Checkpoint backfill could never reach past the first 500 accounts.
--
-- The candidate set was every wallet-holding user ordered by created_at, then
-- limited. The limit was meant as a per-run bound, but because it was applied
-- to *all* users rather than to those still missing a checkpoint, every run
-- selected the same oldest 500 and did nothing. Account 501 would never get a
-- checkpoint, would never be claimed by the sync worker, and would silently
-- earn no trading XP — with nothing anywhere reporting a problem.
--
-- Selecting only users who lack a checkpoint makes the bound do what it was
-- supposed to: cap work per run while still making progress on every run.
-- `rewards_reconciliation_report.wallets_without_checkpoint` already surfaces
-- the backlog, so a slow catch-up is visible rather than silent.
--
-- 2. A user outside the top page saw their own season volume as zero.
--
-- The dashboard read its own volume out of the leaderboard page, which is the
-- top ten. Rank eleven read no row and fell back to zero, so the number on a
-- user's own screen said they had traded nothing. `rewards_season_user_rank`
-- already computed that user's position across the whole season; it just did
-- not return the figures alongside it.

create or replace function rewards_backfill_fill_checkpoints(
  p_season_id uuid,
  p_start_at timestamptz,
  p_limit int default 500
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer;
begin
  with candidates as (
    select u.id as user_id, u.wallet_address
    from users u
    where u.wallet_address is not null
      -- Only accounts still missing a checkpoint. Without this the limit
      -- selects the same oldest N users on every run and never advances.
      and not exists (
        select 1
        from rewards_fill_checkpoints c
        where c.user_id = u.id
          and c.season_id = p_season_id
          and c.wallet_address = u.wallet_address
      )
    order by u.created_at
    limit greatest(1, least(p_limit, 5000))
  ),
  inserted as (
    insert into rewards_fill_checkpoints (user_id, season_id, wallet_address, cursor_time)
    select c.user_id, p_season_id, c.wallet_address, p_start_at
    from candidates c
    on conflict (user_id, season_id, wallet_address) do nothing
    returning 1
  )
  select count(*) into v_created from inserted;

  return v_created;
end;
$$;

/**
 * The caller's own standing: rank, eligible volume and XP for the season.
 *
 * Replaces `rewards_season_user_rank`, which returned only the position. The
 * dashboard needed the figures too and was taking them from the leaderboard
 * page — fine for the top ten, zero for everyone else.
 *
 * Ranked across the whole season, so this is correct at any position.
 */
create or replace function rewards_season_user_standing(
  p_season_id uuid,
  p_user_id uuid
)
returns table (
  rank bigint,
  eligible_volume numeric,
  xp numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select ranked.rank, ranked.eligible_volume, ranked.xp
  from (
    select
      p.user_id,
      row_number() over (order by coalesce(p.total_volume, 0) desc, p.user_id) as rank,
      coalesce(p.total_volume, 0)::numeric as eligible_volume,
      coalesce(p.xp, 0)::numeric as xp
    from user_points p
    where p.season_id = p_season_id
  ) ranked
  where ranked.user_id = p_user_id;
$$;

revoke execute on function public.rewards_season_user_standing(uuid, uuid) from public;
revoke execute on function public.rewards_season_user_standing(uuid, uuid) from anon, authenticated;
