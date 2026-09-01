# TON and TRC20 ramps — research findings

**Date:** 2026-08-30. Trimmed 2026-08-31 after the decisions below.

**Why this is trimmed.** The original brief was written before two facts were
established, and those facts deleted most of its recommendations. It argued at
length for buying a TRON→Arbitrum conversion hop from a vendor, and for a staged
TON build-out. Both are moot. What remains here is the analysis that survives:
the Hyperliquid rail constraints, the Privy capability boundary, the TRON
compliance surface, and what in this repository to extend rather than rebuild.

## Decisions that superseded the original recommendations

| Decision | Consequence |
|---|---|
| The RUB on-ramp provider **settles Arbitrum USDC** (confirmed) | The fiat on-ramp needs no bridge, no conversion vendor, no float and no TRON. It becomes RUB → provider → Arbitrum USDC → the user's Privy wallet → Bridge2 → HyperCore. The entire conversion-vendor shortlist is cut. |
| Credit **on settlement** | No treasury float, no instant-credit reconciliation surface. Matches how `hl_deposits` detection already works. |
| Payout address **must equal the user's own Privy wallet**, server-enforced | Closes the fund-loss path that Arbitrum settlement opens — see "The validation gap" below. |
| Contracting entity is **non-EU** | EU Reg 833/2014 Art 5b does not bind. Serving RU-resident users is a diligence and provider-terms question, not a prohibition. |
| **MEXC**, corporate/KYB with API access, for chain-crossing | Replaces the vendor shortlist in both directions. |
| **Crypto off-ramp deferred** | The TON/TRON withdrawal design is cut entirely. |
| Telegram policy risk **accepted for now** | Recorded separately in [`2026-08-31-telegram-mini-app-risk-decision.md`](2026-08-31-telegram-mini-app-risk-decision.md), which supersedes the compliance section of the original brief. |

TON and TRC20 survive in scope for one job only: **funding from existing
holdings** — a user who already holds USDT on TRON or TON and wants to bring it
in. Plus a **fiat off-ramp**, where a user spends wallet balance for a fiat
payout. Both are researched separately.

---

## Hyperliquid's rail — the fixed constraint

Everything terminates the same way, because Hyperliquid gives no choice.

| Fact | Evidence |
|---|---|
| Deposits are **Arbitrum USDC only**, as a plain ERC-20 `transfer` to Bridge2 `0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7`, credited to the *sending* EOA. No memo, no per-user deposit address, no calldata. | `packages/hyperliquid-sdk/src/constants.ts:5`; `hooks.ts:1187-1199` |
| **Minimum 5 USDC.** Below that the deposit is not credited. Enforced only client-side, inside a React hook. | `hooks.ts:1154`; Hyperliquid docs |
| Bridge2 is the **legacy** rail. "USDC is natively minted on the Hyperliquid L1" and "The legacy Arbitrum bridge holds less than 10% of the USDC supply on HyperCore." CCTP is the current route from Arbitrum. *(verified by direct fetch)* | <https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/usdc> |
| A new HyperCore account owes a **1 USDC activation fee** on the first transaction destined for it. No UI here discloses it. *(agent-fetched, not independently confirmed)* | Hyperliquid activation-gas-fee docs |
| Withdrawals are **Arbitrum USDC only**, `withdraw3`, flat **$1**, 3–5 minutes. Must be signed by the main wallet, not the agent. | `client.ts:2423` and the comment above it |
| **HyperUnit supports neither TON nor TRON** — BTC, ETH, SOL, XPL, MON, ZEC, AVAX, VIRTUAL and some Solana SPL tokens. There is no "wait for native support" option. | HyperUnit supported-assets docs |

**Do not treat HyperEVM/CCTP as a happy path yet.** Circle's HyperEVM USDC
showed a zero balance at the Core system address for token index 0, and no token
in `spotMeta` links to Circle's contract — so CCTP-delivered USDC is not
demonstrably usable as perps collateral. Unresolved; settle it with a 5 USDC
test transfer before relying on it.

