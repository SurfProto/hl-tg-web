# Deployment Guide

## Connecting the repo to Vercel (Git Integration)

One-time setup. Vercel builds from the repository root — the root `vercel.json`
is canonical.

1. In the Vercel dashboard: **Add New → Project → Import** `SurfProto/hl-tg-web`.
2. Leave **Root Directory** as the repository root. Do **not** set it to
   `apps/tg-mini-app`; that excludes the root `api/*` Functions from the
   deployment. Build Command, Output Directory, Install Command and Framework
   all come from `vercel.json`, so leave the dashboard fields untouched.
3. **Before the first production deploy**, set the Production Branch to a branch
   that does not exist yet: **Settings → Git → Production Branch →** `production`.
   Every push, including `main`, then produces a Preview deployment and nothing
   reaches production. Switch it back to `main` when you are ready to go live.
4. Add the environment variables below (Settings → Environment Variables). The
   `VITE_*` values are read at build time and baked into the bundle, so a
   missing one ships as an empty string rather than failing.
5. Push a branch and confirm the Preview deployment builds.

### Required environment variables

Server-side (Functions):

| Variable | Notes |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Never expose as `VITE_*`. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Or the `KV_REST_API_URL` / `KV_REST_API_TOKEN` aliases Vercel Marketplace provisions. Without these, caching and rate limiting silently degrade to per-instance memory. |
| `TELEGRAM_BOT_TOKEN` or `MARKET_TELEGRAM_BOT_TOKEN` | Verifies Mini App init data. |
| `PRIVY_APP_SECRET`, `PROFILE_PRIVY_APP_ID` | Server-only; `PROFILE_PRIVY_APP_ID` falls back to `VITE_PRIVY_APP_ID`. |
| `PRIVY_JWKS_URL` or `PRIVY_VERIFICATION_KEY` | Access-token verification. One is required. |
| `CRON_SECRET` | Authorises the weekly raffle cron. |
| `PLATFORM_ADMIN_KEY`, `PLATFORM_WEBHOOK_SECRET`, `PLATFORM_QUOTE_SECRET` | Platform routes. `PLATFORM_QUOTE_SECRET` falls back to the webhook secret; use a separate key. |
| `PLATFORM_HIGH_RISK_COUNTRIES`, `PLATFORM_PROHIBITED_COUNTRIES` | Comma-separated ISO codes. Optional. |
| `REWARDS_ADMIN_KEY`, `REWARDS_TREASURY_PRIVATE_KEY`, `REWARDS_RAFFLE_PRIZES_USDC` | Rewards. `REWARDS_RAFFLE_PRIZES_USDC` must list at least as many prizes as the winner count or the raffle refuses to draw. |
| `ONRAMP_*` | See the on-ramp section below. |
| `MARKET_POLICY_JSON`, `MARKET_PREVIEW_BYPASS_SECRET` | Optional. The preview bypass only takes effect locally — Vercel sets `NODE_ENV=production` on Preview deployments too. |

Build-time (`VITE_*`, baked into the bundle): `VITE_PRIVY_APP_ID`,
`VITE_TELEGRAM_BOT_USERNAME`, `VITE_HYPERLIQUID_TESTNET`,
`VITE_BUILDER_ADDRESS`, `VITE_BUILDER_FEE`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `VITE_ONRAMP_URL`, `VITE_LEGAL_TERMS_URL`,
`VITE_LEGAL_PRIVACY_URL`, `VITE_SUPPORT_EMAIL`, `VITE_SUPPORT_FAQ_URL`,
`VITE_SUPPORT_BUG_URL`, `VITE_SUPPORT_SURVEY_URL`,
`VITE_SUPPORT_TWITTER_URL`.

### Migration ordering before going live

Apply these to Supabase **before** switching the Production Branch to `main`:

1. `supabase/migrations/005_platform_hardening.sql`
2. `supabase/migrations/006_weekly_raffle_runs.sql`

006 is not optional. `runWeeklyRaffle` calls `rpc/claim_weekly_raffle_run`; if
that function is absent the cron returns 500 every Monday at 00:05 UTC. That is
an existing feature regressing, not a new one failing.

Then seed:

- `fx_reference_rates` — one row per `(fiat_currency, crypto_asset)` corridor.
  `/api/quotes` returns `422 NO_REFERENCE_RATE` for an unpriced corridor rather
  than guessing.
- `user_risk_profiles` — screening results. A user with no row, or one screened
  more than 180 days ago, is treated as unscreened and routed to review.

## Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **Telegram Bot**: Create a bot with [@BotFather](https://t.me/BotFather)
3. **Privy Account**: Get your app ID from [privy.io](https://privy.io)
4. **Builder Address**: Your Hyperliquid builder address for fee collection

## Step 1: Install Dependencies

```bash
# Install pnpm if you haven't already
npm install -g pnpm

# Install project dependencies
pnpm install
```

## Step 2: Configure Environment Variables

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` with your values:
```env
# Privy
VITE_PRIVY_APP_ID=your_privy_app_id
VITE_TELEGRAM_BOT_USERNAME=your_bot_username

# Hyperliquid
VITE_HYPERLIQUID_TESTNET=false

# Fast market/account read cache
UPSTASH_REDIS_REST_URL=your_upstash_redis_rest_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_rest_token
# Vercel Marketplace may provision these legacy KV aliases instead.
KV_REST_API_URL=your_vercel_kv_rest_url
KV_REST_API_TOKEN=your_vercel_kv_rest_token
EDGE_CONFIG=your_vercel_edge_config_connection_string
MARKET_POLICY_JSON=
MARKET_TELEGRAM_BOT_TOKEN=
MARKET_PREVIEW_BYPASS_SECRET=
PROFILE_PRIVY_APP_ID=
PRIVY_APP_SECRET=your_server_only_privy_app_secret

# Builder Code
VITE_BUILDER_ADDRESS=0xYOUR_BUILDER_ADDRESS
VITE_BUILDER_FEE=50

# Supabase (optional for now)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# On-Ramp (optional for now)
VITE_ONRAMP_URL=
```

## Step 3: Deploy to Vercel

### Option A: Deploy via Vercel CLI

1. Install Vercel CLI:
```bash
npm install -g vercel
```

2. Login to Vercel:
```bash
vercel login
```

3. Deploy the Telegram Mini App and API from the repository root:
```bash
vercel
```

4. Follow the prompts:
   - Set up and deploy? **Yes**
   - Which scope? Select your account
   - Link to existing project? **No**
   - Project name? `hl-tg-mini-app` (or your preferred name)
   - Directory? `./` (repository root)
   - Override settings? **No**

5. Set environment variables in Vercel:
```bash
vercel env add VITE_PRIVY_APP_ID
vercel env add VITE_HYPERLIQUID_TESTNET
vercel env add VITE_BUILDER_ADDRESS
vercel env add VITE_BUILDER_FEE
vercel env add UPSTASH_REDIS_REST_URL
vercel env add UPSTASH_REDIS_REST_TOKEN
# Or use the Vercel Marketplace aliases if those were provisioned:
vercel env add KV_REST_API_URL
vercel env add KV_REST_API_TOKEN
vercel env add TELEGRAM_BOT_TOKEN
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add PROFILE_PRIVY_APP_ID
vercel env add PRIVY_APP_SECRET
```

6. Redeploy with environment variables:
```bash
vercel --prod
```

### Option B: Deploy via Vercel Dashboard

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click "Add New..." → "Project"
3. Import your Git repository
4. Configure project:
   - Framework Preset: **Vite**
   - Root Directory: leave empty (repository root)
   - Build Command: `pnpm build`
   - Output Directory: `apps/tg-mini-app/dist`
5. Add Environment Variables:
   - `VITE_PRIVY_APP_ID`
   - `VITE_HYPERLIQUID_TESTNET`
   - `VITE_BUILDER_ADDRESS`
   - `VITE_BUILDER_FEE`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `KV_REST_API_URL` and `KV_REST_API_TOKEN` are also supported when Vercel Marketplace provisions KV-style aliases
   - `TELEGRAM_BOT_TOKEN` or `MARKET_TELEGRAM_BOT_TOKEN`
   - `PROFILE_PRIVY_APP_ID` (falls back to `VITE_PRIVY_APP_ID`)
   - `PRIVY_APP_SECRET` (server-only; never expose as a `VITE_` variable)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
6. Click "Deploy"

### Fast Market And Account Reads

Public market reads are served through `/api/market/*` and do not require
Telegram or Privy auth. They use Redis for short-lived cache, rate-limit
counters, and refresh locks. If Redis env vars are missing, routes fall back to
in-memory storage for local development only.

Protected account reads are served through `/api/account/*`. These routes
require a valid Privy bearer token and Telegram Mini App init data, then resolve
the wallet server-side from Supabase by `privy_user_id`. They never trust a
wallet address supplied by the client and always send private no-store cache
headers.

Profile bootstrap fetches the Privy user on the server. The only canonical
trading/rewards wallet stored in `users.wallet_address` is the Privy-managed
embedded Ethereum wallet. A TRC20 destination chosen during an on-ramp flow is
stored only on that on-ramp order.

### Apply And Verify Profile Policies

Apply all Supabase migrations, including
`supabase/migrations/005_profile_data_boundary_hardening.sql`, then run:

```sql
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('users', 'notification_preferences', 'notification_channels')
order by tablename, policyname;
```

The result must contain only `users_service_role_access`,
`notif_prefs_service_role_access`, and
`notification_channels_service_role_access`; each policy must require
`service_role` in both `qual` and `with_check`.

### Audit Existing Profile Identity

Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PRIVY_APP_SECRET`, and either
`PROFILE_PRIVY_APP_ID` or `VITE_PRIVY_APP_ID`, then run the repair flow in this
order:

```bash
pnpm security:audit-identities
pnpm security:audit-identities -- --apply
```

First review the JSON report. Apply mode corrects only deterministic Privy
wallet and email mismatches; it intentionally exits nonzero while Telegram
bindings still require manual confirmation. Re-verify those Telegram
associations separately before treating the identity audit as closed.

Optional `MARKET_POLICY_JSON` can override low-churn policy values such as TTLs,
major symbols, rate limits, or emergency upstream disable flags. Leave it empty
to use code defaults. A parse failure is logged and the defaults are used.

If the Redis variables are absent the market and account routes fall back to a
per-instance in-memory store. In serverless that makes the cache useless and the
rate limiter bypassable by spreading requests across instances, so the fallback
logs an error when `NODE_ENV=production`. Treat it as a misconfiguration, not a
supported mode.

### Platform Orchestration

The merchant payments routes (`/api/quotes`, `/api/transactions`,
`/api/settlements`, `/api/risk/decision`, `/api/webhooks`) need migrations 004,
005 and 006 applied, plus:

- `PLATFORM_ADMIN_KEY` — gates the operator-only routes.
- `PLATFORM_WEBHOOK_SECRET` — HMAC key for inbound merchant webhooks.
- `PLATFORM_QUOTE_SECRET` — signs quote tokens. Falls back to the webhook secret
  for compatibility; use a separate key.
- `PLATFORM_HIGH_RISK_COUNTRIES`, `PLATFORM_PROHIBITED_COUNTRIES` —
  comma-separated ISO codes.

Two things must be populated before the routes will serve traffic:

- `fx_reference_rates` — one row per `(fiat_currency, crypto_asset)` corridor.
  `/api/quotes` derives the crypto amount from this and returns
  `422 NO_REFERENCE_RATE` rather than guessing when a corridor is missing.
- `user_risk_profiles` — screening results, maintained out of band by
  compliance. A user with no row, or one screened more than 180 days ago, is
  treated as unscreened and routed to review rather than allowed.

Clients call `/api/quotes` first and pass the returned `quoteToken` to
`/api/transactions`. Amounts in the transaction request body are ignored; the
token is the only source of the priced values, and it expires after 120 seconds.
Merchants identify themselves with `x-merchant-api-key`, whose SHA-256 hash must
match a row in `merchant_api_keys`.

### Vercel Function Performance

The root `vercel.json` is the canonical deployment configuration: it builds the
mini app, exposes the root `/api/*` Node.js Functions, includes the raffle cron,
and opts into Fluid Compute. Do not configure the Vercel project with
`apps/tg-mini-app` as its Root Directory, because that excludes the root API
Functions from the deployment.

Keep these API handlers on the Node.js runtime. Authenticated endpoints rely on
Node cryptography, and the latency-sensitive read endpoints already use Redis
and CDN cache headers.

For the Europe/CIS latency pass on Vercel Pro:

1. In the Vercel dashboard, record Function route latency and error baselines
   for `/api/market/markets`, `/api/market/stats`, and authenticated
   `/api/account/snapshot`.
2. Record the deployed Vercel Function, Upstash Redis, and Supabase regions.
3. Benchmark the existing Function region against `fra1` using equivalent
   preview deployments and the same critical routes.
4. Add one `regions` value to root `vercel.json` only after the benchmark shows
   improved or unchanged critical-path latency with no error regression.

Use Vercel Function Observability and Runtime Logs for this measurement. Do not
expose timing data in the UI or API responses, and do not enable multiple
Function regions until Redis and Supabase locality has been validated.

## Step 4: Set Up Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram
2. Send `/newbot`
3. Choose a name for your bot (e.g., "Hyperliquid Trading")
4. Choose a username (e.g., "hyperliquid_trading_bot")
5. Save the **API token** provided

## Step 5: Configure Mini App

1. In BotFather, send `/mybots`
2. Select your bot
3. Click "Bot Settings" → "Menu Button"
4. Set the menu button URL to your Vercel deployment URL:
   ```
   https://your-app.vercel.app
   ```
5. Set the menu button text (e.g., "Trade")

## Step 6: Test Your Mini App

1. Open your bot in Telegram
2. Click the menu button (or send `/start`)
3. Your Mini App should open!

## Troubleshooting

### Mini App not loading
- Check that your Vercel deployment is live
- Verify environment variables are set correctly
- Check browser console for errors

### Privy login not working
- Verify `VITE_PRIVY_APP_ID` is correct
- Check that your Privy app is configured for Telegram

### Telegram features not working
- Make sure you're testing inside Telegram (not in a browser)
- Check that `window.Telegram.WebApp` is available

### Build errors
- Run `pnpm install` to ensure all dependencies are installed
- Check TypeScript errors with `pnpm build`

## Next Steps

1. **Set up Telegram Bot Menu**: Configure the bot menu in BotFather
2. **Test all features**: Login, trading, positions, portfolio
3. **Monitor errors**: Set up error tracking (e.g., Sentry)
4. **Analytics**: Add Vercel Analytics for usage tracking
5. **Custom domain**: Configure a custom domain in Vercel

## Useful Commands

```bash
# Local development
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview

# Deploy to Vercel
vercel --prod

# Check deployment status
vercel ls
```
