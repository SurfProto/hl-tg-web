-- Funding, as money arriving in the Hyperliquid account rather than as an
-- onramp order succeeding.
--
-- Every funding rule in the program read `onramp_orders`: the first-deposit
-- quest, the come-back-in-7-days quest, the referral `funded` rung. That table
-- records one thing only — a card payment we brokered. A user who already held
-- USDC and bridged it in themselves, or who moved funds from another
-- Hyperliquid account, had funded nothing as far as the program was concerned.
-- For an app whose target user is a trader who already uses Hyperliquid, that
-- excluded the most likely way of arriving.
--
-- The account's own ledger is the better source, and it is a superset: an
-- onramp purchase lands on it as a `deposit` like any other bridge transfer, so
-- reading the ledger does not lose the onramp, it subsumes it.
--
-- What counts is money crossing the account boundary, which is a narrower set
-- than "every ledger line". Hyperliquid reports internal reshuffling on the
-- same feed — `accountClassTransfer` between spot and perp, vault movements,
-- transfers between an account and its own sub-accounts, and self-`send`s where
-- sender and recipient are the same address. On the wallet this was built
-- against, eleven of seventeen events were spot/perp shuffles of the same
-- fifteen dollars. Counting those would make one deposit look like a dozen.
--
-- The classification lives in the worker (`_lib/deposits.ts`) and arrives here
-- as `is_external`, so the rule has one home rather than two. The raw type and
-- amount are stored alongside it, which is what makes a future change to the
-- rule a recomputation rather than a re-fetch.

create table if not exists hl_deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,

  -- The address the ledger was read for. Kept per row rather than only on the
  -- checkpoint: a user who changes wallet keeps the history of the old one, and
  -- rows must stay attributable to the account they actually came from.
  wallet_address text not null,

  -- `{hash}:{time}:{type}`. Hyperliquid gives no id of its own, and this is
  -- what makes re-reading a window free — the same event upserts onto itself.
  event_key text not null,

  -- Verbatim from the exchange, so the `is_external` rule can be re-derived
  -- without asking Hyperliquid again.
  event_type text not null,

  -- Signed, and meaningful only where `is_external`: positive for money
  -- arriving, negative for money leaving. Non-external rows carry the
  -- magnitude for readability and never enter any sum.
  amount_usd numeric not null,

  -- Whether this event moved USDC across the account boundary. The single
  -- predicate every funding rule below is written against.
  is_external boolean not null,

  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),

  unique (user_id, event_key)
);

alter table hl_deposits enable row level security;

-- No policies: deny-all for anon and authenticated. The worker holds the
-- service role, which bypasses RLS. This is somebody's deposit and withdrawal
-- history and belongs nowhere near a client-reachable read.

create index if not exists hl_deposits_user_time_idx
  on hl_deposits(user_id, occurred_at);

/**
 * How far each account's ledger has provably been read.
 *
 * Keyed on (user, wallet) and not on season, because funding is a fact about a
 * person's account rather than about a scoring period: a user who funded in
 * March is still funded in August, and a season boundary must not make them
 * look new. The cursor starts at the epoch so the first run reads the account's
 * whole history — Hyperliquid retains this feed in full, unlike fills, and the
 * volumes involved are tens of events rather than thousands.
 */
create table if not exists rewards_deposit_checkpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  wallet_address text not null,

  cursor_time timestamptz not null default 'epoch',
  last_success_at timestamptz,
  last_attempt_at timestamptz,

  -- Machine-readable class only, never upstream error text; this reaches the
  -- reconciliation surface.
  last_error_code text,
  consecutive_failures int not null default 0,
  events_ingested bigint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, wallet_address)
);

alter table rewards_deposit_checkpoints enable row level security;

/**
 * The cursor to read this account's ledger from, creating it on first sight.
 *
 * Returns rather than claims. The fill batch claim exists to stop two workers
 * racing one cursor forward; here a race costs a duplicate read whose writes
 * all collide on `event_key` and whose cursor advance is a `greatest`, so
 * paying for a lock would buy nothing.
 */
