# Handoff — hl-tg-web

Written 2026-08-13 at the end of a long session. `main` is at `362f6c8`, everything
pushed, working tree clean, one worktree, one local branch.

**Update 2026-08-14.** Open work item 1 and the `ws.ts` half of item 3 are done,
on branch `agent-key-and-ws-reconnect-tests` — two commits, not pushed, no PR.
That clears the prerequisites item 2 asked for, so lazy HIP-3 loading is next.
Opening the PR is also the first real run CI will ever get.

## Where things stand

The project is a Telegram Mini App for Hyperliquid trading (~33k LOC, pnpm/turbo
monorepo, Vercel serverless `api/`, Supabase, Privy auth). Goal is **real users
trading real money**.

Two things happened in this session. First, a security and correctness audit
(61 findings) was remediated and merged. Second — and more importantly —
**production's API had been dead since commit `688e9bf`**, returning
`FUNCTION_INVOCATION_FAILED` on every route, and nobody had noticed because the
project serves almost no traffic. That is fixed and verified.

The app also runs locally end to end for the first time, which is what makes
further work tractable. Before this session there was no way to exercise it
outside a deployed Telegram context.

## Running it

`pnpm dev` → Vite on port 5173, which also serves the `api/` functions via
`scripts/vite-plugin-api.ts`. One process, no proxy.

`.env.local` (gitignored) currently holds a **Hyperliquid testnet** setup:

```
VITE_HYPERLIQUID_TESTNET=true
DEV_ACCOUNT_WALLET=0x5bF344d20040e6c7589b46ae0e9F98210C40bF41
VITE_DEV_ACCOUNT_WALLET=0x5bF344d20040e6c7589b46ae0e9F98210C40bF41
VITE_DEV_AGENT_PRIVATE_KEY=<throwaway testnet key, in the file>
VITE_PRIVY_APP_ID=cmn4jruut019s0dl5lg14xz7y
```

That wallet is a throwaway keypair, unfunded, testnet only. No faucet was used
and no funds were moved.

Two dev-only bypasses make this work, both **inert in production by
construction**:

- `api/account/_lib/dev-bypass.ts` — serves `/api/account/*` for a configured
  wallet. Requires `NODE_ENV !== "production"` **and** `DEV_ACCOUNT_WALLET` set.
  Vercel reports `NODE_ENV=production` on Preview too, so this is genuinely
  local-only.
- `packages/hyperliquid-sdk/src/dev-identity.ts` — supplies a synthetic signed-in
  identity, because the app's only login trigger is `loginWithTelegram()` gated
  on `initData`, which is empty outside Telegram. Gated on
  `import.meta.env.DEV`, which Vite replaces with the literal `false` in a
  production build, so the branches are removed by dead-code elimination. The
  built bundle was checked and contains no trace of them.

### Environment quirks that will bite you

- **`pnpm` is not on PATH.** Use `corepack pnpm`, or note that `turbo` cannot
  find the package manager binary and fails with "cannot find binary path". A
  shim at a scratchpad path was used during the session.
- **Vite's binary is not hoisted**: `apps/tg-mini-app/node_modules/vite/bin/vite.js`.
- **`pkill -f "vite/bin/vite.js"` silently matches nothing on Windows.** Stray
  dev servers accumulate and `--strictPort` then fails with "Port 5173 is already
  in use", while the *old* server keeps serving stale inlined env values. This
  cost hours. Kill them properly:
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*vite*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  ```

## Test and typecheck

```
pnpm test                                   # 5/5 turbo tasks + the api suite, exit 0
pnpm exec tsc --noEmit -p tsconfig.json     # exit 0
```

351 tests: 158 api, 126 hyperliquid-sdk, 49 tg-mini-app, 14 notification-worker,
4 onramp-proxy.

Two structural facts about the test setup:

- **`api/` is not a pnpm workspace package**, so `turbo test` never saw it and
  ~90 tests were dead in CI. It now runs via `vitest.api.config.ts`, invoked by
  the root `test:api` script. That file is deliberately **not** named
  `vitest.config.ts`: Vitest searches parent directories, so a default-named
  config at the repo root gets picked up by every package lacking its own and
  overrides their include glob.
- **Vitest loads `.env` files into `process.env`**, so tests are sensitive to
  local env. `api/account/snapshot.test.ts` pins `VITE_HYPERLIQUID_TESTNET`
  because a developer on testnet otherwise sees a failure CI never reproduces.
  Assume more of these exist.

## Deployment

Vercel project `tg-mini-app`, team `veretelnikovve-4266s-projects` (Pro).

```
projectId  prj_WUJjlVkQbPpmJTBPCPVw70T8kWeq
teamId     team_DJ6Redj0xgxUo762PJT7QWLV
```

Vercel MCP is connected (`https://mcp.vercel.com`) and is by far the fastest way
to diagnose anything deployed: `get_runtime_logs`, `get_deployment_build_logs`,
`list_deployments`, `web_fetch_vercel_url`.

