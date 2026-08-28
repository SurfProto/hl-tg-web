-- Hyperliquid's own record of the fills that paid our builder address.
--
-- Volume XP is granted on `builderFee > 0` from `userFills`. That field says a
-- trade paid *a* builder; it does not say it paid *us*. A user trading the same
-- Hyperliquid account through a different app, with a different builder,
-- produces fills indistinguishable from ours at that endpoint — and we credit
-- them. Migration 018 called this the observed tier and named the export as
-- what would verify it. This is that export.
--
-- It is published per builder address, so a row here is Hyperliquid stating the
-- fee came to us. It arrives once a day and not promptly: a day's file answers
-- 403 until it exists. So it reconciles rather than grants. Making it
-- authoritative would delay every user's XP by up to a day, which for a program
-- whose whole point is same-session feedback costs more than the volume it
-- would stop over-crediting.

create table if not exists builder_fills (
  id uuid primary key default gen_random_uuid(),

  -- The UTC day whose export this row came from, as the file is keyed.
  day date not null,

  -- `{day}:{line}`. The export carries no fill id, hash or order id, so there
  -- is nothing intrinsic to key on. A natural key of (time, coin, price, size,
  -- fee) would collapse two genuine fills of one order that filled at one price
  -- inside one second. A settled day's file does not change, which makes its
  -- line numbering as stable as anything in it.
  row_key text not null unique,

  -- Lowercase, as the export writes it. Joined to users.wallet_address
  -- case-insensitively.
  wallet_address text not null,

  occurred_at timestamptz not null,
  coin text not null,
  side text not null,
  px numeric not null,
  sz numeric not null,
  builder_fee_usd numeric not null,

  -- Triggered take-profit and stop-loss orders. Worth keeping: these are
  -- exactly the fills the old cloid-prefix attribution missed, and both rows in
  -- the first day examined included one.
  is_trigger boolean not null default false,

  created_at timestamptz not null default now()
);

alter table builder_fills enable row level security;

-- No policies: deny-all for anon and authenticated, service role bypasses. This
-- is per-wallet trading history and belongs nowhere near a client read.

create index if not exists builder_fills_wallet_time_idx
  on builder_fills(wallet_address, occurred_at);
create index if not exists builder_fills_day_idx on builder_fills(day);

/**
 * Which days have been ingested, and which are still waiting.
 *
 * Days are tracked explicitly rather than inferred from the presence of rows,
 * because a genuinely empty trading day and a day nobody fetched look identical
 * in `builder_fills` — and the difference between them is the difference
 * between "we earned nothing" and "we do not know".
 */
