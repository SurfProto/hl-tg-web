-- Support for the growth funnel report (admin-only).
--
-- Two pieces the report cannot derive from trading data alone: what a campaign
-- cost, and when each account last traded.

-- Campaign spend is external truth — what was paid for a channel — so it is
-- operator-seeded, like fx_reference_rates and user_risk_profiles (see
-- DEPLOYMENT.md). The report reads it to compute CAC; there is no write path
-- and no portal. One row per campaign_code, matching user_attribution's codes.
create table if not exists campaign_spend (
  campaign_code text primary key,
  spend_usd numeric not null default 0,
  currency text not null default 'USD',
  note text,
  updated_at timestamptz not null default now()
);

alter table campaign_spend enable row level security;

-- Last trading activity per account, in one query rather than a round-trip per
-- user. Joined to reconciled builder_fills — the same evidence WNFT uses — so
-- "active" means a real P34K trade, not a self-reported one. Case-insensitive
-- wallet join, as everywhere builder_fills meets users.
create or replace function growth_last_activity()
returns table (user_id uuid, last_occurred_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, max(b.occurred_at)
  from builder_fills b
  join users u on lower(u.wallet_address) = b.wallet_address
  group by u.id;
$$;

-- security definer. Revoking from PUBLIC alone is not enough — default privileges
-- grant EXECUTE on new public functions to anon and authenticated by name. See
-- 008_rewards_xp_accounting.sql.
revoke execute on function public.growth_last_activity() from public;
revoke execute on function public.growth_last_activity() from anon, authenticated;
