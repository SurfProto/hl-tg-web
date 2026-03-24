# Telegram-First Hyperliquid Trading App - Implementation Plan

## Validated Architecture Summary

**Core Approach**: Telegram Mini App (primary) + Vite Webapp (secondary) with ~85% code reuse via Turborepo monorepo.

**Key Decisions Made**:
- ✅ Vite for both apps (simpler than Next.js for secondary webapp)
- ✅ Supabase client-side initially (defer backend complexity)
- ✅ `@telegram-apps/sdk-react` (official Telegram SDK)
- ✅ `@nktkas/hyperliquid` (most maintained TS SDK)
- ✅ Builder code approval on first app load (seamless UX)
- ✅ Mainnet from day one with testnet toggle

---

## Tech Stack (Finalized)

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Monorepo** | Turborepo | Zero-config, AI-friendly parallelization |
| **Frontend** | React 18 + TypeScript | Community standard for Hyperliquid |
| **Build** | Vite 5 | Fastest cold starts (<2s in Telegram) |
| **Telegram SDK** | `@telegram-apps/sdk-react` | Official, handles edge cases |
| **Wallet** | Privy | Embedded wallets, Hyperliquid recipes |
| **Hyperliquid SDK** | `@nktkas/hyperliquid` | Best TS support, REST + WS |
| **State** | TanStack Query + Zustand | Caching + lightweight WS state |
| **Charts** | TradingView Lightweight Charts | Free, performant, candle + depth |
| **UI** | Tailwind + shadcn/ui | Mobile-first, Telegram theme sync |
| **Database** | Supabase (Postgres) | Free tier, realtime, auth |
| **Hosting** | Vercel | One-click deploy, custom domains |

---

## Monorepo Structure

```
hl-tg-web/
├── apps/
│   ├── tg-mini-app/          # Vite React (PRIMARY - Telegram Mini App)
│   │   ├── src/
│   │   │   ├── components/   # TG-specific components (bottom sheets, swipe)
│   │   │   ├── hooks/        # TG-specific hooks (theme, viewport, haptics)
│   │   │   ├── pages/        # Route pages
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── public/
│   │   ├── index.html
│   │   └── vite.config.ts
│   │
│   └── web/                  # Vite React (SECONDARY - Desktop/PWA)
│       ├── src/
│       │   ├── components/   # Web-specific components (desktop orderbook)
│       │   ├── pages/
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── public/
│       ├── index.html
│       └── vite.config.ts
│
├── packages/
│   ├── ui/                   # Shared UI components (85% reuse)
│   │   ├── src/
│   │   │   ├── OrderForm/
│   │   │   ├── Orderbook/
│   │   │   ├── Chart/
│   │   │   ├── PositionsTable/
│   │   │   ├── PortfolioSummary/
│   │   │   └── MarketSelector/
│   │   └── package.json
│   │
│   ├── hyperliquid-sdk/      # Shared SDK wrapper
│   │   ├── src/
│   │   │   ├── client.ts     # Hyperliquid client with Privy signer
│   │   │   ├── builder.ts    # Builder code enforcement
│   │   │   ├── hooks.ts      # React hooks for market data
│   │   │   ├── types.ts      # SDK types
│   │   │   └── ws.ts         # WebSocket management
│   │   └── package.json
│   │
│   ├── types/                # Shared TypeScript types
│   │   ├── src/
│   │   │   ├── market.ts
│   │   │   ├── order.ts
│   │   │   ├── position.ts
│   │   │   └── hip3.ts
│   │   └── package.json
│   │
│   └── config/               # Shared configs (Tailwind, ESLint, TS)
│       ├── tailwind.config.ts
│       ├── tsconfig.base.json
│       └── package.json
│
├── turbo.json
├── package.json
└── pnpm-workspace.yaml
```

---

## Implementation Phases

### Phase 0: Foundation (Day 1)
**Goal**: Monorepo setup + Privy + basic Telegram Mini App shell

**Tasks**:
1. Initialize Turborepo with pnpm
2. Create `apps/tg-mini-app` with Vite + React + TypeScript
3. Create `apps/web` with Vite + React + TypeScript
4. Create shared packages (`ui`, `hyperliquid-sdk`, `types`, `config`)
5. Configure Tailwind + shadcn/ui in shared config
6. Integrate `@telegram-apps/sdk-react` in tg-mini-app
7. Integrate Privy (embedded wallet setup)
8. Create basic Telegram Mini App shell (header, navigation, theme sync)
9. Deploy to Vercel (tg-mini-app URL)