**Deployment Protection is SSO for all URLs except custom domains**, so plain
fetches to preview *and* production generated URLs return a 302 to
`vercel.com/sso-api`. A Protection Bypass token was used during the session and
**should be rotated** (Settings → Deployment Protection).

`api/tsconfig.json` is load-bearing. Vercel compiles each `api/**/*.ts`
entrypoint with the local TypeScript and the **nearest** tsconfig; the root one
sets `module: ESNext`, which made Vercel emit `import` statements into `.js`
files with no `"type": "module"` anywhere on that path, so Node loaded them as
CommonJS and every function died at module load. Do not remove or "tidy" that
file.

Vercel excludes `_`-prefixed paths under `api/` from routing. That is what makes
`api/_parked/` and every `api/*/_lib/` work. 21 routable functions.

## The payments layer is parked, not deleted

`api/_parked/` holds `quotes`, `transactions`, `transactions/[id]`,
`settlements`, `webhooks`, `risk/decision` and four test files — 6 routes taken
off the deployed surface without losing a line. `api/platform/_lib/` stayed put
(already underscore-excluded). Tests still run, so it cannot rot. Resuming is a
`git mv` back plus import-depth fixes.

Merchant payments were explicitly **not wanted for now**.

## Migrations — read before applying anything

```
001_identity_and_rls
002_onramp_v1
003_auth_data_boundary_hardening   ┐
003_notifications                  ├ three files share prefix 003
003_rewards_v1                     ┘
004_platform_orchestration         (parked layer — do not apply)
005_platform_hardening             ┐ two files share prefix 005
005_profile_data_boundary_hardening┘
006_weekly_raffle_runs             ← the only one worth applying
```

**Duplicate prefixes are unresolved.** `005_platform_hardening.sql` was added
this session without noticing it collides with `005_profile_data_boundary_hardening.sql`.
Ordering between same-prefix files depends on the tool, so confirm what is
already applied before running anything.

**`006_weekly_raffle_runs.sql` should be applied.** It is independent — it needs
only the existing `seasons` table — and without it `/api/rewards/weekly-raffle`
returns 500 on a missing `claim_weekly_raffle_run` RPC every Monday at 00:05 UTC.
It is already failing for that reason, so this is fix-forward, not a regression.

**004 and 005 belong to the parked layer.** 005 `alter`s tables that 004
creates, so 005 cannot run without 004. Leave both unapplied until merchant
payments resume.

## Open work, in the order I would do it

1. ~~**Agent key lifecycle tests**~~ — **done 2026-08-14.** 32 tests in
   `agent.test.ts` over generation, storage, expiry and reapproval, against a
   `globalThis.localStorage` stub. The cases worth knowing about: wallet-address
   casing is normalized, so a checksummed and a lowercase address reach the same
   key; and an expired key stays readable, so reapproval reuses the same
   on-chain agent address instead of costing a second signature. One asymmetry
   was left alone deliberately — the getters swallow `localStorage` failures and
   the setters do not, so a failed write throws out of the approval mutation
   *after* `approveAgent` already succeeded. Surfacing it beats silently
   believing a key was stored, but it is a decision, not an accident.
2. **Lazy HIP-3 loading** — `ensureMarketCache` in `client.ts` fans out one
   `metaAndAssetCtxs` request per HIP-3 dex. Mainnet lists 9 named dexes (12
   concurrent requests per session, fine); **testnet lists 247** (250), which
   rate-limits itself and is why no testnet order has executed yet. Fetching a
   dex's universe only when a HIP-3 symbol is requested takes a BTC order from
   250 requests to 3. This is order-routing surgery — the asset-id formulas are
   `perp: index`, `spot: 10000 + pair.index`,
   `hip3: 100000 + dexIndex*10000 + index`, and `index` must be the position in
   the **unfiltered** universe. Get it wrong and orders go to the wrong market.
   The tests in (1) and (3) are done, so this is the next thing to do.
3. ~~**Balance and margin math**, then `ws.ts` reconnect~~ — **done 2026-08-14**,
   with one part reassigned.

   `ws.ts` has 28 tests, and writing the back-off ones surfaced three defects in
   the same path, all fixed. `disconnect()` reconnected, because `close()` still
   fires `onclose` and nothing distinguished a deliberate shutdown from a
   dropped connection. A socket that never opened left `connectionOpenedAt`
   null, which zeroed the attempt counter every time, pinned the delay at one
   second and meant the ten-attempt cap was never reached — the exact tight loop
   the code's own comment claimed to prevent. And `onopen` zeroed the counter
   unconditionally, which made the five-second stability window dead code for
   any socket that opened at all, so a server that accepts and instantly drops
   reconnected every second forever. The reset now lives only in
   `handleReconnect`, gated on a connection that lasted.

   **Balance and margin math needs no test pass** — it is already covered. The
   pure math is in `account-state.ts` with 23 tests, and `client.ts:2423` only
   delegates to it. What is genuinely untested is the clearinghouse-state
   parsing in `getAccountState` (`client.ts` ~1388-1440), and that is an
   extraction job before it is a testing job. Same pattern as
   `order-validation.ts`: pull out the pure part, leave the I/O shell.
