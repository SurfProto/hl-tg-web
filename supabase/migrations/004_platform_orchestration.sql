create table if not exists merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended', 'rejected')),
  risk_category text not null default 'standard' check (risk_category in ('low', 'standard', 'high', 'prohibited')),
  country text not null,
  settlement_currency text not null default 'USDT',
  settlement_method text not null default 'stablecoin',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists merchant_api_keys (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  key_hash text not null unique,
  label text,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists merchant_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  url text not null,
  secret_hash text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payment_rails (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  currency text not null,
  direction text not null check (direction in ('onramp', 'offramp', 'merchant_payment')),
  payment_method text not null check (payment_method in ('card', 'bank_transfer', 'mobile_money', 'cash', 'wallet')),
  provider text not null,
  fixed_fee numeric not null default 0,
  percentage_fee_bps int not null default 0,
  success_rate_bps int not null default 0,
  settlement_delay_minutes int not null default 0,
  health text not null default 'healthy' check (health in ('healthy', 'degraded', 'down')),
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(country, currency, direction, payment_method, provider)
);

create table if not exists platform_transactions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  user_id uuid references users(id) on delete set null,
  merchant_id uuid references merchants(id) on delete set null,
  direction text not null check (direction in ('onramp', 'offramp', 'merchant_payment')),
  status text not null default 'created' check (status in ('created', 'authorized', 'held', 'processing', 'settled', 'failed', 'reversed')),
  country text not null,
  fiat_currency text not null,
  crypto_asset text not null,
  gross_amount numeric not null,
  fee_amount numeric not null default 0,
  crypto_amount numeric not null default 0,
  payment_method text not null check (payment_method in ('card', 'bank_transfer', 'mobile_money', 'cash', 'wallet')),
  rail_id uuid references payment_rails(id) on delete set null,
  provider text,
  provider_order_id text,
  risk_action text not null check (risk_action in ('allow', 'review', 'reject', 'hold', 'freeze')),
  risk_reason_code text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists transaction_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references platform_transactions(id) on delete cascade,
  account text not null,
  currency text not null,
  debit numeric not null default 0,
  credit numeric not null default 0,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (debit >= 0 and credit >= 0),
  check (not (debit > 0 and credit > 0))
);

create table if not exists risk_decisions (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references platform_transactions(id) on delete set null,
  action text not null check (action in ('allow', 'review', 'reject', 'hold', 'freeze')),
  reason_code text not null,
  score int not null,
  case_required boolean not null default false,
  decided_by text not null default 'rules_v1',
  created_at timestamptz not null default now()
);

create table if not exists risk_cases (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references platform_transactions(id) on delete set null,
  decision_id uuid references risk_decisions(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'reviewing', 'approved', 'rejected', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  reason_code text not null,
  assigned_to text,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references merchants(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'paid', 'failed', 'held')),
  settlement_currency text not null,
  gross_amount numeric not null default 0,
  fee_amount numeric not null default 0,
  net_amount numeric not null default 0,
  period_start timestamptz,
  period_end timestamptz,
  provider_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists merchant_webhook_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references merchants(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  signature_valid boolean not null default false,
  status text not null default 'accepted' check (status in ('accepted', 'rejected', 'delivered', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_rails_corridor_idx
  on payment_rails(country, currency, direction, payment_method, enabled, health);
create index if not exists platform_transactions_user_created_idx
  on platform_transactions(user_id, created_at desc);
create index if not exists platform_transactions_merchant_created_idx
  on platform_transactions(merchant_id, created_at desc);
create index if not exists platform_transactions_status_idx
  on platform_transactions(status);
create index if not exists transaction_ledger_entries_transaction_idx
  on transaction_ledger_entries(transaction_id);
create index if not exists risk_cases_status_priority_idx
  on risk_cases(status, priority, created_at asc);
create index if not exists settlements_merchant_created_idx
  on settlements(merchant_id, created_at desc);
create index if not exists merchant_webhook_events_merchant_created_idx
  on merchant_webhook_events(merchant_id, created_at desc);

alter table merchants enable row level security;
alter table merchant_api_keys enable row level security;
alter table merchant_webhook_endpoints enable row level security;
alter table payment_rails enable row level security;
alter table platform_transactions enable row level security;
alter table transaction_ledger_entries enable row level security;
alter table risk_decisions enable row level security;
alter table risk_cases enable row level security;
alter table settlements enable row level security;
alter table merchant_webhook_events enable row level security;

create policy "merchants_service_write" on merchants for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
create policy "merchant_api_keys_service_write" on merchant_api_keys for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
create policy "merchant_webhook_endpoints_service_write" on merchant_webhook_endpoints for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
create policy "payment_rails_service_write" on payment_rails for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
create policy "platform_transactions_service_write" on platform_transactions for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
create policy "transaction_ledger_entries_service_write" on transaction_ledger_entries for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
create policy "risk_decisions_service_write" on risk_decisions for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
create policy "risk_cases_service_write" on risk_cases for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
create policy "settlements_service_write" on settlements for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
create policy "merchant_webhook_events_service_write" on merchant_webhook_events for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