**Deliverable**: Working Telegram Mini App with Privy login + empty UI shell

---

### Phase 1: Hyperliquid SDK Wrapper (Day 2)
**Goal**: Shared SDK with builder code enforcement

**Tasks**:
1. Install `@nktkas/hyperliquid` in `packages/hyperliquid-sdk`
2. Create `HyperliquidClient` class with Privy signer integration
3. Implement builder code enforcement:
   - `approveBuilderFee()` on first app load
   - Auto-inject `builder: { b: ADDRESS, f: FEE }` on every order
4. Create React hooks:
   - `useMarketData()` - All markets (spot + perp + HIP-3)
   - `useOrderbook()` - L2 depth via WS
   - `useCandles()` - Chart data via WS
   - `useUserState()` - Positions, orders, fills
   - `usePlaceOrder()` - Order placement with builder code
5. Implement WS connection management (reconnect, heartbeat)
6. Add testnet/mainnet toggle

**Deliverable**: Working SDK wrapper with builder code + React hooks

---

### Phase 2: Core UI Components (Days 3-5)
**Goal**: Shared UI components for trading interface

**Tasks**:
1. **MarketSelector** (Day 3)
   - Dynamic market list (spot + perp + HIP-3)
   - Search/filter functionality
   - Market metadata display (price, 24h change, volume)

2. **Chart** (Day 3-4)
   - TradingView Lightweight Charts integration
   - Candlestick + volume display
   - Timeframe selector (1m, 5m, 15m, 1h, 4h, 1d)
   - Real-time updates via WS

3. **Orderbook** (Day 4)
   - L2 depth display (bids/asks)
   - Spread indicator
   - Click-to-fill price
   - Depth visualization

4. **OrderForm** (Day 4-5)
   - Market/Limit order toggle
   - Price input (limit orders)
   - Size input (USD/contracts)
   - Leverage slider (perps)
   - Reduce-only / Post-only toggles
   - TP/SL inputs (optional)
   - Order preview with fees

5. **PositionsTable** (Day 5)
   - Open positions list
   - PnL display (unrealized)
   - Close position button
   - Liquidation price

6. **PortfolioSummary** (Day 5)
   - Account value
   - Available margin
   - Total PnL
   - Margin ratio

**Deliverable**: Complete shared UI component library

---

### Phase 3: Telegram Mini App Integration (Days 6-8)
**Goal**: Wire up components in Telegram Mini App

**Tasks**:
1. **Layout & Navigation** (Day 6)
   - Bottom tab navigation (Trade, Positions, Portfolio)
   - Telegram theme sync (dark/light)
   - Safe area handling (notches, home indicator)
   - Haptic feedback on interactions

2. **Trade Page** (Day 6-7)
   - MarketSelector (bottom sheet)
   - Chart (full-width, collapsible)
   - Orderbook (collapsible)
   - OrderForm (sticky bottom)

3. **Positions Page** (Day 7)
   - PositionsTable
   - Open orders list
   - Fills history

4. **Portfolio Page** (Day 7-8)
   - PortfolioSummary
   - Deposit/Withdraw buttons (on-ramp stub)
   - Settings (testnet toggle, builder code status)

5. **Telegram-Specific Features** (Day 8)
   - Swipe-to-cancel orders
   - Pull-to-refresh
   - Bottom sheets for modals
   - Telegram back button integration

**Deliverable**: Fully functional Telegram Mini App

---

### Phase 4: Webapp (Days 9-10)
**Goal**: Secondary desktop webapp using shared components

**Tasks**:
1. Configure webapp layout (desktop-optimized)
2. Implement desktop orderbook (side-by-side with chart)
3. Add keyboard shortcuts
4. PWA manifest for installability
5. Responsive breakpoints

**Deliverable**: Working desktop webapp

---

### Phase 5: Backend & On-Ramp (Days 11-13)
**Goal**: Supabase integration + on-ramp stub

**Tasks**:
1. **Supabase Setup** (Day 11)
   - Create tables: `users`, `watchlists`, `alerts`, `trades`
   - Configure RLS policies
   - Set up realtime subscriptions

2. **User Management** (Day 11)
   - Telegram initData verification
   - User profile creation
   - Session management

3. **On-Ramp Integration** (Day 12)
   - Stub redirect to on-ramp provider
   - Webhook listener for deposit confirmations
   - Deposit status tracking

4. **Builder Code Tracking** (Day 12)
   - Log all trades with builder code
   - Volume tracking per user
   - Rewards calculation (if applicable)