4. **The trading path bypasses the shared read layer.** The UI reads markets via
   `/api/market/markets` (Redis-cached, shared) while `placeOrder` re-derives the
   same universe directly from the browser. Worth unifying for latency once (2)
   is done; not urgent on mainnet.
5. **Consolidate three Supabase clients** — `api/onramp/_lib/supabase-admin.ts`
   (278), `api/profile/_lib/…` (282), `api/rewards/_lib/…` (705), each with its
   own `supabaseRequest`, `buildHeaders`, `looksLikeHtml`. Same duplication class
   as the two `HttpError` declarations that caused the production outage. Extract
   into `api/_lib/supabase.ts` alongside the existing shared modules.
6. **CI has never executed.** `.github/workflows/ci.yml` triggers on
   `pull_request`, and everything this session went in as direct pushes to `main`.
   It is configured but unproven; the next PR is its first real run.

`client.ts` (2,428 LOC) and `hooks.ts` (2,120 LOC) remain the untested bulk, and
they are what signs and submits orders. The working pattern is the one already
established by `order-validation.ts` and `account-state.ts`: extract pure
decision logic, leave a thin I/O shell, do not touch exchange semantics.

## Supabase Disk IO alert

An alert arrived about depleting the Disk IO budget. Almost certainly **not** the
app: production's API was dead until this session, so it could not reach
Supabase, and the one hot query (`users?privy_user_id=eq.…`) is indexed by a
unique constraint. Most likely baseline consumption on a small compute add-on.

The hourly chart in the alert email settles it: flat depletion means idle
overhead, a spike starting 2026-08-13 means the restored API.

The profile lookup is now Redis-cached for 60s (`05cf2f8`), which removes ~32
queries per minute per active user. Note the local dev bypass short-circuits
before that lookup, so it cannot be exercised end to end locally — the unit tests
are the verification.

## Do not repeat these mistakes

Recorded because they each cost real time in this session.

- **Read the logs before theorising.** Every wrong turn came from inferring a
  cause from symptoms. The module-load failure was diagnosed after three wrong
  hypotheses (Hobby function limit, `api/_lib` bundling, Hyperliquid fanout) and
  one look at `get_runtime_logs`. Same again with "Rate limited", which was only
  explicable after adding a log line.
- **Verify against the DOM, not the accessibility tree.** The tree dropped one of
  two spans and made a correct `$0.00` look like a broken `.00`.
- **Check for stray processes before believing a cache theory.** See above.
- **`error.cause` and original errors matter.** Two separate fixes this session
  (`api/_lib/error-response.ts`, `normalizeExchangeError` in `client.ts`) exist
  purely because a wrapped error had discarded what actually failed. `undici`
  reports a bare `TypeError: fetch failed` and puts the real reason on `cause`.
- **Do not trust `openapi.vercel.sh/vercel.json`** as the schema of record. It
  omits `buildCommand`, `crons`, `framework` and `fluid`, all of which are valid.
  The docs are authoritative.
- **`vercel.json` uses legacy `routes` deliberately.** Commits `4999593` and
  `0256876` arrived at that form by fixing real routing bugs, and
  `apps/tg-mini-app/src/lib/onramp.test.ts` asserts its exact shape. A
  speculative rewrite to `rewrites` was reverted. One known consequence: an
  unknown `/api/*` path falls through to `index.html`, which is why
  `looksLikeHtml` guards exist in `edge-proxy.ts` and `onramp.ts`. Fixing that
  needs its own change and a test update.

## Other loose ends

- `origin/codex/onramp-v1-local` is the only remote branch with unique commits
  (4, from April). Its files all exist in `main`, so it looks superseded via a
  different landing path, but it was kept rather than destroyed on an inference.
- Five `rollback/prod-*` refs kept deliberately — they read as intentional safety
  markers. All are ancestors of `main`, so dropping them loses only the labels.
- `apps/web` has a `test` script and no test files; it now passes
  `--passWithNoTests`. Before that, `pnpm test` had never succeeded at the root.
- **`eslint` finds no config from inside `packages/hyperliquid-sdk`** — it
  reports "couldn't find a configuration file" and exits 2, so that package's
  `lint` script cannot be passing. Noticed 2026-08-14 while linting new test
  files; not investigated, and `packages/eslint-config` exists unconsumed there.
- The `buffer`/`util` externalization warnings in the browser console are
  benign: `@privy-io/react-auth` → `@solana/web3.js`, code this app never runs.
  Both Hyperliquid signing chunks are clean and signing was verified working in
  the browser.
- `PLATFORM_QUOTE_SECRET` and the two country-list variables are unset. Only the
  parked routes need them.
