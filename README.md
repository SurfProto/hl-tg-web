# Hyperliquid Telegram Trading App

A Telegram-first trading experience for Hyperliquid, built with React, TypeScript, and Turborepo.

## Architecture

This is a monorepo containing:

- **apps/tg-mini-app**: Telegram Mini App (primary interface)
- **apps/notification-worker**: External Telegram notification worker
- **apps/web**: Desktop webapp (secondary interface)
- **packages/ui**: Shared UI components
- **packages/hyperliquid-sdk**: Hyperliquid SDK wrapper with builder code enforcement
- **packages/types**: Shared TypeScript types
- **packages/config**: Shared configuration (Tailwind, TypeScript, ESLint)

## Tech Stack

- **Frontend**: React 18 + TypeScript
- **Build**: Vite 5
- **Monorepo**: Turborepo + pnpm
- **Wallet**: Privy (embedded wallets)
- **Hyperliquid SDK**: @nktkas/hyperliquid
- **State**: TanStack Query + Zustand
- **Charts**: TradingView Lightweight Charts
- **UI**: Tailwind CSS + shadcn/ui
- **Database**: Supabase (Postgres)
- **Hosting**: Vercel

## Getting Started

### Prerequisites

- Node.js >= 18
- pnpm >= 9

### Installation

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env

# Edit .env with your values
```

### Development

```bash
# Start all apps in development mode
pnpm dev

# Start only Telegram Mini App
pnpm --filter @repo/tg-mini-app dev

# Start only webapp
pnpm --filter @repo/web dev
```

### Build

```bash
# Build all apps
pnpm build

# Build specific app
pnpm --filter @repo/tg-mini-app build
```

## Environment Variables

See [.env.example](.env.example) for required variables:

- `VITE_PRIVY_APP_ID`: Privy application ID
- `VITE_HYPERLIQUID_TESTNET`: Use testnet (true/false)
- `VITE_BUILDER_ADDRESS`: Your builder address for fee collection
- `VITE_BUILDER_FEE`: Builder fee in tenths of basis points (50 = 5bp)
- `VITE_SUPABASE_URL`: Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key used by server-side jobs
- `TELEGRAM_BOT_TOKEN`: Bot token for Telegram delivery
- `ONRAMP_BASE_URL`: On-ramp proxy base URL used by Vercel serverless functions
- `ONRAMP_PROXY_TOKEN`: Shared token used by Vercel to authenticate to the on-ramp proxy

For the VPS deployment of the external notifications worker, see [apps/notification-worker/README.md](apps/notification-worker/README.md).

## Deployment

### Vercel

1. Connect your repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy

### Telegram Mini App

1. Create a bot with @BotFather
2. Set the Mini App URL to your Vercel deployment
3. Configure the bot menu button

## Features

- ✅ Telegram-native wallet auth (Privy)
- ✅ All Hyperliquid markets (spot + perp + HIP-3)
- ✅ Real-time charts and orderbook
- ✅ Market and limit orders
- ✅ Positions and portfolio tracking
- ✅ Builder code enforcement (automatic)
- ✅ Testnet toggle
- ✅ Desktop webapp (PWA-ready)

## License

MIT