## The validation gap that Arbitrum settlement opens

`api/onramp/_lib/request.ts:69` validates the payout address as:

```
network.toUpperCase() === "TRC20" ? isValidTronAddress(address) : address.length > 0
```

Under TRC20 the base58check is real. Under **any other network — including
Arbitrum — the only check is that the string is non-empty.** With the provider
settling Arbitrum USDC, a malformed or mistyped destination is accepted and the
money is gone. The agreed fix is to require the address to equal the
authenticated user's own Privy embedded wallet, enforced server-side.

Related, and now largely moot but worth recording: the `DepositPage` "Use Privy
wallet" toggle is a dead end while the network is TRC20. It resolves the payout
to the user's `0x…` address (`DepositPage.tsx:303`), skips the TRC20 validation
that guards the other tab, and enables the CTA anyway (`:485`) — then the server
rejects with `400 INVALID_PAYOUT_ADDRESS`. It is a hard 400 after the user has
entered an amount, **not** a fund-loss path. The toggle only renders when the
network is TRC20 (`:605`), so switching the network to Arbitrum resolves it.

## Chain switching — the answer is "don't build it"

For a Privy *embedded* wallet there is no switch prompt at all. `App.tsx`
sets `defaultChain`/`supportedChains: [arbitrum]`, and `hooks.ts:1197` passes
`chainId: arbitrum.id` straight to `sendTransaction`.

TON and TRON are **not switch targets** — they are different key types with
different address formats. One Privy *user*, several Privy *wallets*. If they
are ever provisioned, `api/profile/_lib/identity.ts` currently resolves a single
`wallet_address` by scanning `linked_accounts` for the embedded Ethereum wallet,
and would need a table keyed `(privy_user_id, chain_type) → address`. For TON it
must also store the **wallet contract version**, because the same ed25519 key
yields a different address under V4 versus W5/V5R1.

What users actually need is an **asset/network picker** on deposit and withdraw:
a form field and a validator, not chain plumbing. Move `isValidTrc20Address` out
of `DepositPage.tsx:43` into the SDK so deposit and withdraw share one rule.

**Never sum an off-venue balance into the hero equity figure.** A TON or TRON
balance is off-venue *and* off-Arbitrum: not tradeable, not margin, not
withdrawable through the existing path. Render it as an in-transit line with an
ETA and the blocking step named.

## What Privy does, and does not do

Verified against Privy's own OpenAPI spec and docs.

### Native — configuration only

- **TON and TRON wallets under one identity.** `chain_type` accepts `ton` and
  `tron`; one `did:privy:…` owns all wallets.
- **TRON signing and broadcast.** `tron_sendTransaction` both signs and
  broadcasts, and fetches fresh `ref_block_bytes`/`ref_block_hash`. Models
  `TransferContract` and `TriggerSmartContract` (TRC-20). 21 TRON-specific
  schemas in the spec.
- **TRON policy engine**, default-deny, able to gate recipient, amount and
  TRC-20 calldata. **No TON equivalent exists.**
- **TRON balances and funds webhooks** — TRON deposit detection is native.
- **Server-side authority** via `/v1/wallets/{id}/rpc` and `/raw_sign`,
  app-secret authenticated. Use `privy-idempotency-key` (24h window) — it is the
  difference between a retried sweep and a double withdrawal.
- **Hyperliquid recipes are first-class**: agent wallets, policy-gated trading,
  deny rules on withdrawals. Matches the agent-key model already shipped here.

### Buildable, but Privy only holds the key

- **TON address**: Privy does not return it. Fetch the raw ed25519 pubkey and
  derive the wallet contract address yourself.
- **TON transactions**: BOC/cell serialisation, jetton messages, seqno, fee
  estimation, broadcast against your own RPC, confirmation tracking — all yours.
  Privy signs a 32-byte hash. TON appears **three times in the entire OpenAPI
  spec**, all as a bare enum string.
- **TON wallet deployment** needs a minimum 0.05 TON, which a first-time user
  does not have. Sponsor it or the address is receive-only.