create or replace function rewards_open_deposit_sync(
  p_user_id uuid,
  p_wallet_address text
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cursor timestamptz;
begin
  insert into rewards_deposit_checkpoints (user_id, wallet_address)
  values (p_user_id, p_wallet_address)
  on conflict (user_id, wallet_address) do nothing;

  update rewards_deposit_checkpoints
     set last_attempt_at = now(),
         updated_at = now()
   where user_id = p_user_id
     and wallet_address = p_wallet_address
  returning cursor_time into v_cursor;

  return v_cursor;
end;
$$;

/**
 * Record one account's ledger read.
 *
 * The cursor advances only when the caller passes one, and only forwards, so a
 * failed read reports itself without disturbing proven progress and a late run
 * cannot rewind a cursor another has already moved.
 */
create or replace function rewards_complete_deposit_sync(
  p_user_id uuid,
  p_wallet_address text,
  p_cursor_time timestamptz default null,
  p_events_ingested int default 0,
  p_error_code text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update rewards_deposit_checkpoints
     set cursor_time = greatest(cursor_time, coalesce(p_cursor_time, cursor_time)),
         events_ingested = events_ingested + greatest(0, coalesce(p_events_ingested, 0)),
         last_error_code = p_error_code,
         consecutive_failures =
           case when p_error_code is null then 0 else consecutive_failures + 1 end,
         last_success_at =
           case when p_error_code is null then now() else last_success_at end,
         updated_at = now()
   where user_id = p_user_id
     and wallet_address = p_wallet_address;
$$;

/**
 * The referral funnel, with `funded` re-read from the account ledger.
 *
 * Replaces the version in 019, which asked whether an onramp order had
 * succeeded. Two things change beyond the source.
 *
 * Funding is now cumulative rather than per-transaction. A user who bridged
 * thirty dollars twice had funded sixty dollars and the old rule saw neither,
 * because it tested single orders against the threshold. The rung now fires
 * when the account's *running* net inflow crosses the bar, and `funded_at` is
 * the moment it first did.
 *
 * And the holding period now holds something. It used to test only that the
 * deposit was old, which a deposit-trigger-withdraw cycle passes as long as the
 * attacker is patient: fund, wait three days, collect, withdraw, repeat with
 * the next account. Requiring the net to be above the bar *now* as well as
 * seventy-two hours ago means the money has to actually still be there. Trading
 * losses do not touch this — the ledger is non-funding, so it moves only when
 * somebody deposits or withdraws — so a user who funded and then lost it is
 * still funded, which is correct. Only taking the money back out un-funds them.
 */
create or replace function rewards_referral_milestones(
  p_funded_min_usd numeric default 50,
  p_funded_hold_hours int default 72,
  p_traded_min_orders int default 2,
  p_traded_min_fee_usd numeric default 0.10,
  p_traded_within_days int default 30,
  p_retained_min_days int default 3,
  p_retained_min_fee_usd numeric default 1.00,
  p_retained_late_from_day int default 22,
  p_retained_late_to_day int default 30
)
returns table (
  referrer_id uuid,
  referee_id uuid,
  milestone text,
  qualified_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with referred as (
    select u.id as referee_id, u.referred_by as referrer_id
    from users u
    where u.referred_by is not null
      -- Self-referral cannot be reached through the apply mutation, but a rung
      -- that pays real XP should not depend on that staying true.
      and u.referred_by <> u.id
  ),
  -- The account balance as the ledger saw it after each external event.
  running as (
    select
      d.user_id,
      d.occurred_at,
      sum(d.amount_usd) over (
        partition by d.user_id
        order by d.occurred_at, d.id
        rows between unbounded preceding and current row
      ) as net_usd
    from hl_deposits d
    where d.is_external
  ),
  -- Where the account stands today. A withdrawal that took the balance back
  -- below the bar removes the rung rather than leaving it earned.
  net_now as (
    select user_id, sum(amount_usd) as net_usd
    from hl_deposits
    where is_external
    group by user_id
  ),
  funded as (
    select
      r.referee_id,
      min(w.occurred_at) as funded_at
    from referred r
    join running w on w.user_id = r.referee_id
    join net_now n on n.user_id = r.referee_id
    where w.net_usd >= p_funded_min_usd
      and w.occurred_at <= now() - make_interval(hours => p_funded_hold_hours)
      and n.net_usd >= p_funded_min_usd
    group by r.referee_id
  ),
  -- Trading that paid us. The order id is the third segment of the fill key
  -- (tid:hash:oid), so a single order filling in pieces counts once.
  trades as (
    select
      l.user_id as referee_id,
      l.created_at,
      split_part(l.metadata->>'fillKey', ':', 3) as order_id,
      coalesce((l.metadata->>'builderFeeUsd')::numeric, 0) as fee
    from reward_ledger l
    where l.source = 'volume_xp'
      and l.status = 'posted'
      and l.metadata ? 'fillKey'
  ),
  traded as (
    select
      f.referee_id,
      max(t.created_at) as qualified_at
    from funded f
    join trades t
      on t.referee_id = f.referee_id
     and t.created_at >= f.funded_at
     and t.created_at < f.funded_at + make_interval(days => p_traded_within_days)
    group by f.referee_id
    having count(distinct t.order_id) >= p_traded_min_orders
       and sum(t.fee) >= p_traded_min_fee_usd
  ),
  retained as (
    select
      f.referee_id,
      max(t.created_at) as qualified_at
    from funded f
    join trades t on t.referee_id = f.referee_id and t.created_at >= f.funded_at
    group by f.referee_id
    having count(distinct (t.created_at at time zone 'utc')::date) >= p_retained_min_days
       and sum(t.fee) >= p_retained_min_fee_usd
       -- The rung that cannot be compressed into one afternoon: something has
       -- to happen late in the month.
       and count(*) filter (
             where t.created_at >= f.funded_at + make_interval(days => p_retained_late_from_day)
               and t.created_at < f.funded_at + make_interval(days => p_retained_late_to_day + 1)
           ) > 0
  )
  select r.referrer_id, r.referee_id, 'funded'::text, f.funded_at
  from referred r join funded f on f.referee_id = r.referee_id
  union all
  select r.referrer_id, r.referee_id, 'traded'::text, t.qualified_at
  from referred r join traded t on t.referee_id = r.referee_id
  union all
  select r.referrer_id, r.referee_id, 'retained'::text, x.qualified_at
  from referred r join retained x on x.referee_id = r.referee_id;
$$;

-- security definer, and one of these writes. Revoking from PUBLIC alone is not
-- enough: default privileges grant EXECUTE on new functions in `public` to anon
-- and authenticated by name. See 008_rewards_xp_accounting.sql.
revoke execute on function public.rewards_open_deposit_sync(uuid, text) from public;
revoke execute on function public.rewards_complete_deposit_sync(uuid, text, timestamptz, int, text) from public;

revoke execute on function public.rewards_open_deposit_sync(uuid, text) from anon, authenticated;
revoke execute on function public.rewards_complete_deposit_sync(uuid, text, timestamptz, int, text) from anon, authenticated;
