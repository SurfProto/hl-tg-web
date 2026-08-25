-- Checkpointed fill ingestion, so a complete season does not depend on someone
-- opening a page.
--
-- Fills were fetched with `userFills`, which returns only the latest 2,000, and
-- only while a user had the Points screen open. Hyperliquid's time-based
-- endpoint returns at most 2,000 fills per response and exposes only the latest
-- 10,000 overall, so a user-driven scan could not reconstruct a season even in
-- principle: a trader past 2,000 fills silently lost the older ones, and a
-- trader who never opened the page earned nothing at all.
--
-- A checkpoint records how far ingestion has provably got for one
-- (user, season, wallet). It is keyed on all three because all three change
-- independently: a season boundary starts a fresh window, and a wallet change
-- means a different account's history entirely — neither may inherit the
-- other's cursor.

create table if not exists rewards_fill_checkpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  wallet_address text not null,

  -- Every fill at or before this instant has been ingested and its ledger rows
  -- committed. The next window starts here. Advanced only after the ledger
  -- write for the window succeeds, so a crash re-reads a window rather than
  -- skipping it; the ledger's idempotency key makes the replay free.
  cursor_time timestamptz not null,

  last_success_at timestamptz,
  last_attempt_at timestamptz,

  -- Machine-readable class only, never upstream or database error text. This
  -- is surfaced in reconciliation output and must not leak an exchange
  -- response or a Postgres message.
  last_error_code text,
  consecutive_failures int not null default 0,

  -- Set when completeness stops being provable from the API: fills denser than
  -- a minimal window can express, or a history long enough to fall past the
  -- 10,000-fill ceiling. Not an error -- the data ingested is still correct --
  -- but reconciliation must stop claiming the season is fully reconstructed.
  retention_risk boolean not null default false,

  fills_ingested bigint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, season_id, wallet_address)
);

alter table rewards_fill_checkpoints enable row level security;

-- Deny-all for anon and authenticated; the worker holds the service role, which
-- bypasses RLS. Matches every other rewards projection table.

-- Drives the batch claim below: due accounts first, never-synced ones ahead of
-- stale ones.
create index if not exists rewards_fill_checkpoints_due_idx
  on rewards_fill_checkpoints(last_attempt_at nulls first);

/**
 * Claim a bounded batch of accounts to sync, marking them attempted.
 *
 * Claiming inside one statement is what keeps two overlapping worker runs from
 * fetching the same account concurrently and racing each other's cursor
 * advance. `for update skip locked` means a second worker takes the next
 * available rows instead of blocking behind the first.
 *
 * An account is due when it has never been attempted, or its last attempt is
 * older than p_stale_after_seconds -- which also releases a batch abandoned by
 * a worker that crashed mid-run, rather than parking it forever.
 */
create or replace function rewards_claim_fill_sync_batch(
  p_limit int default 25,
  p_stale_after_seconds int default 900
)
returns table (
  checkpoint_id uuid,
  user_id uuid,
  season_id uuid,
  wallet_address text,
  cursor_time timestamptz,
  fills_ingested bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select c.id
    from rewards_fill_checkpoints c
    where c.last_attempt_at is null
       or c.last_attempt_at < now() - make_interval(secs => p_stale_after_seconds)
    order by c.last_attempt_at nulls first
    limit greatest(1, least(p_limit, 200))
    for update skip locked
  )
  update rewards_fill_checkpoints c
     set last_attempt_at = now(),
         updated_at = now()
    from due
   where c.id = due.id
  returning c.id, c.user_id, c.season_id, c.wallet_address, c.cursor_time, c.fills_ingested;
end;
$$;

/**
 * Record the outcome of one account's sync.
 *
 * The cursor only ever moves forward, and only when the caller passes one --
 * a failed run reports its failure without disturbing where ingestion had
 * provably reached. `greatest` makes a late or out-of-order success unable to
 * rewind a cursor another run already advanced.
 */
create or replace function rewards_complete_fill_sync(
  p_checkpoint_id uuid,
  p_cursor_time timestamptz default null,
  p_fills_ingested int default 0,
  p_retention_risk boolean default null,
  p_error_code text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update rewards_fill_checkpoints
     set cursor_time = greatest(cursor_time, coalesce(p_cursor_time, cursor_time)),
         fills_ingested = fills_ingested + greatest(0, coalesce(p_fills_ingested, 0)),
         retention_risk = coalesce(p_retention_risk, retention_risk),
         last_error_code = p_error_code,
         consecutive_failures =
           case when p_error_code is null then 0 else consecutive_failures + 1 end,
         last_success_at =
           case when p_error_code is null then now() else last_success_at end,
         updated_at = now()
   where id = p_checkpoint_id;
$$;

/**
 * Create checkpoints for every wallet-holding user in a season that lacks one.
 *
 * Set-based rather than a call per user: the worker would otherwise issue one
 * round trip per account just to discover there was nothing to do. Users with
 * no wallet are skipped -- there is no account to read fills from -- and they
 * pick up a checkpoint on the first run after they connect one.
 */
create or replace function rewards_backfill_fill_checkpoints(
  p_season_id uuid,
  p_start_at timestamptz,
  p_limit int default 500
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer;
begin
  with candidates as (
    select u.id as user_id, u.wallet_address
    from users u
    where u.wallet_address is not null
    order by u.created_at
    limit greatest(1, least(p_limit, 5000))
  ),
  inserted as (
    insert into rewards_fill_checkpoints (user_id, season_id, wallet_address, cursor_time)
    select c.user_id, p_season_id, c.wallet_address, p_start_at
    from candidates c
    on conflict (user_id, season_id, wallet_address) do nothing
    returning 1
  )
  select count(*) into v_created from inserted;

  return v_created;
end;
$$;

-- These are security definer. Revoking from PUBLIC alone is not enough here:
-- default privileges grant EXECUTE on new functions in `public` to anon and
-- authenticated by name, so each function is created carrying `anon=X/postgres`
-- in its ACL and survives a PUBLIC revoke untouched. See the note in
-- 008_rewards_xp_accounting.sql.
revoke execute on function public.rewards_claim_fill_sync_batch(int, int) from public;
revoke execute on function public.rewards_complete_fill_sync(uuid, timestamptz, int, boolean, text) from public;
revoke execute on function public.rewards_backfill_fill_checkpoints(uuid, timestamptz, int) from public;

revoke execute on function public.rewards_claim_fill_sync_batch(int, int) from anon, authenticated;
revoke execute on function public.rewards_complete_fill_sync(uuid, timestamptz, int, boolean, text) from anon, authenticated;
revoke execute on function public.rewards_backfill_fill_checkpoints(uuid, timestamptz, int) from anon, authenticated;
