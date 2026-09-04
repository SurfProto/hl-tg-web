-- Renamed 024_ → 025_: two migrations shipped as 024 from parallel branches
-- (price_alerts landed first and was applied to production under that number).
-- Content unchanged; every statement is guarded, so re-running is a no-op.
--
-- Which rail did this money come in on?
--
-- Deposit detection is deliberately rail-agnostic: `sync_deposits` reads
-- Hyperliquid's own non-funding ledger, so a credit is recognised no matter how
-- it got there — the in-app onramp, a bridge, a transfer from an exchange, or a
-- user moving their own coins. That is the property worth keeping, and nothing
-- here changes it.
--
-- What it cost us is provenance. `hl_deposits` can say a user funded, and never
-- say through what. So "is the new rail working?" is unanswerable, and a
-- payment stuck at the provider cannot be reconciled against the HyperCore
-- credit it was supposed to become. Both are answerable with one nullable
-- column on each side.
--
-- Nullable on purpose, and it stays nullable. A deposit that arrives by a route
-- we do not run has no rail to record, and that is the normal case rather than
-- missing data. Backfilling a guess would make the column lie.

alter table hl_deposits
  add column if not exists source_rail text;

comment on column hl_deposits.source_rail is
  'Rail the credit is believed to have arrived on, when we know. Null means '
  'unattributed, which is normal: the ledger sees the credit, not its origin. '
  'Never infer a rail from timing alone — two deposits in the same minute are '
  'not evidence.';

-- The settlement network the order was placed against, recorded per order
-- rather than read from config at display time. Config is a deployment-wide
-- value that changes; an order settled on the network that was configured when
-- it was created, and history has to keep saying so. Without this, changing
-- `ONRAMP_NETWORK` silently rewrites what every past order claims to have done.

alter table onramp_orders
  add column if not exists network text;

comment on column onramp_orders.network is
  'Settlement network for this order, captured at creation. Null for orders '
  'created before this column existed; do not backfill from current config, '
  'which is exactly the value that may have changed.';

-- Deliberately not added here:
--
--   * an `outcome_unknown` state on `platform_transactions`. It is needed —
--     a broadcast that timed out is neither `processing` nor `failed`, and the
--     current constraint admits no third answer — but that table carries the
--     money movement and its status set is load-bearing. It deserves its own
--     migration, with the reversal-versus-loss question settled first:
--     `buildReversalEntries` writes symmetric contra-entries, which models an
--     unwind, and a fiat clawback landing after an irreversible crypto leg is
--     a loss to a house account rather than money that came back.
--
--   * a per-rail minimum. The 5 USDC Hyperliquid floor is enforced client-side
--     at the deposit hook. Enforcing it on the *output* of an onramp order
--     needs the payout amount before the order exists, which means a precalc
--     round-trip on a path that moves real money. That is a behaviour change,
--     not a column.
