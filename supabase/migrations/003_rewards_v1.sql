alter table weekly_rewards
  add column if not exists raffle_rank int,
  add column if not exists raffle_eligible boolean default false,
  add column if not exists raffle_prize numeric default 0,
  add column if not exists drawn_at timestamptz;

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

alter table reward_ledger enable row level security;

create policy "reward_ledger_select_own" on reward_ledger for select
  using (
    user_id in (
      select id from users
      where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'
    )
  );

create policy "reward_ledger_service_write" on reward_ledger for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
