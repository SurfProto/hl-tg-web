create extension if not exists pgcrypto;

-- Core user identity table.
-- telegram_id is nullable: wallet-only users (no Telegram) have NULL.
-- wallet_address is the primary identity anchor for RLS since Privy handles auth.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id text unique,          -- nullable: NULL for wallet-only users
  wallet_address text unique,
  privy_user_id text unique,        -- Privy user.id for cross-reference
  username text,
  email text,
  kyc_status text,
  kyc_source text,
  kyc_checked_at timestamptz,
  kyc_id text,
  language text default 'en',
  referral_code text unique,
  referred_by uuid references users(id),
  created_at timestamptz default now()
);

create table if not exists verified_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  normalized_email text not null unique,
  created_at timestamptz default now()
);

create table if not exists onramp_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  provider_order_id text unique not null,
  external_order_id text unique,
  service_id text,
  provider_state text not null,
  app_state text not null,
  payin_amount numeric,
  payin_currency text,
  payout_amount numeric,
  payout_currency text,
  fee_amount numeric,
  wallet_address text not null,
  email text,
  invoice_url text,
  invoice_url_expires_at timestamptz,
  provider_created_at timestamptz,
  provider_touched_at timestamptz,
  last_synced_at timestamptz default now(),
  error_code text,
  error_message text,
  created_at timestamptz default now()
);

create table if not exists notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  liquidation_alerts boolean default true,
  order_fills boolean default true,
  usdc_deposits boolean default true,
  updated_at timestamptz default now(),
  unique(user_id)
);

create table if not exists seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reward_pool_weekly numeric,
  is_active boolean default false
);

create table if not exists user_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  season_id uuid references seasons(id) on delete cascade,
  xp numeric default 0,
  total_volume numeric default 0,
  referral_volume numeric default 0,
  multiplier numeric default 1.0,
  updated_at timestamptz default now(),
  unique(user_id, season_id)
);

create table if not exists referral_earnings (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid references users(id) on delete cascade,
  referee_id uuid references users(id) on delete cascade,
  tier int not null check (tier between 1 and 3),
  volume numeric default 0,
  earnings numeric default 0,
  claimed boolean default false,
  period_start timestamptz,
  period_end timestamptz
);

create table if not exists weekly_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  season_id uuid references seasons(id) on delete cascade,
  week_start timestamptz not null,
  user_volume numeric default 0,
  pool_share numeric default 0,
  claimed boolean default false,
  raffle_rank int,
  raffle_eligible boolean default false,
  raffle_prize numeric default 0,
  drawn_at timestamptz
);

create table if not exists awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  award_type text not null,
  unlocked_at timestamptz default now()
);

create table if not exists reward_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  season_id uuid references seasons(id) on delete set null,
  week_start timestamptz,
  quest_id text,
  reward_kind text not null check (reward_kind in ('xp', 'usdc', 'raffle', 'tickets')),
  amount numeric not null default 0,
  asset text,
  status text not null default 'posted' check (status in ('posted', 'pending', 'failed')),
  idempotency_key text not null unique,
  source text not null,
  description text not null,
  metadata jsonb default '{}'::jsonb,
  posted_at timestamptz,
  created_at timestamptz default now()
);

create unique index if not exists weekly_rewards_user_week_key
  on weekly_rewards(user_id, season_id, week_start);
create index if not exists reward_ledger_user_created_at_idx
  on reward_ledger(user_id, created_at desc);
create index if not exists reward_ledger_season_id_idx
  on reward_ledger(season_id);
create index if not exists reward_ledger_week_start_idx
  on reward_ledger(week_start);

-- Enable RLS on all tables
alter table users enable row level security;
alter table verified_emails enable row level security;
alter table notification_preferences enable row level security;
alter table user_points enable row level security;
alter table referral_earnings enable row level security;
alter table weekly_rewards enable row level security;
alter table awards enable row level security;
alter table reward_ledger enable row level security;
alter table onramp_orders enable row level security;

-- RLS Policies (see migrations/001_identity_and_rls.sql for the ALTER statements)
-- users: public read, authenticated update own, open insert for ensureUser()
create policy "users_select_own" on users for select using (true);
create policy "users_insert_any" on users for insert with check (true);
create policy "users_update_own" on users for update
  using (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- points tables: anon reads own rows, service role writes
create policy "user_points_select_own" on user_points for select
  using (user_id in (select id from users where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'));
create policy "user_points_service_write" on user_points for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

create policy "referral_earnings_select_own" on referral_earnings for select
  using (referrer_id in (select id from users where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'));
create policy "referral_earnings_service_write" on referral_earnings for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

create policy "weekly_rewards_select_own" on weekly_rewards for select
  using (user_id in (select id from users where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'));
create policy "weekly_rewards_service_write" on weekly_rewards for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

create policy "awards_select_own" on awards for select
  using (user_id in (select id from users where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'));
create policy "awards_service_write" on awards for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

create policy "reward_ledger_select_own" on reward_ledger for select
  using (user_id in (select id from users where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'));
create policy "reward_ledger_service_write" on reward_ledger for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

create policy "notif_prefs_select_own" on notification_preferences for select
  using (user_id in (select id from users where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'));
create policy "notif_prefs_write_own" on notification_preferences for all
  using (user_id in (select id from users where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'));
