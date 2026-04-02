# Codebase Audit Report: Bugs, Stale Code & Logical Errors

**Date:** 2026-03-31  
**Scope:** Full codebase review with focus on Privy integration and gas sponsorship flow  
**Status:** Refined with mitigation plan feedback

---

## Executive Summary

The codebase is generally well-structured but contains several real defects that should be addressed in priority order. The highest-confidence, highest-impact issues are:

1. Auth failure risk in `loginWithTelegram()` with no error handling
2. Unsafe Privy transaction typing around `sponsor: true`
3. Data-model problem in `ensureUser()` using `telegram_id` as a wallet fallback
4. Singleton lifecycle risk in `useHyperliquid()`
5. Architectural fragility in custom sponsorship endpoint and manual JWT verification
6. UX bug in `useBridgeToHyperliquid()` not pre-checking wallet USDC balance

**Key Decision:** The sponsorship endpoint should be **simplified and hardened**, not removed. It provides deterministic validation of chain, token, destination, calldata shape, and spend caps that Privy's built-in policies alone cannot guarantee.

---

## Validated Findings by Priority

### 🔴 HIGH PRIORITY — User-Facing Failures

#### 1. `loginWithTelegram()` Called Without Error Handling
**File:** [`apps/tg-mini-app/src/App.tsx:53-56`](apps/tg-mini-app/src/App.tsx:53-56)

```typescript
useEffect(() => {
  if (!ready || authenticated || !isTMA) return;
  privy.loginWithTelegram(); // Promise not awaited or caught
}, [ready, authenticated, isTMA]);
```

**Problem:** `loginWithTelegram()` returns a Promise but is not awaited or caught. If login fails (network error, invalid initData, etc.), the error is silently swallowed. Users see an infinite loading spinner with no recovery path.

**Impact:** HIGH — Users stuck on loading screen with no feedback or retry mechanism.

**Fix:** Wrap in try/catch with error state, or use `.catch()` to set an error message and show retry UI.

---

#### 2. Unsafe `sendTransaction` Type Cast Hides Gas Sponsorship
**File:** [`packages/hyperliquid-sdk/src/hooks.ts:561-585`](packages/hyperliquid-sdk/src/hooks.ts:561-585)

```typescript
await (sendTransaction as unknown as (
  transaction: { ... },
  options?: { sponsor?: boolean; uiOptions?: typeof uiOptions; address?: `0x${string}`; }
) => Promise<unknown>)( ... );
```

**Problem:** The `sponsor: true` flag — the core of the gas sponsorship flow — is hidden behind a massive unsafe cast. If Privy updates their API, this breaks silently with no type error.

**Impact:** HIGH — Gas sponsorship silently stops working on Privy SDK updates.

**Fix:** Create a typed adapter module that validates the runtime method shape once and exposes a small local API for sponsored sends.

---

#### 3. Singleton Client State Leaks Between Users
**File:** [`packages/hyperliquid-sdk/src/hooks.ts:18-34`](packages/hyperliquid-sdk/src/hooks.ts:18-34)

```typescript
let clientInstance: HyperliquidClient | null = null;
let publicClientInstance: HyperliquidClient | null = null;
```

**Problem:** Module-level singletons persist across React renders and user sessions. If User A logs out and User B logs in, `clientInstance` may still hold User A's wallet address and signer. The comparison logic only recreates the client if address/signer changes, but stale state can persist.

**Impact:** HIGH — Could cause transactions signed with wrong wallet or data leaks between sessions.

**Fix:** Replace with hook-managed memoized instances keyed by connected wallet address, signer/provider identity, and testnet flag.

---

#### 4. `ensureUser()` Uses `telegram_id` as Wallet Fallback
**File:** [`apps/tg-mini-app/src/lib/supabase.ts:26-32`](apps/tg-mini-app/src/lib/supabase.ts:26-32)

```typescript
const payload = {
  privy_user_id: input.privyUserId ?? null,
  telegram_id: input.telegramId ?? `wallet:${input.walletAddress}`,
  wallet_address: input.walletAddress ?? null,
  ...
};
```

**Problem:** When no `telegramId` is present, the fallback `wallet:${input.walletAddress}` is stored in the `telegram_id` column. This:
1. Corrupts the `telegram_id` column semantics
2. Could cause conflicts between different users with same wallet
3. Makes the schema misleading

**Impact:** MEDIUM — Data integrity issue, confusing schema, potential user matching bugs.

**Fix:** Change `ensureUser()` lookup/upsert strategy to use honest identity rules: prefer `telegram_id` when present, otherwise match by `wallet_address` or `privy_user_id`. Stop overloading `telegram_id`.

---

#### 5. Bridge Flow Doesn't Pre-Check Wallet USDC Balance
**File:** [`packages/hyperliquid-sdk/src/hooks.ts:496-586`](packages/hyperliquid-sdk/src/hooks.ts:496-586)

