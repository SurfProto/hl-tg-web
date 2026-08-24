# Points XP-Only Hardening Design

**Date:** 2026-08-24

**Status:** Approved in principle; awaiting repository-document review

**Decision:** Run Points as a server-enforced XP-only program. Automatic USDC
payouts and weekly raffle draws remain disabled until accounting, ingestion,
reconciliation and retry behavior pass explicit relaunch gates.

## Context

The authenticated rewards dashboard is reachable in production, and the code
contains real quest, referral, app-trade attribution, XP ledger and raffle
logic. It is not yet a trustworthy cash-reward system.

The dashboard is currently a command disguised as a query. Opening Points can
create a season, apply a referral, fetch deposits and Hyperliquid fills, insert
ledger rows, update projections and leaderboards, and attempt USDC transfers.
This couples display availability, accounting completeness and money movement
to a user opening one screen.

The design keeps the useful XP program, preserves historical evidence, and
establishes explicit gates before any future cash payout.

## Goals

- Make it impossible for a normal dashboard or referral request to transfer
  money.
- Stop generating new USDC and raffle entitlements while XP-only mode is active.
- Tell users exactly which parts of Points are active and paused.
- Make XP totals complete, append-only, idempotent and independently
  reconcilable.
- Ingest app-attributed fills without relying on the Points page being opened.
- Fix race conditions in season and referral state.
- Remove misleading UI values and protect leaderboard privacy.
- Define auditable relaunch gates for raffle and cash rewards.

## Non-goals

- Re-enabling automatic USDC payouts in this implementation.
- Running a weekly raffle in this implementation.
- Deleting historical cash or raffle records.
- Promising retroactive cash rewards for XP earned while the program is
  XP-only. Any future conversion requires a separate product and legal decision.

## Approaches considered

### Environment-only switch

Leaving the payout code intact and merely unsetting the treasury key is fast,
but an environment change can reactivate unsafe behavior. It also leaves the
dashboard-to-transfer coupling in place. Rejected.

### Server-enforced XP-only mode

The server emits XP only, does not load payout code from request paths, refuses
raffle execution, and advertises disabled capabilities to the client. Historical
cash entries are held for audit. Selected.

### Delete all cash and raffle code/data

This minimizes reachable surface but destroys evidence needed for
reconciliation and creates avoidable rework. Rejected.

## User-visible behavior

The Points page shows a persistent notice:

> Points are currently XP-only. Cash rewards and the weekly raffle are paused
> while we harden the rewards system.

Only XP rewards are shown on quests. Referrals continue to link and award XP.
Cash prize amounts, raffle eligibility and winner claims are hidden. Historical
cash records are excluded from the user dashboard and remain available only to
the administrative reconciliation path. They are never represented as newly
claimable.

The UI must use values with their actual meaning:

- season XP must not be labelled “this week”;
- raffle rank must not be labelled “days active” or formatted as “of 7”;
- referral cards show the backend-funded referral count and authoritative XP,
  not `count * 100`;
- quest cards show the active XP reward, not only the first reward in an array;
- deposits are described as qualifying in-app onramp deposits until other
  deposit sources are supported;
- hard-coded tiers and progress are removed until a backend tier model exists.

The API adds an explicit program descriptor to `RewardsDashboard`:

```ts
interface RewardsProgramStatus {
  mode: "xp_only";
  usdcPayoutsEnabled: false;
  weeklyRaffleEnabled: false;
}

interface WeeklyRafflePaused {
  state: "paused";
}
```

The client renders capabilities from the response instead of inferring them
from missing data or environment variables. While XP-only mode is active,
`weeklyRaffle` is `WeeklyRafflePaused`; the server does not calculate current
eligibility, ranks or winners. Dashboard reward history contains XP entries
only. Administrative reconciliation remains able to inspect every ledger kind.

## Immediate safety boundary

1. `syncRewardsDashboard` no longer imports or invokes payout code.
2. `RewardsConfig` no longer exposes a treasury key to ordinary rewards
   requests. A configured `REWARDS_TREASURY_PRIVATE_KEY` has no effect.
3. Quest and referral builders emit XP entries only.
4. `/api/rewards/weekly-raffle` authenticates as today, then returns HTTP 409
   with code `REWARDS_XP_ONLY` without claiming a run, choosing winners, writing
   ledger rows or sending USDC.
5. The raffle remains absent from `vercel.json` schedules.
6. A migration adds a `held` ledger status and moves existing `pending` or
   `failed` `usdc`/`raffle` rows to `held`. Posted history is never modified.
7. `payout.ts` remains under `_lib` for audited history and isolated tests, but
   no deployed request or cron handler imports or invokes `sendRewardUsdc`.

## Authoritative accounting

`reward_ledger` becomes the append-only source of truth for XP:

- new entries use insert-on-conflict-do-nothing by `idempotency_key`;
- a sync never merge-updates an existing ledger row;
- terminal states cannot be reverted by ingestion;
- XP totals are calculated by database aggregate over all applicable ledger
  rows, not by the 150-entry history response;
- `user_points` and `weekly_rewards` are rebuildable projections, not sources of
  truth;
- history pagination and total calculation are separate queries.

This directly removes two critical defects: paid cash entries returning to
`pending` through `resolution=merge-duplicates`, and high-volume users losing XP
when totals are recomputed from the latest 150 ledger rows.

The existing-volume lookup returns the complete stored `fillKey` from metadata
or strips only the known idempotency prefix. It must not split the key down to
only the order id.

## Fill ingestion and reconciliation

The current `userFills` call returns only the latest 2,000 fills. Hyperliquid's
time-based endpoint returns at most 2,000 fills per response and exposes only the
latest 10,000 fills. A user-driven monthly scan therefore cannot guarantee a
complete season.

