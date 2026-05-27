# Deployment Guide

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
PROFILE_PRIVY_APP_ID=
PRIVY_APP_SECRET=your_server_only_privy_app_secret

# Hyperliquid
VITE_HYPERLIQUID_TESTNET=false

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
   - `PROFILE_PRIVY_APP_ID` (falls back to `VITE_PRIVY_APP_ID`)
   - `PRIVY_APP_SECRET` (server-only; never expose as a `VITE_` variable)
6. Click "Deploy"

### Profile Identity Boundary

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