5. **Watchlists & Alerts** (Day 13)
   - Save favorite markets
   - Price alerts (Telegram push notifications)
   - Alert management UI

**Deliverable**: Backend services + on-ramp integration

---

### Phase 6: Polish & Launch (Days 14-16)
**Goal**: Production-ready launch

**Tasks**:
1. **Security Audit** (Day 14)
   - Client-side signing review
   - Input sanitization
   - CSP headers
   - Rate limiting

2. **Performance Optimization** (Day 14)
   - Bundle size optimization
   - Lazy loading
   - WS connection pooling
   - Image optimization

3. **Testing** (Day 15)
   - Manual testing (all flows)
   - Edge cases (network drops, WS reconnects)
   - Mobile testing (iOS/Android Telegram)

4. **Documentation** (Day 15)
   - User guide
   - API documentation
   - Deployment guide

5. **Launch** (Day 16)
   - Final Vercel deployment
   - Telegram Bot setup (Mini App URL)
   - Monitoring setup (Vercel Analytics)
   - Community announcement

**Deliverable**: Production-ready app

---

## Key Implementation Details

### Builder Code Enforcement

```typescript
// packages/hyperliquid-sdk/src/builder.ts

const BUILDER_ADDRESS = "0xYOUR_BUILDER_ADDRESS";
const BUILDER_FEE_TENTHS_BP = 10; // 1bp = 10 tenths

export async function approveBuilderFee(signer: ethers.Signer) {
  const action = {
    type: "approveBuilderFee",
    builder: BUILDER_ADDRESS,
    maxFeeRate: `${BUILDER_FEE_TENTHS_BP}0`, // Format: "100" for 10bp
  };
  
  // Sign and send via Hyperliquid exchange endpoint
  await signAndSend(signer, action);
}

export function injectBuilderCode(order: Order): Order {
  return {
    ...order,
    builder: {
      b: BUILDER_ADDRESS,
      f: BUILDER_FEE_TENTHS_BP,
    },
  };
}
```

### Telegram Theme Sync

```typescript
// apps/tg-mini-app/src/hooks/useTelegramTheme.ts

import { useThemeParams } from '@telegram-apps/sdk-react';

export function useTelegramTheme() {
  const themeParams = useThemeParams();
  
  return {
    isDark: themeParams.colorScheme === 'dark',
    colors: {
      bg: themeParams.bg_color,
      text: themeParams.text_color,
      hint: themeParams.hint_color,
      link: themeParams.link_color,
      button: themeParams.button_color,
      buttonText: themeParams.button_text_color,
    },
  };
}
```

### Privy + Hyperliquid Integration

```typescript
// packages/hyperliquid-sdk/src/client.ts

import { usePrivy } from '@privy-io/react-auth';
import { Hyperliquid } from '@nktkas/hyperliquid';

export function useHyperliquid() {
  const { user, getEthereumProvider } = usePrivy();
  const provider = getEthereumProvider();
  
  const client = new Hyperliquid({
    walletAddress: user?.wallet?.address,
    customSigner: provider,
    testnet: false, // Toggle via settings
  });
  
  return client;
}
```

---

## Environment Variables

```env
# Privy
VITE_PRIVY_APP_ID=your_privy_app_id

# Hyperliquid
VITE_HYPERLIQUID_TESTNET=false

# Builder Code
VITE_BUILDER_ADDRESS=0xYOUR_ADDRESS
VITE_BUILDER_FEE=10

# Supabase
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# On-Ramp (placeholder)
VITE_ONRAMP_URL=your_onramp_redirect_url
```

---

## Success Criteria

- [ ] Telegram Mini App loads in <2s
- [ ] Privy embedded wallet works (no seed phrase)
- [ ] All markets displayed (spot + perp + HIP-3)
- [ ] Real-time chart + orderbook
- [ ] Orders placed with builder code auto-injected
- [ ] Positions/PnL displayed correctly
- [ ] Testnet toggle works
- [ ] Desktop webapp functional
- [ ] On-ramp redirect works
- [ ] Deployed to Vercel

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Privy integration issues | Use official Hyperliquid recipes, test early |
| Telegram Mini App limitations | Use official SDK, test on real devices |
| HIP-3 market discovery | Poll `/info` meta endpoint, cache results |
| WS connection drops | Implement reconnect logic, fallback to polling |
| Builder code rejection | Test approval flow, handle errors gracefully |

---

## Next Steps

1. **User provides**: Builder address + fee rate
2. **User provides**: On-ramp integration details (when ready)
3. **Start coding**: Phase 0 (monorepo setup)

Ready to proceed with implementation?
