# Telegram Mini App policy exposure — decision to accept, for now

**Date:** 2026-08-31

**Decision:** Accept the risk. Keep shipping the Mini App as it is. Revisit on
any trigger listed at the bottom.

**Status:** Deliberate, taken with the exposure understood. This file exists so
that it is not rediscovered later as a surprise, and so the next person to find
it knows it was a choice rather than an oversight.

## What the rules say

From [Telegram's Blockchain Guidelines](https://core.telegram.org/bots/blockchain-guidelines),
fetched and quoted verbatim on 2026-08-30. A Mini App must:

> Exclusively uses the TON Blockchain for the creation and distribution of
> cryptocurrency tokens or blockchain assets.

> Only interfaces with cryptocurrency wallets connected by the TON Connect SDK.

Explicitly **not permitted**, and this is the clause that binds us:

> Connecting an Ethereum wallet to sign a transaction within the app.

Also not permitted, and worth noting because it touches the rewards programme:

> Rewarding users for connecting a wallet from blockchains such as Ethereum,
> Bitcoin, etc.

The transition deadlines in the guidelines were 2025-02-01 and 2025-02-21. Both
are long past.

### The two carve-outs, and why neither clearly covers us

**Bridging.** "Allowing other wallet connection protocols that are intended for
bridging assets" is permitted, illustrated with connecting a Bitcoin wallet to
bridge BTC *into* TON. The rule text is direction-neutral; every illustration
imports into TON. Our Arbitrum activity bridges toward a non-TON venue. A
literal reading might cover the deposit; a purposive reading does not.

**Multichain wallets.** Managing other-chain assets inside the app is permitted
— but every permitted example is a multichain **TON** wallet: "Multichain TON
wallets that let users send and receive Bitcoin, Ethereum and other
cryptocurrencies", "A multichain wallet that interacts with apps only through
TON Connect". We have no TON support at all, so we are not inside this
allowance today.

A "ToS clause 7.3" covering multichain wallets is sometimes cited for this. It
could not be located: <https://telegram.org/tos/mini-apps> has sections 1–7 and
section 7 is "Changes to MA Terms". **Do not cite 7.3 to anyone.** The substance
above is on the Blockchain Guidelines page; the clause number is not real.

## What we actually do

We are a Mini App — `apps/tg-mini-app/index.html` loads `telegram-web-app.js` —
signing EIP-712 from a Privy embedded EVM wallet, with no TON Connect anywhere.

The exposure is **three signatures, not every trade**. Orders are signed by a
locally generated agent key held in the client
(`packages/hyperliquid-sdk/src/client.ts` — `agentPrivateKey`,
`agentWalletClientInstance`), which involves no wallet connection protocol at
all. Only these three use the user's Privy EVM signer:

| Signature | Where | Defence under the carve-outs |
|---|---|---|
| `approveAgent` | `packages/hyperliquid-sdk/src/client.ts:1940` | **None.** An Ethereum wallet signing a non-bridging authorisation inside a Mini App — the prohibited example almost word for word. |
| Bridge2 deposit | `packages/hyperliquid-sdk/src/hooks.ts:1187-1199` — ERC-20 `transfer` to `HL_BRIDGE_ARBITRUM`, `chainId: arbitrum.id` | Weak but real. It is unambiguously bridging, which is the one carve-out that exists. |
| `withdraw3` | `packages/hyperliquid-sdk/src/client.ts:2423` | Weak. Signed by the main wallet by protocol requirement, as the comment there records. |

The code says this plainly already, at `client.ts:383`: *"Main wallet client —
uses the Privy signer. Only for setup actions (approveAgent,
approveBuilderFee)."*

## Why accept it

The channel is the distribution advantage; removing the Mini App to comply
removes the reason the product exists in Telegram. Regular bots without a Mini
App component are explicitly exempt, so a compliant shape exists — it is just
not the product we are building.

Enforcement cadence is unclear. Grammos, a mini app reported to have had
200,000+ users, is reported to have shut down citing this policy — *this is
search-derived and has not been confirmed against a primary source.* No
documented case was found of Telegram forcibly removing a still-operating EVM
DeFi mini app, and several such apps run today. That argues for a scheduled
migration if one is ever needed, not an emergency.

## What we are not pretending

- **Adding TON does not fix this.** A TON funding rail leaves `approveAgent`
  exactly where it is. Provisioning TON wallets inside Privy is
  compliance-neutral at best, because the rule asks for wallets *connected by
  TON Connect*, not wallets *on* TON.
- **The real mitigation is moving the EVM signatures server-side**, starting
  with `approveAgent`. That is worth doing on its own merits and is independent
  of TON. It is not scheduled.
- Whether server-side EVM signing still counts as the app "interfacing with" a
  non-TON wallet is **unresolved**, and only Telegram can settle it.

## Revisit if any of these happens

- Telegram replies to a written enquiry about the bridging carve-out's direction
  or the multichain allowance. No enquiry has been sent.
- Any documented enforcement against an operating EVM mini app, or a change to
  the guidelines page above.
- **Before spending money on paid Mini App traffic.** Acquiring users into a
  channel that can be withdrawn is a different risk from serving the users
  already there, and this decision does not cover it.
- Before a rewards campaign that pays users in connection with an EVM wallet,
  given the second prohibition quoted above.
- If `approveAgent` moves server-side, revise this file rather than delete it.

## Related

- [`2026-08-30-growth-strategy-validation.md`](2026-08-30-growth-strategy-validation.md)
  — where this was first raised, as the second-ranked problem.