**Problem:** The hook checks `amount < 5` for minimum but doesn't verify the wallet actually has enough USDC before attempting the transaction. The transaction fails on-chain, wasting gas (if not sponsored) and providing poor UX.

**Impact:** MEDIUM — Poor UX, potential gas waste.

**Fix:** Add preflight validation: wallet connected, Arbitrum selected, enough USDC balance, clear error if sponsorship unavailable.

---

### 🟡 MEDIUM PRIORITY — Architecture & Fragility

#### 6. Manual JWT Verification Instead of Privy Server Auth
**File:** [`api/bridge-sponsorship/authorize.ts:42-121`](api/bridge-sponsorship/authorize.ts:42-121)

The entire JWT verification flow (80+ lines) manually verifies Privy access tokens using custom crypto code:
- Base64URL decoding
- RSA signature verification with `ieee-p1363` encoding
- Audience and issuer validation
- Expiration checking

**Problem:** Fragile, security-sensitive custom crypto code. Any change to Privy's JWT format breaks it.

**Fix:** Replace with `@privy-io/server-auth` (2 lines instead of 80). Keep the endpoint for policy enforcement.

---

#### 7. Missing `loginMethods` Configuration
**File:** [`apps/tg-mini-app/src/App.tsx:124-142`](apps/tg-mini-app/src/App.tsx:124-142)

The `PrivyProvider` config doesn't set `loginMethods`. Without explicit configuration, Privy shows all available login methods including Google OAuth, which uses popups blocked by Telegram WebView.

**Impact:** MEDIUM — Users see broken Google login option in Telegram.

**Fix:** Add `loginMethods: ['email', 'sms', 'telegram']` to PrivyProvider config.

---

#### 8. Agent Key Restoration Hits localStorage Every Render
**File:** [`packages/hyperliquid-sdk/src/hooks.ts:70-74`](packages/hyperliquid-sdk/src/hooks.ts:70-74)

```typescript
const storedKey = getStoredAgentKey(user.wallet.address);
if (storedKey && !client.hasAgentKey()) {
  client.setAgentKey(storedKey);
}
```

**Problem:** Runs on every render of `useHyperliquid()`. `localStorage` is synchronous and blocking, especially slow on mobile Telegram WebView.

**Impact:** MEDIUM — Performance degradation on mobile.

**Fix:** Move to `useEffect` tied to wallet changes, restore once per wallet change.

---

#### 9. `builder.ts` Uses Vite-Specific `import.meta.env`
**File:** [`packages/hyperliquid-sdk/src/builder.ts:5-6`](packages/hyperliquid-sdk/src/builder.ts:5-6)

```typescript
export const BUILDER_ADDRESS = import.meta.env.VITE_BUILDER_ADDRESS || '0x000...';
export const BUILDER_FEE_TENTHS_BP = parseInt(import.meta.env.VITE_BUILDER_FEE || '50', 10);
```

**Problem:** `import.meta.env` is Vite-specific. This shared package could be consumed by non-Vite backends.

**Impact:** MEDIUM — Architectural fragility.

**Fix:** Move builder config env reads out of shared package or isolate behind app-supplied config layer.

---

#### 10. WebSocket Reconnect Loop Risk
**File:** [`packages/hyperliquid-sdk/src/ws.ts:81-97`](packages/hyperliquid-sdk/src/ws.ts:81-97)

**Problem:** If server immediately closes connection (rate limiting), `handleReconnect` fires from `onclose`, creating rapid reconnect loop until `maxReconnectAttempts` reached.

**Impact:** MEDIUM — Could exhaust resources or trigger rate limits.

**Fix:** Add minimum connection duration check or reset counter only after successful connection lasting > N seconds.

---

#### 11. `useWebSocket` Polls Connection Status
**File:** [`packages/hyperliquid-sdk/src/hooks.ts:866-899`](packages/hyperliquid-sdk/src/hooks.ts:866-899)

```typescript
const interval = setInterval(checkConnection, 1000);
```

**Problem:** Polling every second is wasteful. WebSocketManager already has `onopen`/`onclose` callbacks that could emit events.

**Impact:** LOW-MEDIUM — Unnecessary CPU usage.

**Fix:** Replace with event-driven state.

---

### 🟢 LOW PRIORITY — Cleanup

#### 12. Duplicate Constants Across Files
**Files:** [`hooks.ts:463-464`](packages/hyperliquid-sdk/src/hooks.ts:463-464), [`authorize.ts:4-6`](api/bridge-sponsorship/authorize.ts:4-6)

`USDC_ARBITRUM` and `HL_BRIDGE_ARBITRUM` are duplicated. Should be in shared constants module.

---

#### 13. No React Error Boundaries
The entire app has no error boundaries. Component crashes cause white screen.

---

#### 14. `useSetupTrading` Missing Dependency
**File:** [`packages/hyperliquid-sdk/src/hooks.ts:669-676`](packages/hyperliquid-sdk/src/hooks.ts:669-676)