- **TRON signature format**: Privy returns 64 bytes; TRON wants 65 with a
  recovery byte. You append it.

### Requires a wholly separate system

- **Fiat on/off-ramp for TON or TRON.** Privy's onramp is
  `[ethereum, base, arbitrum, polygon, optimism]` × `usdc` × `usd`/`eur`, with
  SEPA/ACH/wire/FedNow/Faster Payments payout rails. **No TRON, no TON, no RUB.**
  This is empirical proof that the RU problem is not solvable by picking a
  better Western provider.
- **TON policy/guardrails** — no `Ton*` policy schema exists. Every safety
  property on a TON flow is your backend code.
- **Gas sponsorship** on either chain — documented for EVM and Solana only.
- **TON key import** — `WalletImportSupportedChains` has no `ton`.

**Do not use key export to bootstrap custody.** It exists and would work, but
the moment plaintext key material crosses the backend, a non-custodial product
becomes a custodial one, with the licensing consequences that follow.

### Hard blocker

`apps/tg-mini-app/package.json:17` pins `@privy-io/react-auth: ^1.80.0`. The
`/extended-chains` entrypoint arrived in **v2.15.0**. Nothing about TON or TRON
is reachable client-side until a v1→v3 migration lands. That migration also
unlocks Telegram OIDC, Mini App seamless auth, and the policy engine — worth
doing regardless. Expect breaking changes to `signMessage`, `signTypedData`,
`sendTransaction`, and renamed hooks.

## TRON's compliance surface

Recorded because the corridor is already live — `RUB-USDT` on `TRC20` is the
shipped default at `api/onramp/_lib/config.ts:28,36`. This is exposure, not a
hypothesis. Figures are as researched on 2026-08-30 and should be re-checked
before being relied on.

| Exposure | Consequence |
|---|---|
| **Sanctions concentration.** TRM reports $93B of 2025 inflows to sanctioned entities, ~95% via stablecoins; Russia-linked evasion up ~400% YoY. | A RUB-in / USDT-on-TRON-out corridor is scored high-risk by default by every analytics vendor and banking partner. Expect to justify it. |
| **Tether freeze authority.** In 2025, **84.2% of blacklisted addresses (3,506 of 4,163) were TRC20**, covering $853M; only **3.6%** were ever delisted. | Near-irreversible. Never hold pooled USDT in an operator-controlled TRON address — one tainted inbound freezes the pool and every user balance in it. |
| **Circle left.** USDC minting on TRON stopped 21 Feb 2024 and wound down through Feb 2025, citing an enterprise risk assessment. | **USDC-on-TRON does not exist**, which is why a conversion hop is unavoidable on that rail. The most conservative major issuer looked at TRON and walked. |
| **Provider designation risk.** Several Mercuryo-network entities appear on Poland's sanctions list; Quicko's Polish licence was revoked Jan 2026. Mercuryo is the on-ramp inside Telegram's own Wallet. | Diligence RU-facing fiat providers **continuously**, not once at integration. |

**Screening already exists and is switched off.** `api/platform/_lib/config.ts`
has `parseCountryList`, `prohibitedCountries`, `highRiskCountries` and
`isProhibitedCorridor`; `request.ts` has `sanctions_match` and
`high_risk_country`; `risk.test.ts` and `risk-derivation.test.ts` cover them.
But `api/platform/` contains only `_lib` — **there is no route file**, and every
importer is under `api/_parked/`. Somebody built this and shelved it. Unpark it
before making any crypto rail first-class.

## What to extend, not build

