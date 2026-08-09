-- Hardening pass over the platform orchestration schema from 004.
--
-- 004 is left untouched in case it has already been applied somewhere. This
-- migration closes the gaps that let the API trust the client: risk inputs are
-- now stored server-side, transaction amounts are priced from reference rates,
-- idempotency is scoped to an owner, and the ledger is forced to balance.

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  target text;
begin
  foreach target in array array[
    'merchants',
    'merchant_webhook_endpoints',
    'payment_rails',
    'platform_transactions',
    'risk_cases',
    'settlements',
    'merchant_webhook_events'
  ]
  loop
    execute format(
      'drop trigger if exists %I on %I',
      target || '_set_updated_at', target
    );
    execute format(
      'create trigger %I before update on %I for each row execute function set_updated_at()',
      target || '_set_updated_at', target
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Screening results, maintained out of band by compliance.
--
-- The risk engine used to score whatever riskFlags the caller put in the
-- request body, which made sanctions and PEP screening opt-in by the party
-- being screened. Flags now come from here. A user with no row is treated as
-- unscreened, which routes to review rather than allow.
-- ---------------------------------------------------------------------------

create table if not exists user_risk_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  sanctions_match boolean not null default false,
  pep_match boolean not null default false,
  adverse_media boolean not null default false,
  chargeback_history boolean not null default false,
  blockchain_exposure boolean not null default false,
  screened_at timestamptz,
  provider_reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_risk_profiles_set_updated_at on user_risk_profiles;
create trigger user_risk_profiles_set_updated_at
  before update on user_risk_profiles
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Reference rates. /api/transactions used to accept cryptoAmount from the
-- request body and book it straight to the ledger; it is now derived here.
-- ---------------------------------------------------------------------------

create table if not exists fx_reference_rates (
  id uuid primary key default gen_random_uuid(),
  fiat_currency text not null,
  crypto_asset text not null,
  -- Units of crypto_asset per one unit of fiat_currency.
  rate numeric not null check (rate > 0),
  source text not null default 'manual',
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (fiat_currency, crypto_asset)
);

-- ---------------------------------------------------------------------------
-- Rails: corridor amount limits
-- ---------------------------------------------------------------------------

alter table payment_rails
  add column if not exists min_amount numeric not null default 0,
  add column if not exists max_amount numeric;

alter table payment_rails
  drop constraint if exists payment_rails_amount_bounds_check;
alter table payment_rails
  add constraint payment_rails_amount_bounds_check
  check (min_amount >= 0 and (max_amount is null or max_amount >= min_amount));

-- ---------------------------------------------------------------------------
-- Transactions: non-negative amounts, owner-scoped idempotency
-- ---------------------------------------------------------------------------

alter table platform_transactions
  drop constraint if exists platform_transactions_amounts_check;
alter table platform_transactions
  add constraint platform_transactions_amounts_check
  check (gross_amount >= 0 and fee_amount >= 0 and crypto_amount >= 0 and fee_amount <= gross_amount);

alter table platform_transactions
  drop constraint if exists platform_transactions_owner_check;
alter table platform_transactions
  add constraint platform_transactions_owner_check
  check (user_id is not null or merchant_id is not null);

-- A globally unique idempotency key let one caller collide with, or probe for,
-- another's key. Scope it to the owning user or merchant instead.
alter table platform_transactions
  drop constraint if exists platform_transactions_idempotency_key_key;

create unique index if not exists platform_transactions_owner_idempotency_idx
  on platform_transactions (coalesce(user_id, merchant_id), idempotency_key);

-- ---------------------------------------------------------------------------
-- Ledger: entries for a transaction must balance per currency.
--
-- Deferred so a multi-row insert is checked once at commit rather than after
-- each row.
-- ---------------------------------------------------------------------------

create or replace function assert_ledger_balanced()
returns trigger
language plpgsql
as $$
declare
  unbalanced record;
begin
  select transaction_id, currency, sum(debit) as debits, sum(credit) as credits
    into unbalanced
    from transaction_ledger_entries
   where transaction_id = coalesce(new.transaction_id, old.transaction_id)
   group by transaction_id, currency
  having sum(debit) <> sum(credit)
   limit 1;

  if found then
    raise exception
      'Ledger for transaction % does not balance in %: debits %, credits %',
      unbalanced.transaction_id, unbalanced.currency,
      unbalanced.debits, unbalanced.credits;
  end if;

  return null;
end;
$$;

drop trigger if exists transaction_ledger_entries_balanced on transaction_ledger_entries;
create constraint trigger transaction_ledger_entries_balanced
  after insert or update or delete on transaction_ledger_entries
  deferrable initially deferred
  for each row execute function assert_ledger_balanced();

-- ---------------------------------------------------------------------------
-- Settlements: net must follow from gross and fee
-- ---------------------------------------------------------------------------

alter table settlements
  drop constraint if exists settlements_net_amount_check;
alter table settlements
  add constraint settlements_net_amount_check
  check (net_amount = gross_amount - fee_amount);

-- ---------------------------------------------------------------------------
-- Webhooks: replay defence
-- ---------------------------------------------------------------------------

alter table merchant_webhook_events
  add column if not exists event_id text;

create unique index if not exists merchant_webhook_events_event_id_idx
  on merchant_webhook_events (event_id)
  where event_id is not null;

-- ---------------------------------------------------------------------------
-- Atomic transaction creation.
--
-- The API used to insert the transaction, then the ledger entries, then the
-- risk decision as three separate PostgREST calls. A failure between them left
-- a transaction with no ledger or no recorded decision. One function, one
-- transaction, and a conflicting idempotency key returns the existing row
-- instead of raising.
-- ---------------------------------------------------------------------------

create or replace function create_platform_transaction(
  p_idempotency_key text,
  p_user_id uuid,
  p_merchant_id uuid,
  p_direction text,
  p_status text,
  p_country text,
  p_fiat_currency text,
  p_crypto_asset text,
  p_gross_amount numeric,
  p_fee_amount numeric,
  p_crypto_amount numeric,
  p_payment_method text,
  p_rail_id uuid,
  p_provider text,
  p_provider_order_id text,
  p_risk_action text,
  p_risk_reason_code text,
  p_risk_score int,
  p_risk_case_required boolean,
  p_metadata jsonb,
  p_ledger_entries jsonb
)
returns platform_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transaction platform_transactions;
  v_decision_id uuid;
  v_entry jsonb;
begin
  select * into v_transaction
    from platform_transactions
   where idempotency_key = p_idempotency_key
     and coalesce(user_id, merchant_id) = coalesce(p_user_id, p_merchant_id);

  if found then
    return v_transaction;
  end if;

  insert into platform_transactions (
    idempotency_key, user_id, merchant_id, direction, status, country,
    fiat_currency, crypto_asset, gross_amount, fee_amount, crypto_amount,
    payment_method, rail_id, provider, provider_order_id, risk_action,
    risk_reason_code, metadata
  ) values (
    p_idempotency_key, p_user_id, p_merchant_id, p_direction, p_status, p_country,
    p_fiat_currency, p_crypto_asset, p_gross_amount, p_fee_amount, p_crypto_amount,
    p_payment_method, p_rail_id, p_provider, p_provider_order_id, p_risk_action,
    p_risk_reason_code, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (coalesce(user_id, merchant_id), idempotency_key) do nothing
  returning * into v_transaction;

  -- Lost the race: another request inserted the same key first.
  if v_transaction is null then
    select * into v_transaction
      from platform_transactions
     where idempotency_key = p_idempotency_key
       and coalesce(user_id, merchant_id) = coalesce(p_user_id, p_merchant_id);
    return v_transaction;
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(p_ledger_entries, '[]'::jsonb))
  loop
    insert into transaction_ledger_entries (
      transaction_id, account, currency, debit, credit, idempotency_key, metadata
    ) values (
      v_transaction.id,
      v_entry->>'account',
      v_entry->>'currency',
      coalesce((v_entry->>'debit')::numeric, 0),
      coalesce((v_entry->>'credit')::numeric, 0),
      v_transaction.id || ':' || (v_entry->>'account') || ':' || (v_entry->>'currency'),
      coalesce(v_entry->'metadata', '{}'::jsonb)
    )
    on conflict (idempotency_key) do nothing;
  end loop;

  insert into risk_decisions (transaction_id, action, reason_code, score, case_required)
  values (v_transaction.id, p_risk_action, p_risk_reason_code, p_risk_score, p_risk_case_required)
  returning id into v_decision_id;

  if p_risk_case_required then
    insert into risk_cases (transaction_id, decision_id, status, priority, reason_code)
    values (
      v_transaction.id,
      v_decision_id,
      'open',
      case when p_risk_action in ('hold', 'freeze') then 'high' else 'normal' end,
      p_risk_reason_code
    );
  end if;

  return v_transaction;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reversal entries. 004 recorded a zero-value memo row for failed and reversed
-- transactions and left the original debits and credits booked.
-- ---------------------------------------------------------------------------

create or replace function reverse_platform_transaction(
  p_transaction_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('failed', 'reversed') then
    raise exception 'reverse_platform_transaction expects failed or reversed, got %', p_status;
  end if;

  insert into transaction_ledger_entries (
    transaction_id, account, currency, debit, credit, idempotency_key, metadata
  )
  select
    original.transaction_id,
    original.account,
    original.currency,
    original.credit,
    original.debit,
    original.idempotency_key || ':reversal',
    jsonb_build_object('reversalOf', original.id, 'status', p_status)
  from transaction_ledger_entries original
  where original.transaction_id = p_transaction_id
    and original.idempotency_key not like '%:reversal'
  on conflict (idempotency_key) do nothing;

  update platform_transactions
     set status = p_status
   where id = p_transaction_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS for the new tables. Consistent with 004: everything goes through the
-- service role.
-- ---------------------------------------------------------------------------

alter table user_risk_profiles enable row level security;
alter table fx_reference_rates enable row level security;

drop policy if exists "user_risk_profiles_service_write" on user_risk_profiles;
create policy "user_risk_profiles_service_write" on user_risk_profiles for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

drop policy if exists "fx_reference_rates_service_write" on fx_reference_rates;
create policy "fx_reference_rates_service_write" on fx_reference_rates for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

create index if not exists platform_transactions_user_recent_idx
  on platform_transactions (user_id, created_at desc)
  where user_id is not null;
