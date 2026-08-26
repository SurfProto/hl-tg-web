-- Baseline: the tables that existed before this directory did.
--
-- `users`, `seasons`, `user_points`, `weekly_rewards`, `awards`,
-- `referral_earnings` and `bridge_sponsorship_events` were created directly
-- against the hosted project and never written down. Every migration numbered
-- 001 and up assumes them: 001_identity_and_rls.sql references `users`,
-- 003_rewards_v1.sql opens with `alter table weekly_rewards`, and
-- 006_weekly_raffle_runs.sql has a foreign key into `seasons`. Applying this
-- directory to an empty database therefore failed on the first statement, and
-- no migration touching these tables could be tested anywhere but production.
--
-- This file is a description of what already exists, not a change to it. Every
-- statement is guarded, so applying it to the live project is a no-op; applying
-- it to a fresh database reproduces the starting point the numbered migrations
-- were written against. Captured from project tdtlptrpgxweyulkenza on
-- 2026-08-24.
--
-- Two consequences worth stating plainly:
--
--   * It is deliberately the PRE-003 shape. `weekly_rewards` has no raffle_*
--     columns and no (user_id, season_id, week_start) unique index here,
--     because 003_rewards_v1.sql adds them. A baseline that already included
--     them would make 003 fail on a fresh database.
--
--   * It reproduces the CURRENT security posture, including where that posture
--     is wrong. `seasons` and `bridge_sponsorship_events` have RLS disabled and
--     are readable and writable by anyone holding the anon key. That is a live
--     exposure, and it is left as-is here on purpose: this file records
--     reality, and changing reality belongs in its own reviewed migration. See
--     the RLS work in the integrity/privacy release of
--     docs/superpowers/specs/2026-08-24-points-xp-only-hardening-design.md.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  privy_user_id text unique,
  telegram_id text unique,
  wallet_address text unique,
  username text,
  language text default 'en',
  referral_code text unique,
  referred_by uuid references users(id),
  created_at timestamptz default now(),
  email text,
  kyc_status text,
  kyc_source text,
  kyc_checked_at timestamptz,
  kyc_id text
);

alter table users enable row level security;

-- Service-role only. The mini-app never talks to these tables with an anon
-- key; every read and write goes through an API route holding the service key.
drop policy if exists "users_service_role_access" on users;
create policy "users_service_role_access" on users for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role')
  with check (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- ---------------------------------------------------------------------------
-- seasons
-- ---------------------------------------------------------------------------

-- NOTE: RLS is disabled on this table in the live project, which leaves it
-- fully readable and writable with the anon key. Reproduced faithfully rather
-- than silently fixed; see the header.
create table if not exists seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reward_pool_weekly numeric,
  is_active boolean default false
);

-- ---------------------------------------------------------------------------
-- user_points — a projection of the reward ledger, not a source of truth
-- ---------------------------------------------------------------------------

create table if not exists user_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  season_id uuid references seasons(id) on delete cascade,
  xp numeric default 0,
  total_volume numeric default 0,
  referral_volume numeric default 0,
  multiplier numeric default 1.0,
  updated_at timestamptz default now(),
  unique (user_id, season_id)
);

-- RLS on with no policies: deny-all for anon and authenticated, while the
-- service role bypasses RLS entirely. That is the intended posture for every
-- table below, and it is why they carry no policy definitions.
alter table user_points enable row level security;

-- ---------------------------------------------------------------------------
-- weekly_rewards — pre-003 shape; 003_rewards_v1.sql adds the raffle columns
-- ---------------------------------------------------------------------------

create table if not exists weekly_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  season_id uuid references seasons(id) on delete cascade,
  week_start timestamptz not null,
  user_volume numeric default 0,
  pool_share numeric default 0,
  claimed boolean default false
);

alter table weekly_rewards enable row level security;

-- ---------------------------------------------------------------------------
-- awards, referral_earnings — created but never used
-- ---------------------------------------------------------------------------

-- Both are empty and no runtime path reads or writes either one. They are kept
-- for compatibility and documented as unused rather than dropped.

create table if not exists awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  award_type text not null,
  unlocked_at timestamptz default now()
);

alter table awards enable row level security;

create table if not exists referral_earnings (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid references users(id) on delete cascade,
  referee_id uuid references users(id) on delete cascade,
  tier int not null check (tier >= 1 and tier <= 3),
  volume numeric default 0,
  earnings numeric default 0,
  claimed boolean default false,
  period_start timestamptz,
  period_end timestamptz
);

alter table referral_earnings enable row level security;

-- ---------------------------------------------------------------------------
-- bridge_sponsorship_events
-- ---------------------------------------------------------------------------

-- NOTE: RLS is disabled on this table in the live project. Same exposure and
-- same reasoning as `seasons` above.
create table if not exists bridge_sponsorship_events (
  id uuid primary key default gen_random_uuid(),
  privy_user_id text not null,
  wallet_address text not null,
  amount_usdc numeric not null,
  chain_id integer not null,
  token_address text not null,
  bridge_address text not null,
  status text not null check (status in ('authorized', 'rejected')),
  rejection_code text,
  rejection_reason text,
  created_at timestamptz default now()
);
