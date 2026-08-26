-- One question, one answer: is the rewards program telling the truth?
--
-- Every fact needed to answer that already exists — checkpoint cursors, the
-- ledger, the projection, held cash rows — but only as six unrelated queries
-- somebody has to know to run and know how to interpret. That is not a
-- reconciliation surface; it is a set of ingredients. Nobody runs it, so drift
-- is found by a user noticing their XP is wrong.
--
-- This returns a single row that says what is wrong and how badly, computed the
-- same way every time so two people reading it reach the same conclusion.
--
-- It never writes. A reconciliation tool that mutates by default cannot be run
-- to answer "is anything wrong?", because running it destroys the evidence of
-- what was wrong. Repair is `rewards_rebuild_xp_projection`, called
-- deliberately and separately.

/**
 * Program health for one season.
 *
 * `stale` and `failing` thresholds are parameters rather than constants because
 * "too old" depends on the cron interval, which is a deployment decision the
 * database should not be asserting.
 *
 * Note what each count is for:
 *
 *   * `wallets_without_checkpoint` is a coverage gap — a user who can trade but
 *     whom ingestion has never been told about. It is the only failure here
 *     that is silent from the inside: every other count describes work that
 *     happened badly, this one describes work that never started.
 *   * `retention_risk_accounts` is not an error. The data ingested is correct;
 *     what is lost is the ability to prove it is complete.
 *   * `held_cash_*` should stay flat. A rising count means something is still
 *     creating cash entitlements while the program is XP-only.
 */
create or replace function rewards_reconciliation_report(
  p_season_id uuid,
  p_stale_after_seconds int default 1800,
  p_failing_after_attempts int default 3
)
returns table (
  accounts_total bigint,
  accounts_never_synced bigint,
  accounts_stale bigint,
  accounts_failing bigint,
  accounts_retention_risk bigint,
  max_ingestion_lag_seconds numeric,
  oldest_cursor_time timestamptz,
  fills_ingested bigint,
  wallets_without_checkpoint bigint,
  drift_accounts bigint,
  drift_total_xp numeric,
  held_cash_rows bigint,
  held_cash_amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with checkpoints as (
    select * from rewards_fill_checkpoints where season_id = p_season_id
  ),
  drift as (
    select * from rewards_xp_projection_drift(p_season_id)
  ),
  held as (
    select count(*) as rows, coalesce(sum(amount), 0)::numeric as amount
    from reward_ledger
    where status = 'held'
  )
  select
    (select count(*) from checkpoints),
    (select count(*) from checkpoints where last_success_at is null),
    (select count(*) from checkpoints
      where last_success_at is not null
        and last_success_at < now() - make_interval(secs => p_stale_after_seconds)),
    (select count(*) from checkpoints where consecutive_failures >= p_failing_after_attempts),
    (select count(*) from checkpoints where retention_risk),
    -- Lag is measured from the cursor, not from last_success_at: a checkpoint
    -- that succeeds every ten minutes while its cursor sits a month back is
    -- running perfectly and still has a month of unread history.
    (select coalesce(max(extract(epoch from (now() - cursor_time))), 0)::numeric from checkpoints),
    (select min(cursor_time) from checkpoints),
    (select coalesce(sum(fills_ingested), 0)::bigint from checkpoints),
    (select count(*) from users u
      where u.wallet_address is not null
        and not exists (
          select 1 from checkpoints c
          where c.user_id = u.id and c.wallet_address = u.wallet_address
        )),
    (select count(*) from drift),
    (select coalesce(sum(abs(drift.drift)), 0)::numeric from drift),
    (select rows from held),
    (select amount from held);
$$;

-- security definer and it reads across every account. Revoking from PUBLIC
-- alone is not enough: default privileges grant EXECUTE on new functions in
-- `public` to anon and authenticated by name. See 008_rewards_xp_accounting.sql.
revoke execute on function public.rewards_reconciliation_report(uuid, int, int) from public;
revoke execute on function public.rewards_reconciliation_report(uuid, int, int) from anon, authenticated;
