# Privy + Telegram Mini App: Validation & Remaining Fixes

## Validation: What's Already Done ✅

| # | Fix | Status | Commit |
|---|-----|--------|--------|
| 1 | Disable Coinbase Wallet SDK (`smartWalletOnly`) | ✅ DONE | `e9b98d1` |
| 2 | Set `loginMethods` to TMA-compatible only | ❌ NEEDS FIX | - |
| 3 | Implement seamless TG login (`retrieveLaunchParams`) | ❌ NOT DONE | - |
| 4 | Add `resolve.dedupe` in `vite.config.ts` | ✅ DONE | `99aab52` |
| 5 | Run `npm ls react` to verify single version | ❌ NOT DONE | - |
| 6 | Clear Vercel build cache | ⚠️ USER ACTION | - |
| 7 | Verify domain is NOT `.xyz` | ✅ OK | - |
| 8 | Add `web.telegram.org` to Privy allowed domains | ❌ NOT DONE | - |

---

## Remaining Fixes (Ordered by Priority)

### Fix #1: Update `loginMethods` to TMA-Compatible Only

**Current state** (line 57 of `apps/tg-mini-app/src/App.tsx`):
```tsx
loginMethods: ['email', 'sms', 'google', 'telegram'],
```

**Problem**: `google` login uses OAuth popups which are blocked by Telegram WebView.

**Fix**:
```tsx
loginMethods: ['email', 'sms', 'telegram'],
```

---

### Fix #2: Implement Seamless Telegram Auth (Zero-Click Login)

Privy has first-class seamless login for TMAs using Telegram's `launchParams`. Users open your miniapp and are automatically authenticated — no login button needed.

**Implementation**:
1. Install `@telegram-apps/bridge` package
2. Create `TelegramAuthGate` component
3. Use `retrieveLaunchParams()` for zero-click auth
4. Use `linkTelegram()` to link TG account after login

---

### Fix #3: Verify Single React Version

Run `pnpm ls react` to verify only one version exists. If duplicates found, add `overrides` to root `package.json`.

---

### Fix #4: Add `web.telegram.org` to Privy Allowed Domains

In Privy Dashboard:
1. Go to Settings → Allowed Domains
2. Add: `https://web.telegram.org`
3. This enables Telegram WebView to communicate with Privy

---

### Fix #5: Remove Debug Logging

Remove the debug `console.log` statements from `App.tsx` after confirming the fix works.

---

## Implementation Order

1. **Fix #1** — Update `loginMethods` (1 line change)
2. **Fix #2** — Implement seamless TG auth (new component)
3. **Fix #3** — Verify React version (diagnostic)
4. **Fix #4** — Add Privy domain (user action)
5. **Fix #5** — Remove debug logging (cleanup)
6. **User Action** — Clear Vercel build cache on redeploy

---

## Expected Outcome

After all fixes:
- ✅ No SES Lockdown errors
- ✅ No "wrap your application" errors
- ✅ Zero-click Telegram authentication
- ✅ Embedded wallet auto-created on login
- ✅ App works in Telegram Mini App WebView