Add a per-user, per-wallet, per-season checkpoint table and a scheduled sync
worker. The worker:

1. reads a bounded batch of accounts;
2. calls `userFillsByTime` over checkpointed time windows;
3. subdivides full 2,000-fill windows so the boundary cannot silently truncate;
4. writes app-attributed fills with a durable unique identity;
5. records the next cursor only after ledger insertion succeeds;
6. exposes last-success, lag and error state for reconciliation;
7. marks an account `retention_risk` when the oldest fill available is newer
   than the requested checkpoint, which means a complete reconstruction is no
   longer provable from the API.

The dashboard becomes a read-only projection endpoint. Referral start
parameters are handled by the explicit referral mutation before the dashboard
is read. A read may report stale/syncing state, but it never performs exchange
I/O, creates seasons, assigns referrals or writes reward state.

## Concurrency and database invariants

- Add a database invariant that permits only one active season and an atomic
  get-or-create season RPC/job path.
- Replace check-then-patch referral assignment with one database operation that
  succeeds only when `referred_by` is null and rejects self-referral.
- Keep the reward ledger idempotency constraint and change writes to do nothing
  on conflict.
- Rank and aggregate in SQL with bounded result sets; do not load all users and
  all point rows into a serverless function.
- Enable and verify RLS on `seasons` and every rewards table. All mutations and
  reconciliation RPCs are service-role-only, with `EXECUTE` revoked from
  `PUBLIC` and client roles.

## Leaderboard privacy

Leaderboards must never expose Telegram usernames or wallet fragments. The
migration assigns and stores an opaque alias in the form `Trader-XXXXXXXX`,
derived from a one-way hash of the internal UUID. Only that alias is returned by
leaderboard queries. A self-chosen display name is a later feature with
uniqueness, moderation, impersonation and rename-policy requirements.

## Raffle and payout relaunch design

Raffle and cash work remains dormant until the XP ledger is reconciled. Before a
relaunch:

- eligibility is snapshotted by a worker independently of page visits;
- failed draw runs can be explicitly retried without duplicating winners;
- each payout has durable attempt state and an exchange transfer reference;
- ambiguous “sent but database update failed” outcomes enter manual review and
  are never blindly retried;
- reconciliation confirms exchange state before a ledger entry becomes paid;
- treasury balance limits, per-transfer limits, daily limits, alerts and an
  emergency stop exist;
- initial production payouts require manual approval and a capped canary.

The current `usdSend` helper and mocked tests are not sufficient evidence for a
production payout system.

## Placeholder disposition

- `awards` and `referral_earnings`: leave untouched for compatibility, document
  them as unused, and exclude them from all runtime reads and writes.
- `multiplier`, `pool_share`, `claimed`, season weekly pool and `tickets`: do not
  expose in the UI or use in calculations until a product rule exists.
- weekly raffle: return the explicit `paused` state described above and remove
  eligibility/prize rendering from the active UI.
- reward history: return paginated XP entries to the user and keep held/paid
  cash history in the administrative reconciliation surface.

## Error handling and observability

- Disabled cash/raffle requests return HTTP 409 with the stable machine code
  `REWARDS_XP_ONLY`, plus user-safe text.
- Dashboard responses include last successful XP synchronization time and a
  stale/syncing/error state without leaking upstream or database errors.
- Ingestion logs carry internal user/season identifiers, counts, cursor windows
  and durations; they never include private keys, auth tokens or full wallet
  addresses.
- Metrics cover ingestion lag, full-window subdivision, duplicate fills,
  projection drift, held cash rows, failed jobs and attempted calls to disabled
  capabilities.
- A reconciliation command reports differences without mutating data by default.

## Testing and verification

### Immediate safety tests

- A dashboard request cannot import/call `sendRewardUsdc` or perform `usdSend`,
  even when a treasury variable exists.
- Completed quests and referrals create only XP entries.
- Existing cash entries are held once and posted rows are unchanged.
- Authenticated raffle GET/POST returns `REWARDS_XP_ONLY` and performs no claim,
  draw, ledger write or payout.
- The Points UI shows the XP-only notice and no cash/raffle promise.

### Accounting tests

- Repeated syncs insert one ledger row and never mutate terminal state.
- More than 150 ledger rows still produce the complete XP total.
- Existing fill keys round-trip in full.
- Projection rebuild equals the ledger aggregate.
- Concurrent season/referral operations produce one valid result.

### Ingestion tests

- Multi-page and exactly-2,000-fill windows do not drop boundary fills.
- A crash before checkpoint commit safely replays without duplicate XP.
- Wallet changes and season boundaries create independent checkpoints.
- Retention-risk and stale-sync states are observable.

### Release verification

- Run all API, SDK and mini-app tests, typecheck and production build.
- Apply migrations deliberately and verify constraints/RPC grants against the
  live Supabase schema.
- Confirm the deployed dashboard advertises `xp_only` and produces no transfer
  logs.
- Confirm the raffle route is disabled and remains unscheduled.
- Reconcile a sample of low- and high-fill accounts against Hyperliquid data.

## Delivery order

1. Safety release: XP-only API/UI, held ledger state, disabled raffle and
   negative payout tests.
2. Accounting release: append-only writes, aggregate totals, fixed fill keys and
   rebuildable projections.
3. Ingestion release: checkpointed background fill sync and read-only dashboard.
4. Integrity/privacy release: atomic seasons/referrals, SQL ranking,
   pseudonymous leaderboard and removal of misleading placeholders.
5. Shadow operation and reconciliation.
6. Separate reviewed proposal for any raffle or cash-reward relaunch.

Each release is deployable independently. Cash and raffle stay disabled through
all six steps unless a later approved design explicitly changes that decision.
