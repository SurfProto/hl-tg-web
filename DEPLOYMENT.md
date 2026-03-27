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

3. Deploy the Telegram Mini App:
```bash
cd apps/tg-mini-app
vercel
```

4. Follow the prompts:
   - Set up and deploy? **Yes**
   - Which scope? Select your account
   - Link to existing project? **No**
   - Project name? `hl-tg-mini-app` (or your preferred name)
   - Directory? `./` (current directory)
   - Override settings? **No**

5. Set environment variables in Vercel:
```bash
vercel env add VITE_PRIVY_APP_ID
vercel env add VITE_HYPERLIQUID_TESTNET
vercel env add VITE_BUILDER_ADDRESS
vercel env add VITE_BUILDER_FEE
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
   - Root Directory: `apps/tg-mini-app`
   - Build Command: `pnpm build`
   - Output Directory: `dist`
5. Add Environment Variables:
   - `VITE_PRIVY_APP_ID`
   - `VITE_HYPERLIQUID_TESTNET`
   - `VITE_BUILDER_ADDRESS`
   - `VITE_BUILDER_FEE`
6. Click "Deploy"

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