| Existing | How |
|---|---|
| `hl_deposits` + `rewards_deposit_checkpoints` (`020_hl_deposit_ledger.sql`) | **The best fact in this research:** detection is anchored on HyperCore, not on any source chain, so a deposit originating anywhere is recognised the moment it lands. No TON light client, no TRON watcher. Quests, the referral `funded` rung and rewards all keep working for free. Add a nullable `source_rail` column, and a `network` column to `onramp_orders`, or you cannot answer "is this rail working" or reconcile a stuck payment against a HyperCore credit. |
| `event_key` = `{hash}:{time}:{type}` | Reuse for route legs: `tron:{txid}:{log_index}`, `ton:{tx_hash}:{lt}` — TON needs logical time because a hash alone is not stable across shards. |
| Checkpoint pattern (forward-only `greatest()` advance, failure recorded without disturbing proven progress) | Instantiate once per chain. Already tested. |
| `payment_rails` / `platform_transactions` / `transaction_ledger_entries` (`004_platform_orchestration.sql`) | A ramp is a `payment_rails` row plus `platform_transactions` legs, not a new subsystem. Two changes needed: the status constraint has **no `outcome_unknown`** — a broadcast that timed out is neither processing nor failed — and `buildReversalEntries` writes symmetric contra-entries, which models an unwind. A fiat reversal arriving after an irreversible crypto leg must book a **loss to a house account**, or the ledger asserts money returned that did not. |
| `bridge_sponsorship_events` (`000_baseline_schema.sql:152-164`) | Right shape for "who did we sponsor and why". Note RLS **is** enabled with no policies (`010_enable_rls_on_exposed_tables.sql`), so it is deny-all — an earlier claim that it was anon-writable was wrong. Before wiring: `chain_id integer` is an EVM assumption fitting neither TON nor TRON, `token_address`/`bridge_address` are `0x`-shaped, and there is no column for what the sponsorship actually cost. |
| `apps/onramp-proxy` (5-route allowlist, HMAC, static-IP VPS) | The provider IP-allowlists; that is why the proxy exists. Any new provider will likely need the same. Budget the proxy hop rather than discovering it in smoke tests. |
| `api/onramp/_lib/provider.ts` | Right shape for swapping providers. It just has one implementation. |

## Open questions that survive

| Question | Who settles it |
|---|---|
| Does CCTP-delivered USDC on HyperEVM become HyperCore perps collateral, and by what action? | A 5 USDC test transfer, or Hyperliquid support. Until answered, treat HyperEVM as a dead end for collateral. |
| Does Hyperliquid intend to turn Bridge2 off, and when? Docs call it legacy. | Hyperliquid support. The constant lives in one place (`constants.ts:5`), which is the right shape for the eventual move. |
| Is there a Hyperliquid withdrawal **minimum**? Secondary sources say 2 USDC; primary docs state only the $1 fee. | Attempt a 1.50 USDC testnet withdrawal and read the error. Belongs in UI copy before launch. |
| Can an app authorization key be an `additional_signer` on a user-owned TON/TRON wallet, so `raw_sign` succeeds without a per-action user tap? | Privy solutions engineering, or a 30-minute sandbox test. Decides whether automated sweeps need user interaction. |
| Does `POST /v1/wallets/{id}/transfer` actually execute cross-chain, or is a TRON destination only valid same-chain? | One `/transfer/quote` sandbox call. |
| Toncoin was reportedly renamed **GRAM** (ticker TON → GRAM) effective 15 June 2026. *(likely — corroborated by LayerZero's API returning `{symbol:'GRAM'}`, not by a primary announcement)* | Confirm before any TON-facing copy ships; both `en.json` and `ru.json` would need it. |

## Superseded — do not act on the original brief's

- The TRON→Arbitrum conversion-vendor shortlist (USDT0 Legacy Mesh, Rango,
  Allbridge, ChangeNOW). MEXC replaces it.
- The staged TON build-out, TON Connect migration plan, and Wallet Pay
  evaluation. TON is out of scope beyond funding-from-holdings.
- "Close the TRON loop" as the headline deliverable. Arbitrum settlement means
  there is no loop to close on the on-ramp side.
- The compliance recommendation to email Telegram before scoping. Superseded by
  [`2026-08-31-telegram-mini-app-risk-decision.md`](2026-08-31-telegram-mini-app-risk-decision.md).
- Adding `USDT0` to `StableSwapAsset`. Explicitly declined.
