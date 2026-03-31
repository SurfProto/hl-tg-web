create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id text unique not null,
  wallet_address text unique,
  username text,
  language text default 'en',
  referral_code text unique,
  referred_by uuid references users(id),
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
  claimed boolean default false
);

create table if not exists awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  award_type text not null,
  unlocked_at timestamptz default now()
);

alter table users enable row level security;
alter table notification_preferences enable row level security;
alter table user_points enable row level security;
alter table referral_earnings enable row level security;
alter table weekly_rewards enable row level security;
alter table awards enable row level security;
