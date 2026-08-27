-- Recover the volume the old attribution rule discarded, and make the builder
-- fee we were actually paid reconcilable from the ledger.
--
-- Attribution used to test whether an order's client order ID began with the
-- app's prefix. That is chosen by whoever places the order, so it was forgeable
-- — but it also under-counted badly, because orders the app places without
-- carrying the prefix through, notably triggered take-profit and stop-loss
-- orders, earned nothing. On the first account examined, 99 of 108 fills had
-- paid a builder fee and only 24 carried the prefix.
--
-- Fixing the rule does not repay what was missed: every checkpoint cursor has
-- already advanced past those fills, and the cursor only moves forward. The
-- recovery is to wind the cursors back and let the worker re-read under the
-- corrected rule. That is safe precisely because ledger writes are
-- insert-on-conflict-do-nothing keyed by fill — a fill already granted is
-- ignored, and one wrongly skipped is granted for the first time.

/**
 * Wind season cursors back so the worker re-reads under the current rules.
 *
 * Deliberately a function rather than a one-off UPDATE: replaying history is
 * something that will be needed again whenever an attribution or grant rule
 * changes, and it should be an auditable, repeatable operation rather than a
 * statement somebody pastes into a console.
 *
 * Only ever moves a cursor backwards, and never past the season start — a
 * cursor ahead of the requested point is the normal case and is what makes the
 * replay bounded. Returns rows affected so a caller can tell a real rewind from
 * a no-op.
 */
create or replace function rewards_rewind_fill_cursors(
  p_season_id uuid,
  p_to timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_target timestamptz;
  v_rows integer;
begin
  select starts_at into v_start from seasons where id = p_season_id;
  if v_start is null then
    return 0;
  end if;

  -- Never earlier than the season began: fills before it belong to another
  -- season's accounting and re-reading them would be wasted exchange calls.
  v_target := greatest(coalesce(p_to, v_start), v_start);

  update rewards_fill_checkpoints
     set cursor_time = v_target,
         updated_at = now()
   where season_id = p_season_id
     and cursor_time > v_target;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

/**
 * Builder fees the ledger believes we earned, for one season.
 *
 * Every volume grant now records the exchange-reported builder fee for its
 * fill. Summing them gives a figure that can be checked against what
 * Hyperliquid reports for our builder address — the daily builder-fills export
 * or the referral-state total — which is the only way to confirm that the fees
 * behind these grants were paid to us rather than to some other builder.
 *
 * `fills_missing_fee` counts grants written before the fee was recorded. It
 * should fall to zero once the rewind has replayed the season, and a figure
 * that stays high means the replay did not finish.
 */
create or replace function rewards_builder_fee_totals(p_season_id uuid)
returns table (
  builder_fee_usd numeric,
  graded_fills bigint,
  fills_missing_fee bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum((l.metadata->>'builderFeeUsd')::numeric), 0)::numeric,
    count(*) filter (where l.metadata ? 'builderFeeUsd'),
    count(*) filter (where not (l.metadata ? 'builderFeeUsd'))
  from reward_ledger l
  where l.season_id = p_season_id
    and l.source = 'volume_xp'
    and l.status = 'posted';
$$;

-- security definer, and the rewind writes. Revoking from PUBLIC alone is not
-- enough: default privileges grant EXECUTE on new functions in `public` to anon
-- and authenticated by name. See 008_rewards_xp_accounting.sql.
revoke execute on function public.rewards_rewind_fill_cursors(uuid, timestamptz) from public;
revoke execute on function public.rewards_builder_fee_totals(uuid) from public;

revoke execute on function public.rewards_rewind_fill_cursors(uuid, timestamptz) from anon, authenticated;
revoke execute on function public.rewards_builder_fee_totals(uuid) from anon, authenticated;