`getStoredAgentKey` not in dependency array. Currently works but is a lint violation.

---

#### 15. Exported `ZERO_ADDRESS` Unused Externally
**File:** [`packages/hyperliquid-sdk/src/builder.ts:4`](packages/hyperliquid-sdk/src/builder.ts:4)

Only used internally. Low-value API surface.

---

### Items Deprioritized (Not Worth Immediate Work)

- **Fixed 5% slippage** — Execution pricing already moved to book-aware logic for market entries/exits, so this is no longer top-tier
- **`closePosition` doesn't handle partial closes** — Product gap, not a bug
- **`useMidsWs` dependency array** — Works correctly as-is
- **`parseTransferCalldata` length check** — USDC on Arbitrum is standard, validation is adequate

---

## 7-Phase Mitigation Plan

### Phase 1: Stop User-Facing Auth and Bridge Failures
- Add explicit `loginWithTelegram()` error handling and retry UI in `App.tsx`
- Add preflight bridge validation (wallet connected, Arbitrum selected, enough USDC, sponsorship available)
- Add explicit `loginMethods` config to PrivyProvider for Telegram-safe methods only
- **Acceptance:** Failed Privy login shows recoverable UI; bridge doesn't fail late for obvious insufficient-balance cases

### Phase 2: Replace Unsafe Privy Integration Surfaces
- Replace `any` cast around `usePrivy()` with typed local wrapper for `loginWithTelegram`
- Replace `sendTransaction as unknown as ...` cast with typed adapter module that validates runtime method shape once and exposes small local API for sponsored sends
- **Acceptance:** No raw `any` cast in App.tsx; no giant inline cast in useBridgeToHyperliquid

### Phase 3: Simplify and Harden Sponsorship Backend
- Replace manual JWT verification with `@privy-io/server-auth`
- Keep endpoint but reduce to: verify Privy user → verify wallet belongs to user → verify chain/token/bridge/calldata → enforce spend caps → record outcome
- Deduplicate `USDC_ARBITRUM` and `HL_BRIDGE_ARBITRUM` into shared constant module
- **Acceptance:** No custom crypto/JWT parsing code remains; sponsorship policy stays app-controlled and auditable

### Phase 4: Repair Supabase Identity Modeling
- Stop using `telegram_id` as synthetic wallet identifier
- Change `ensureUser()` to: prefer `telegram_id` when present → otherwise match by `wallet_address` → optionally also match by `privy_user_id`
- Update schema/queries so `telegram_id` means Telegram only
- **Acceptance:** No `wallet:0x...` values in `telegram_id`; returning users matched without corrupting identity semantics

### Phase 5: Remove Singleton Lifecycle Risk in HL Hooks
- Replace module-level singleton clients with hook-managed memoized instances keyed by wallet address + signer + testnet flag
- Restore stored agent keys in effect tied to wallet changes, not every render
- Keep public market-data client separate but scoped safely
- **Acceptance:** Wallet/session changes cannot reuse stale user-bound clients; localStorage not read every render

### Phase 6: WebSocket and Error-Boundary Hardening
- Add top-level React error boundary around app shell
- Replace polling-based websocket connection checks with event-driven state
- Add reconnect backoff protection for short-lived failed connections
- **Acceptance:** Component crashes don't white-screen app; websocket reconnect is bounded and observable

### Phase 7: Architecture Cleanup
- Move builder config env reads out of shared package or isolate behind app-supplied config layer
- Clean up low-priority API surface (unused exports, stale helpers)
- **Leave last; should not block auth, bridge, or trading stability work**

---

## Public Interfaces / Type Changes Required

- Typed Privy adapter for: Telegram login, sponsored transaction send
- Shared constants/config module for: Arbitrum USDC address, Hyperliquid bridge address
- Supabase user resolution behavior change: `telegram_id` no longer overloaded as wallet fallback
- No trading route or order type changes required

---

## Test Plan

### Auth
- Telegram login success
- Telegram login failure with visible retry state
- No popup-only methods exposed in TMA

### Sponsorship
- Valid bridge request authorizes and sends
- Wrong token / wrong bridge / wrong calldata rejected
- Missing balance fails before transaction send
- Wallet mismatch rejected with specific reason

### Identity
- Existing Telegram user upserts cleanly
- Wallet-only user does not corrupt `telegram_id`
- Returning user still matched after schema/query changes

### Client Lifecycle
- Logout/login or wallet change does not reuse stale HL client state
- Stored agent key restores once per wallet change, not every render

### Stability
- WebSocket reconnect doesn't spin aggressively
- Runtime component error caught by error boundary

---

## Assumptions

- Keep the sponsorship endpoint; simplify it rather than deleting it
- Prioritize auth, bridge, and identity fixes before cleanup/lint items
- Treat the original audit as useful input, not literal implementation checklist
