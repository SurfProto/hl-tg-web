alter table users
  add column if not exists email text,
  add column if not exists kyc_status text,
  add column if not exists kyc_source text,
  add column if not exists kyc_checked_at timestamptz,
  add column if not exists kyc_id text;

create table if not exists verified_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  normalized_email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists onramp_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider_order_id text not null unique,
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
  last_synced_at timestamptz not null default now(),
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists onramp_orders_user_created_idx
  on onramp_orders(user_id, created_at desc);

create index if not exists onramp_orders_app_state_idx
  on onramp_orders(app_state);

create index if not exists onramp_orders_email_idx
  on onramp_orders(email);

alter table verified_emails enable row level security;
alter table onramp_orders enable row level security;
