create table if not exists notification_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  channel text not null check (channel in ('telegram')),
  target text not null,
  status text not null default 'active' check (status in ('active', 'blocked', 'invalid')),
  last_error_code text,
  last_error_message text,
  last_delivered_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(user_id, channel)
);

create table if not exists notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  channel text not null check (channel in ('telegram')),
  topic text not null check (topic in ('liquidation_risk', 'order_fill', 'usdc_deposit')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'retry', 'failed', 'suppressed')),
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notification_runtime_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  state_key text not null,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(user_id, state_key)
);

create index if not exists notification_events_channel_status_next_attempt_idx
  on notification_events(channel, status, next_attempt_at);

create index if not exists notification_events_user_created_idx
  on notification_events(user_id, created_at desc);

create index if not exists notification_runtime_state_user_key_idx
  on notification_runtime_state(user_id, state_key);

alter table notification_channels enable row level security;
alter table notification_events enable row level security;
alter table notification_runtime_state enable row level security;

create policy "notification_channels_select_own"
  on notification_channels for select
  using (
    user_id in (
      select id from users
      where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'
    )
  );

create policy "notification_channels_service_write"
  on notification_channels for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

create policy "notification_events_select_own"
  on notification_events for select
  using (
    user_id in (
      select id from users
      where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'
    )
  );

create policy "notification_events_service_write"
  on notification_events for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

create policy "notification_runtime_state_service_write"
  on notification_runtime_state for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
