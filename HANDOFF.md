# Handoff — hl-tg-web

Written 2026-08-13 at the end of a long session. `main` is at `362f6c8`, everything
pushed, working tree clean, one worktree, one local branch.

**Update 2026-08-14.** Open work items 1, 2 and 3 are done, including the
clearinghouse-state extraction item 3 left behind. Both branches —
`agent-key-and-ws-reconnect-tests` and `lazy-hip3-loading` — are merged into
`main`; they were developed in parallel and touched disjoint files, so only this
document conflicted.

**The account snapshot is broken on testnet**, found while verifying that
extraction in the browser. `/api/account/snapshot` returns 500 from
`Info request failed with status 429`, thrown at index 49 of `getUserState`'s
247-way `clearinghouseState` fan-out. Mainnet fans out over 9 dexes and is fine,
so this is testnet-only and not a production outage — but it is the measurement
the note under item 2 asked for, and it means no local testnet session can load
account state. See item 3 for what to do about it.

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

**It has to be 5173.** The CSP `frame-ancestors` list names `localhost:5173`
only, so on any other port Privy's `auth.privy.io` iframe is blocked and login
cannot complete.

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

531 tests: 193 api, 242 hyperliquid-sdk, 78 tg-mini-app, 14 notification-worker,
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

## Migrations — audited and applied 2026-08-19

The Supabase connector reached the project (`tdtlptrpgxweyulkenza`) for the
first time, so the drift is no longer guesswork. **Verified against the live
schema, not the migration ledger** — the ledger only records what ran through
the migration tool, and `001` had partly landed some other way.

Applied this session, one at a time, each verified:

| Migration | Was | Now |
|---|---|---|
| `001` `telegram_id drop not null` | `NOT NULL` — every new user's rewards 500'd | nullable |
| `006_weekly_raffle_runs` | table and both RPCs absent — raffle 500'd | present, RLS on |
| `003_auth_data_boundary_hardening` | pre-hardening policies live | service-role-only |
| `005_profile_data_boundary_hardening` | same | service-role-only |

`004` and `005_platform` remain unapplied, correctly — they belong to the
parked payments layer, and no `platform*` table exists.

**006 as written left a hole, now fixed in the file too.** `CREATE FUNCTION`
grants `EXECUTE` to `PUBLIC`, so `claim_weekly_raffle_run` and
`complete_weekly_raffle_run` were callable over PostgREST by anyone with the
publishable key — enough to claim a week's draw and stall it, or mark a run
completed with a made-up winner count. Note that revoking from `anon` and
`authenticated` by name does nothing; they hold no explicit grant and inherit
`PUBLIC`'s. Revoke `PUBLIC`. `service_role` keeps its own grant, which is what
the API uses.

**Two tables still have RLS disabled**: `seasons` and
`bridge_sponsorship_events`, both flagged ERROR by `get_advisors`. Supabase's
default grants give `anon` full DML on them including `TRUNCATE`. Nothing the
app publishes opens that door — the built bundle carries neither the Supabase
URL nor an anon key — but an anon key is not a secret by design.
`bridge_sponsorship_events` is referenced nowhere in the codebase and may be
dead. Deliberately left alone this session rather than swept in.

Read `get_advisors` after any DDL. It caught the function-grant hole within a
minute of 006 landing.

### The original prefix warning still stands

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

## First-ever login was broken in production (2026-08-16)

Reported as "Something went wrong — a is not a function" on a brand-new
account, working on the second attempt. Two independent bugs, neither from
recent work, both only reachable by a user who has no row in `users` yet.

**1. `/api/profile/bootstrap` was dead — fixed.** 28 requests, 28 failures in
the preceding 24h. It died at module load:

```
Cannot find module './src/errors.js'
  …/@hpke/common/script/mod.js
  …/@privy-io/node/lib/cryptography.js
  /var/task/api/profile/_lib/identity.js
```

