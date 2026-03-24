# Telegram Bot & Mini App Setup Guide

## Step 1: Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a name: e.g., `Hyperliquid Trading`
4. Choose a username: e.g., `hyperliquid_trading_bot` (must end in `bot`)
5. **Save the API token** (looks like `1234567890:ABCdef...`)

## Step 2: Set Up the Mini App URL

1. In BotFather, send `/mybots`
2. Select your bot
3. Click **"Bot Settings"**
4. Click **"Menu Button"**
5. Click **"Configure menu button"**
6. Enter your Vercel URL: `https://tg-mini-app-peach-ten.vercel.app`
7. Enter button text: `Trade`

## Step 3: Configure Bot Commands (Optional)

In BotFather, send `/setcommands` and select your bot. Then send:

```
start - Start the bot
trade - Open trading interface
help - Get help
```

## Step 4: Test Your Mini App

1. Open your bot in Telegram (search for `@your_bot_username`)
2. Click the **menu button** (bottom left, looks like a grid icon)
3. Your Mini App should open!

## Step 5: Configure Privy Dashboard

1. Go to [privy.io/dashboard](https://privy.io/dashboard)
2. Select your app
3. Go to **Settings** → **Login Methods**
4. Enable **Telegram** as a login option
5. Go to **Settings** → **Allowed Domains**
6. Add your Vercel URL: `https://tg-mini-app-peach-ten.vercel.app`
7. Add: `https://web.telegram.org` (required for Telegram WebView)

## Step 6: Set Environment Variables in Vercel

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Find your project `tg-mini-app`
3. Go to **Settings** → **Environment Variables**
4. Add these variables:

| Variable | Value |
|----------|-------|
| `VITE_PRIVY_APP_ID` | `cmn4jruut019s0dl5lg14xz7y` |
| `VITE_HYPERLIQUID_TESTNET` | `false` |
| `VITE_BUILDER_ADDRESS` | `0x1924b8561eef20e70ede628a296175d358be80e5` |
| `VITE_BUILDER_FEE` | `10` |

5. After adding all variables, click **"Redeploy"** (uncheck "Use existing build cache")

## Step 7: Test in Telegram

1. Open your bot in Telegram
2. Click the menu button
3. Your Mini App should open and work!

## Troubleshooting

### Mini App not loading
- Check that your Vercel deployment is live
- Verify environment variables are set correctly
- Check browser console for errors

### Privy login not working
- Verify `VITE_PRIVY_APP_ID` is correct
- Check that your Privy app is configured for Telegram
- Make sure `web.telegram.org` is in allowed domains

### Telegram features not working
- Make sure you're testing inside Telegram (not in a browser)
- Check that `window.Telegram.WebApp` is available

### SES Lockdown errors
- This should be fixed with the Coinbase Wallet SDK disabled
- If still seeing errors, check the Vercel deployment logs

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
```
