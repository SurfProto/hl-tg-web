-- The trade quest's progress bar could never show anything.
--
-- Progress was computed from the fills passed into the quest snapshot, and the
-- read path passes none — deliberately, because ingestion is scheduled and a
-- dashboard request performs no exchange I/O. So the bar read "$0 / $10" for an
-- account that had traded $1,609 across twenty-three fills, twenty-two of them
-- over the threshold.
--
-- The ledger already holds what is needed: every volume grant records the
-- fill's notional in `metadata.volumeUsd`. One maximum, computed by the
-- database rather than by loading a season of grants into a request handler to
-- fold over them.

create or replace function rewards_largest_trade_usd(
  p_season_id uuid,
  p_user_id uuid
)
returns table (largest_trade_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max((l.metadata->>'volumeUsd')::numeric), 0)::numeric
  from reward_ledger l
  where l.user_id = p_user_id
    and l.season_id = p_season_id
    and l.source = 'volume_xp'
    and l.status = 'posted'
    and l.metadata ? 'volumeUsd';
$$;

-- security definer. Revoking from PUBLIC alone is not enough: default
-- privileges grant EXECUTE on new functions in `public` to anon and
-- authenticated by name. See 008_rewards_xp_accounting.sql.
revoke execute on function public.rewards_largest_trade_usd(uuid, uuid) from public;
revoke execute on function public.rewards_largest_trade_usd(uuid, uuid) from anon, authenticated;