The file is present in the installed package, so Vercel was not shipping
`@hpke/common/script/src/*` into the function bundle. That route creates the
user's row, so nothing downstream could work: `/api/account/snapshot` returned
401 seventy-nine times in two minutes for that session.

The SDK was one call, `client.users()._get(id)`, so `identity.ts` now makes the
REST request the SDK made and `@privy-io/node` is out of the bundle entirely.
`@privy-io/node` stays in `package.json` — `scripts/security-audit-identities.ts`
uses it, and a local script is not bundled into a function.

**An unauthenticated POST is a good probe for this class of failure.** A module
that fails to load answers `500 FUNCTION_INVOCATION_FAILED`; a module that
loads answers `401 UNAUTHORIZED` with a JSON body. That is how the fix was
verified against production, before and after.

**2. The production database is behind its migrations — still open.**
`/api/rewards/dashboard` 500s for a new user:

```
null value in column "telegram_id" of relation "users" violates not-null constraint
  at getOrCreateRewardsUser
```

`getOrCreateRewardsUser` inserts a row with only `privy_user_id`, which is
correct against the intended schema: both `schema.sql` ("nullable: NULL for
wallet-only users") and migration `001` (`alter column telegram_id drop not
null`) make the column nullable. Production still enforces `NOT NULL`, so
**migration 001 was never applied there**. Fixing it needs

```sql
alter table users alter column telegram_id drop not null;
```

and, given the prefix collisions, a check of what else from 001–006 is missing.
Until then a new user's rewards dashboard fails, though onboarding itself now
completes.

The client-side `a is not a function` was never reproduced directly — the app's
logger only writes to console, so no stack survives, and the production build of
that commit renders correctly in Chromium. It is most likely downstream of three
failing endpoints on a cold account. Worth re-testing with a fresh account now
that (1) is fixed; if it recurs, the app needs somewhere to send client errors
before it can be diagnosed at all.

## Monitoring exists now (2026-08-19)

Two blind spots are closed. Both existed because nothing was asking.

**`pnpm smoke`** (`scripts/smoke-check.mjs`) probes all 21 routes with no
credentials and asserts two things:

- an authed route answers **401, not 500** — reaching the handler is what proves
  the module loaded;
- the response is **not HTML** — `vercel.json` sends an unknown `/api/*` path to
  `index.html`, so a route that stops existing answers 200 with a page, which a
  status-only check would happily accept.

It runs on every production deployment and hourly
(`.github/workflows/smoke.yml`). **It found a dead route on its first run**:
`/api/notifications/worker` was failing at load with `ERR_REQUIRE_ESM`, because
four of its five imports were lazy and the fifth — the config — was static,
while `apps/notification-worker` is `"type": "module"` and Vercel compiles the
entrypoint to CommonJS. Now lazy with the rest. That is three module-load
outages found in this codebase, all invisible to typecheck and tests.

**`/api/client-errors`** gives the mini app somewhere to report to. Crashes
become runtime log lines, so they group under `get_runtime_errors` beside
server errors — no new vendor, no new secret, no schema. The reporter
(`apps/tg-mini-app/src/lib/error-reporting.ts`) never throws into the caller,
never reports a failure of its own reporting, and sends one report per distinct
crash, because a render loop fires the same error thousands of times.

If reports ever need to outlive Vercel's retention, `api/client-errors.ts` is
the single place that changes.

## Production configuration that is missing

Found by the smoke check, not by anything failing loudly.

- **`CRON_SECRET` is unset.** `/api/notifications/worker` says so directly
  (`500 CRON_SECRET_MISSING`). Vercel only sends `Authorization: Bearer
  $CRON_SECRET` when that variable exists, so the Monday raffle cron has been
  getting 401 on every run — the raffle is broken for this reason *as well as*
  the unapplied migration 006. Setting it turns the last smoke check green.
- **Nothing schedules the notifications worker.** `vercel.json` has one cron
  entry, for `/api/rewards/weekly-raffle`. The worker route exists, is now
  loadable, and is never called, so notifications do not send at all.

## Why no authenticated account read had ever worked (2026-08-19)

The balance showed zero for every user because `/api/account/snapshot` had
never once returned data in production. Three faults stacked, each invisible
until the one in front of it was fixed:

1. **`/api/profile/bootstrap` was dead at module load** (`@hpke` missing from
   the function bundle), so no user could complete onboarding.
2. **`TELEGRAM_BOT_TOKEN` was unset**, so `requireTelegramInitData` 401'd every
   account request — 127 of them in one week — no matter how valid the token
   and init data were. Note this returns **401**; a missing profile row returns
   404, so a 401 storm never meant "no profile".
3. **The Hyperliquid SDK could not be loaded from a CommonJS function.**

The third is the interesting one, and the "lazy import" comments in
`api/account/_lib/upstream.ts`, `api/rewards/_lib/hyperliquid-client.ts` and
`apps/notification-worker/src/hyperliquid.ts` are actively misleading. They say
eager importing "crashed in production" and that deferring fixed it. **Deferring
only moved the failure from load time to call time.** Vercel compiles these
entrypoints to CommonJS (`api/tsconfig.json`, load-bearing) and TypeScript
rewrites `import()` under that setting — verified against the emit:

```js
Promise.resolve().then(() => require(".../client"))
```

So the route still answered 401 to an unauthenticated probe, because the module
loaded fine and only the deferred require failed, deep inside the authenticated
path. **The smoke check cannot see this class of bug**; the runtime logs are the
only thing that can.

Peeling it took three passes, each one a layer down:

| Failure | Cause | Fix |
|---|---|---|
| `ERR_REQUIRE_ESM` on `notification-worker/src/config.js` | package declared `"type": "module"` | removed the field |
| `ERR_REQUIRE_ESM` on `hyperliquid-sdk/src/client.js` | same | removed the field |
| `Cannot find module .../@repo/types/src/index.ts` | `require("@repo/types")` resolves through `main`, which points at **TypeScript source** that no longer exists once Vercel compiles to `.js` | import the one runtime constant by relative path |

**Removing `"type": "module"` from a workspace package is safe here, and the
earlier note in this document claiming otherwise was wrong.** The field only
governs how *Node* treats `.js` files. Every consumer in this repo — Vite,
vitest, tsx — resolves these packages to their `.ts` source through `main`/
`exports` and never reads it. Real `import.meta.env` usage exists only in
`dev-identity.ts` and `hooks.ts`, and neither is reachable from `client.ts`;
`builder.ts` mentions it in comments only. The browser build was run after each
change to confirm.

**The rule that falls out of this:** a serverless function under
`api/tsconfig.json` can only `require` things. It cannot load a package marked
ESM, and it cannot resolve a package whose `main` points at `.ts`. Importing by
deep relative path — which `api/` already does for the SDK — sidesteps the
second problem entirely and is the pattern to follow.

Still unverified at the time of writing: whether the snapshot now returns 200.
Everything up to the SDK import is proven; check `get_runtime_logs` for
`/api/account/snapshot` after any authenticated session.

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
2. ~~**Lazy HIP-3 loading**~~ — **done 2026-08-14**, with one piece deliberately
   left standing.

   A dex universe is fetched when a symbol on that dex is first resolved, and
   memoized. The asset-id formulas are unchanged — `perp: index`,
   `spot: 10000 + pair.index`, `hip3: 100000 + dexIndex*10000 + index`, with
   `index` the position in the **unfiltered** universe, which a test now pins.

   The fan-out was on two more paths than this list said. `refreshAssetCtxs` is
   the one that mattered: it runs on the order path via `getAssetCtx`, so
   pricing a BTC order issued its own 248 requests regardless of the cache
   build. It and `getMids` now cover only loaded dexes; `getMarkets`
   enumerates everything, so it loads them all through `loadAllHip3Dexes`. A
   testnet BTC order went from 250 requests to 4.

   Two things fell out of writing the tests. A failed dex load drops its memo,
   or a transient 429 would disable that dex for the life of the client —
   worse than the eager version. And `ensureMarketCache` now shares one
   in-flight build: concurrent first callers each ran the whole build and got
   separate cache objects, so a lazy load could mutate one while the caller
   held the other and saw its own symbol as unknown.

   **`getUserState` still fans out over every known dex** — one
   `clearinghouseState` each, so 247 on testnet whenever account state loads.
   Left alone on purpose: restricting it to loaded dexes would under-report
   collateral for someone holding a balance on a dex they have not opened, and
   that is a money-correctness decision rather than a performance one. If the
   order screen gates submit on balance, this can still throttle a testnet
   order. Measure it before choosing between bounded concurrency, a
   loaded-dex restriction, and leaning on `dexAbstraction`.

   One behavior change to know about: `getMids` and `getMarketStats` now carry
   HIP-3 data only for loaded dexes. The UI lists markets from the server's
   Redis-cached `/api/market/markets`, and the browser client's own listing
   path is `getMarkets`, which loads everything — but a future caller that
   enumerates markets some other way would see less than it used to.
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

   **That extraction is done.** `buildAccountState` in `account-state.ts` folds
   the base perp state, the spot state and every HIP-3 dex state into one
   `AccountState`; `getUserState` is now the `Promise.all` and the 2s cache and
   nothing else, ~100 lines shorter. 15 tests. `mergeStableBalanceState` moved
   over with it as `accumulateStableBalance` — the name now says how it differs
   from the neighbouring `mergeStableBalanceStates`, which pairs spot with perp
   rather than summing like with like.

   Two things the tests pin that were previously only implied: `dexStates[i]`
   belongs to `perpDexs[i]`, which is what attributes a balance to the right
   collateral asset, and equity is idle balance plus position value rather than
   the exchange's own `accountValue`. Parsing stays NaN-propagating — a
   malformed number should be visible, not read as no money — and a null dex
   state no longer throws where the old code did `state.assetPositions`.

   **Next, and now urgent for testnet: the `getUserState` fan-out.** It is not
   a latency question any more — 247 concurrent `clearinghouseState` requests
   rate-limit themselves and `/api/account/snapshot` 500s. The three options are
   unchanged (bounded concurrency, a loaded-dex restriction, `dexAbstraction`),
   and the tradeoff still is that a loaded-dex restriction under-reports
   collateral held on a dex the user has not opened. Bounded concurrency keeps
   what is counted identical and is the conservative fix.
4. **The trading path bypasses the shared read layer.** The UI reads markets via
   `/api/market/markets` (Redis-cached, shared) while `placeOrder` re-derives the
   same universe directly from the browser. Worth unifying for latency once (2)
   is done; not urgent on mainnet.
5. ~~**Consolidate three Supabase clients**~~ — **done 2026-08-14.** There were
   **four**, not three: the parked `api/platform/_lib/supabase-admin.ts` had a
   copy too. All four were character-identical apart from the config type name,
   so `api/_lib/supabase.ts` now holds `supabaseRequest`, `buildHeaders` and
   `looksLikeHtml`, typed against a structural `SupabaseConfig`, and 167 lines
   of duplication are gone. 11 tests — the transport had none of its own before,
   only whatever the route tests happened to exercise.

   Four other `looksLikeHtml` copies remain, in `edge-proxy.ts`,
   `onramp/_lib/provider.ts`, `apps/tg-mini-app/src/lib/{onramp,rewards}.ts` and
   the onramp proxy. Those guard *provider* responses rather than Supabase ones
   and sit on the far side of a package boundary, so they were left alone —
   sharing them means deciding where a browser, a serverless function and a
   standalone proxy can all import from, which is a bigger question than this
   change.
6. ~~**CI has never executed.**~~ **Wrong — it has run on every push since it
   was added, and it had been failing for a day.** `ci.yml` triggers on
   `pull_request` *and* `push` to `main`, which the note above missed. Every run
   from `362f6c8` (2026-08-13) onward was red on a single test, including both
   merges from 2026-08-14. Fixed 2026-08-14; check `gh run list` rather than
   assuming.

   The failure is worth knowing about because it could only happen on CI.
   `order-size.test.ts` asserted `inferSzDecimalsFromMinBaseSize(10 ** -5) === 5`.
   `10 ** -5` is exactly 1e-5 on the Node 24 in use locally, but on the Node 20
   the workflow pins it is one ulp higher, which prints as
   `0.000010000000000000003` — twenty-one decimals, so the function returned 21.
   That value becomes `szDecimals` in `OrderForm`, and szDecimals formats the
   size sent to the exchange, so the test was pointing at something real. The
   function now takes the shortest decimal that still represents the same lot
   size, and the test pins the offending double as a literal so it reproduces
   anywhere.

`client.ts` (2,171 LOC) and `hooks.ts` (2,001 LOC) remain the untested bulk, and
they are what signs and submits orders. The working pattern is the one already
established by `order-validation.ts` and `account-state.ts`: extract pure
decision logic, leave a thin I/O shell, do not touch exchange semantics.

**Five rounds of that pattern have now landed**, in `account-state.ts`,
`decimal.ts`, `order-price.ts`, `exchange-response.ts`, `stable-swap.ts` and
`trading-setup.ts`. Each one found something:

- **The price path never got the truncation fix.** `362f6c8` replaced
  `Math.trunc((value + Number.EPSILON) * factor) / factor` in the *size* path
  because it carries a value sitting just below a boundary over it. `formatPrice`
  kept using it, so `formatPrice(1.9999999999999998, {priceDecimals: 4})`
  returned `"2"` — on a buy, a bid above the price asked for. Both paths now
  share one `truncateToDecimals`, and a property test holds the invariant across
  tick boundaries.
- **The two rate-limit predicates were not the same test** and are deliberately
  still not. `retryOrder` must not match `"after retries"`, which is what
  `postInfo` throws once its own backoff is spent; retrying that multiplies
  attempts against an exchange already refusing them. The user-facing mapper
  does treat it as rate limiting.
- **`reduceAgentApproval` is where "stale" versus "missing" lives.** An agent
  absent from a list that previously carried it is revoked; absent from the
  first list ever read is propagation delay right after approval. Reading either
  wrong sends a working account back through setup, or leaves a revoked one
  believing it can trade. It is now pure — the caller does the `storeAgentExpiry`
  write.

- **`upsertPositionProtection` held a second copy of the app's protection
  classifier**, with a comment in `client.ts` pointing at the original in
  `apps/tg-mini-app/src/lib/protection.ts` rather than resolving it. The UI and
  the order path were therefore free to disagree about which resting order is
  your stop. `position-protection.ts` now owns both `classifyProtectionOrder`
  and `planPositionProtection`; the app re-exports the classifier, and
  `client.ts` is left with the cancel-and-place sequence. Neither side had a
  single test before; there are now 34 across the two.

  One deliberate non-change: when a position carries several stops, only the
  first is cancelled. Cancelling all of them would be defensible on the reading
  that duplicates are stale, but scaling out at several levels is a real
  strategy, and silently clearing the ladder is worse than leaving it. A test
  pins the current behavior either way. The one behavior change is that a
  zero-size position is now refused up front rather than sending a zero-size
  order the exchange would reject.

What is left in those two files is genuinely I/O-shaped: HTTP, signing, caching
and the React wiring around them.

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
  explicable after adding a log line. And again on 2026-08-16: a client-side
  `a is not a function` looked like a bundling regression from that day's
  commits, and `get_runtime_errors` showed a server route that had been dead
  for far longer.
- **A dependency that works locally can still be missing in the deployment.**
  `@hpke/common/script/src/errors.js` exists in the installed package and is
  required statically, and Vercel still did not trace it into the function.
  Prefer `fetch` against a documented REST endpoint over an SDK when the SDK is
  one call deep — the whole @hpke chain was in the bundle for a single user
  lookup.
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