create table if not exists builder_fill_days (
  day date primary key,

  -- ingested: the file was read and its rows stored.
  -- unpublished: Hyperliquid has not written the file yet; retry later.
  -- unavailable: something went wrong; last_error_code says what.
  status text not null check (status in ('ingested', 'unpublished', 'unavailable')),

  rows_ingested int not null default 0,
  malformed_rows int not null default 0,
  fee_usd numeric not null default 0,
  attempts int not null default 0,
  last_error_code text,
  fetched_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table builder_fill_days enable row level security;

/**
 * Record the outcome of one day's fetch.
 *
 * A day already ingested is never downgraded. Re-running a settled day is a
 * no-op rather than a way to lose its record, and a later 403 — which is what a
 * missing key answers, and therefore what a transient bucket problem also
 * answers — cannot reopen a day that was already read.
 */
create or replace function rewards_record_builder_fill_day(
  p_day date,
  p_status text,
  p_rows int default 0,
  p_malformed int default 0,
  p_fee_usd numeric default 0,
  p_error_code text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into builder_fill_days (
    day, status, rows_ingested, malformed_rows, fee_usd, attempts, last_error_code, fetched_at
  )
  values (
    p_day, p_status, coalesce(p_rows, 0), coalesce(p_malformed, 0), coalesce(p_fee_usd, 0), 1,
    p_error_code, case when p_status = 'ingested' then now() end
  )
  on conflict (day) do update
     set status = case when builder_fill_days.status = 'ingested' then 'ingested' else excluded.status end,
         rows_ingested = case when builder_fill_days.status = 'ingested'
                              then builder_fill_days.rows_ingested else excluded.rows_ingested end,
         malformed_rows = case when builder_fill_days.status = 'ingested'
                               then builder_fill_days.malformed_rows else excluded.malformed_rows end,
         fee_usd = case when builder_fill_days.status = 'ingested'
                        then builder_fill_days.fee_usd else excluded.fee_usd end,
         attempts = builder_fill_days.attempts + 1,
         last_error_code = excluded.last_error_code,
         fetched_at = coalesce(excluded.fetched_at, builder_fill_days.fetched_at),
         updated_at = now();
$$;

/**
 * The days still worth fetching, oldest first.
 *
 * Never today: the file for a day in progress does not exist, and asking for it
 * every run would burn the whole budget on a guaranteed 403. `unpublished` days
 * are retried because Hyperliquid publishes late, not never.
 */
create or replace function rewards_pending_builder_fill_days(
  p_from date,
  p_limit int default 7
)
returns table (day date)
language sql
stable
security definer
set search_path = public
as $$
  select d::date
  from generate_series(p_from, (now() at time zone 'utc')::date - 1, interval '1 day') d
  where not exists (
    select 1 from builder_fill_days f
    where f.day = d::date and f.status = 'ingested'
  )
  order by d
  limit greatest(1, least(p_limit, 60));
$$;

/**
 * What the ledger claims we earned, against what Hyperliquid says we were paid.
 *
 * Compared only over days actually ingested, because a day nobody fetched would
 * otherwise read as a day we earned nothing and turn every gap into a fake
 * discrepancy.
 *
 * `unverified_fee_usd` above zero is the number that matters: fees the grant
 * path credited that the export does not corroborate. Some of it is timing at
 * the day boundary; a persistent balance is volume routed through somebody
 * else's builder that we paid XP for.
 */
create or replace function rewards_builder_fee_reconciliation(p_season_id uuid)
returns table (
  days_ingested bigint,
  days_pending bigint,
  ledger_fee_usd numeric,
  verified_fee_usd numeric,
  unverified_fee_usd numeric,
  unmatched_wallets bigint,
  undated_grants bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with ingested as (
    select day from builder_fill_days where status = 'ingested'
  ),
  ledger as (
    select coalesce(sum((l.metadata->>'builderFeeUsd')::numeric), 0) as fee_usd
    from reward_ledger l
    where l.season_id = p_season_id
      and l.source = 'volume_xp'
      and l.status = 'posted'
      and l.metadata ? 'builderFeeUsd'
      -- The fill's own instant, not when the grant row was written. A backfill
      -- can write a grant days after the trade, and dating it by created_at
      -- would compare it against the wrong day's export.
      and l.metadata ? 'occurredAt'
      and ((l.metadata->>'occurredAt')::timestamptz at time zone 'utc')::date
            in (select day from ingested)
  ),
  verified as (
    select coalesce(sum(b.builder_fee_usd), 0) as fee_usd
    from builder_fills b
    join users u on lower(u.wallet_address) = b.wallet_address
    where b.day in (select day from ingested)
  )
  select
    (select count(*) from ingested),
    (select count(*) from builder_fill_days where status <> 'ingested'),
    (select fee_usd from ledger),
    (select fee_usd from verified),
    (select fee_usd from ledger) - (select fee_usd from verified),
    -- Fills the export attributes to us from a wallet we have no user for.
    -- Not an error: somebody can route through our builder code without ever
    -- having been our user. Worth seeing rather than silently dropping.
    (select count(distinct b.wallet_address)
       from builder_fills b
      where b.day in (select day from ingested)
        and not exists (
          select 1 from users u where lower(u.wallet_address) = b.wallet_address
        )),
    -- Grants written before the fill's instant was recorded in metadata. They
    -- cannot be placed on a day, so they sit outside the comparison entirely
    -- rather than silently deflating it. Falls to zero as the season turns over.
    (select count(*)
       from reward_ledger l
      where l.season_id = p_season_id
        and l.source = 'volume_xp'
        and l.status = 'posted'
        and not (l.metadata ? 'occurredAt'));
$$;

-- security definer, and one of these writes. Revoking from PUBLIC alone is not
-- enough: default privileges grant EXECUTE on new functions in `public` to anon
-- and authenticated by name. See 008_rewards_xp_accounting.sql.
revoke execute on function public.rewards_record_builder_fill_day(date, text, int, int, numeric, text) from public;
revoke execute on function public.rewards_pending_builder_fill_days(date, int) from public;
revoke execute on function public.rewards_builder_fee_reconciliation(uuid) from public;

revoke execute on function public.rewards_record_builder_fill_day(date, text, int, int, numeric, text) from anon, authenticated;
revoke execute on function public.rewards_pending_builder_fill_days(date, int) from anon, authenticated;
revoke execute on function public.rewards_builder_fee_reconciliation(uuid) from anon, authenticated;
