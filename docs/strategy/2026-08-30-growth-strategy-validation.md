# Validation of the growth-first moat design

**Date:** 2026-08-30

**Subject:**
[`../superpowers/specs/2026-08-27-telegram-execution-moat-design.md`](../superpowers/specs/2026-08-27-telegram-execution-moat-design.md)
— the 638-line growth-first positioning and acquisition design, on `main` as
`32c924ee`.

**Method:** Eleven dimensions examined independently against the repository, the
arithmetic and the public record — commit and migration citations, rewards
mechanics, fees and pricing, the referral ladder, the named blockers, internal
consistency, unit economics, timeline feasibility, positioning quality, external
and competitive facts, and compliance and abuse. Every finding was then passed to
an adversarial verifier instructed to refute it, with misquotation of the source
document an automatic rejection. **121 of 135 findings survived**; 14 were
discarded, including a claimed off-by-one on the retention window that proved
correct as written.

**Also published as** [The WNFT Problem](https://claude.ai/code/artifact/41fa1154-7a6e-4ac5-815e-81be88c238b6).

> Findings cite file paths and line numbers as of 2026-08-30. The repository moves
> quickly; two of the six blockers the subject document names were closed by
> commits made after it was written, and a third was half-closed by `09924519`
> while this validation was in flight. Re-check line numbers before acting.

---


## Verdict

**The structure is sound; one load-bearing definition is not, and it is the one money is paid against. Do not start acquisition spend against this document as written.**

The single thing that most needs to change: **the WNFT definition.** It is broken in five independent ways at once, and it is the unit that treasury CAC, affiliate CPA, referral XP and every success criterion are denominated in:

1. It is written in a unit the code does not implement — "two distinct **fills**" (L113, L427) vs `count(distinct t.order_id) >= 2` (`supabase/migrations/020_hl_deposit_ledger.sql:277`).
2. It is computed from `userFills.builderFee`, which your own migration `021` (commit `f8abdef9`, one day after the doc) says "does not say it paid **us**" — and `builder_fills`, the table that would prove it, is read by no qualification path.
3. A just-qualified WNFT is worth **$0.10** of gross builder revenue. You will pay dollars of CPA for it.
4. It is manufacturable for roughly **$1.50** all-in (~$0.20–$0.33 unrecoverable; the $50 is refundable collateral), and two attacker accounts crossing each other satisfy both bars at once at half the exchange fee.
5. The 2 bp newcomer lane makes it **2.5x harder**, not easier: $0.10 / 0.0002 = $500 of notional vs $200 at 5 bp — ~5x leverage per fill on a $50 account, which L256 says quests never reward.

Fix the definition first. Everything downstream is re-derived from it.

Second, separately and before any paid Mini App traffic: **P0-18 is misdiagnosed** (see (c)1).

---

## What survived validation

The doc earned real credit here, and it should not be lost in what follows.

- **Every arithmetic claim the doc actually makes is correct.** 100 + 6×25 = 250. $1M × 0.0005 = $500. 35+20+20+15+10 = 100. The referral XP table (inviter 0/0/750/1,500; invitee 0/250/250/500) reproduces `api/rewards/_lib/referrals.ts:24-31` exactly. The Retained/D30 window (days 22–30) matches `020:292-293` — an examiner claimed an off-by-one here and the verifier **refuted** it; I agree, the code implements elapsed days exactly as the doc words it.
- **Fee units are right on both sides.** 5 bp = `feeTenthsBp: 50` = `"0.05%"` (`packages/hyperliquid-sdk/src/builder.ts:7,42-44`), within Hyperliquid's 0.1% perps cap. This is the classic 10x trap and neither the doc nor the code falls into it.
- **All nine threshold defaults are the live production values.** $50 / 72h / 2 orders / $0.10 / 30d / 3 days / $1.00 / days 22–30 are declared defaults of `rewards_referral_milestones` and the caller posts `{}` (`api/rewards/_lib/supabase-admin.ts:1446-1450`). The numeric policy in the doc is the numeric policy in production.
- **Four of five commit citations are sound.** `69835525`, `a2fd79fb`, `00eaf2c2`, `17c2516c` are all squash-merges on `main` and match what the doc says they do. Only the referral one is broken.
- **"XP is never burned or converted into cash, credits or a token" is the strongest claim in the document and is structurally enforced.** `reward_kind` has no `credit` value, `payout.ts`/`raffle.ts` are unreachable from every deployed handler, `api/rewards/_lib/server-imports.test.ts` enforces that on the import graph, and migration `007` froze outstanding cash rows into a terminal `held` state.
- **"Referral XP receives no rank multiplier"** and **"each milestone is earned once in the referred user's lifetime"** both hold — the latter at the database unique constraint, not in application code.
- **The blocker list at L95-98 is accurate on four of six items**, and *understated* on a fifth. The agent-secret, liquidation-math, duplicate-order and campaign/CAC blockers are all real, correctly located, and correctly sized (P0-15 XL and P0-16 L are fair).
- **The delivery sequence puts the execution trust floor (P0-15..P0-20) ahead of paid acquisition.** That is the right ordering and the doc should get credit for it.
- **Requiring affiliates to be paid on confirmed WNFT rather than wallets or impressions** is correct, and so are the non-goals on impression/follower/wallet-creation rewards and on never blocking withdrawals for a growth hold.

---

## The problems, ranked by consequence

**1. WNFT is not a payable unit.** See the verdict. *Fix: redefine as "two distinct orders, each producing at least one `builder_fills`-confirmed fill, totalling ≥$500 of attributed notional", and gate on migration 021's table rather than `userFills`.*

**2. Telegram's published Blockchain Guidelines prohibit the delivery vehicle on their face, and P0-18 sizes that as an M documentation task.** *Fix: re-scope P0-18 to a structural decision — bot-without-Mini-App vs TON Connect vs accepting enforcement risk — and take it before spend.*

**3. There is no economic gate anywhere in 638 lines.** "LTV" appears 0 times; "payback" once (L142) as a bare noun with no formula, target or acceptance criterion. The CAC ceiling `B/250` is circular — at full spend it collapses to "WNFT ≥ 250", which is already criterion #1, and below full spend it is passed by underspending. `B` is never set. *Fix: write the per-user lifetime-notional assumption and a payback formula into the doc, set `B`, and replace `B/250` with per-paid-channel CAC on paid-attributed conversions plus a minimum learning spend.*

**4. The plan cannot start.** Wave 3 (P1-01/02 — the only paid acquisition items) sits after the "250-user step", and 250 is the entire 90-day target. And 250 cumulative + 50 in week 12 jointly mandate ~22%/week compounding (any linear ramp ending at 50 needs a negative week 1; a 0→50 ramp sums to 300). *Fix: make 25/100/250 a concurrent-exposure cap, start Wave 3 at the 25-user step, and drop one of the two headline numbers.*

**5. The trust floor is understated in exactly the places it is claimed as done.** P0-15's acceptance ("logout, wallet change and revoke remove local authority") is false on two of three: wallet change clears memory only and never calls `clearStoredAgentKey` (`hooks.ts:469-477`), and logout exists only as `"logOut": "Log out"` at `en.json:308` with zero code references. P0-20 is sized M with no state model at all — `needsReview` (`protection.ts:124-128`) is referenced only by its own test. Meanwhile P0-06 (XL) was ~90% delivered by migration `020` in the doc's own commit `32c924ee`, and P0-07 (M) is a ~700-line migration-021 stack the doc never mentions. *Fix: re-baseline P0-15's acceptance text, re-size P0-20 upward and P0-06 down to S, re-size P0-07 to L.*

**6. Compliance has no owner and no code.** Zero geo gate, restricted-territory list, terms acceptance or jurisdiction check anywhere on the live surface (the only country machinery is parked in `api/_parked/`, and Terms/Privacy are two blank env vars behind Account > Legal). "Manual review" names no entity, no reviewer, no criteria, no evidence standard, no record. Hyperliquid's own terms bar the US and Ontario. *Fix: make geo eligibility part of the campaign registry and the WNFT definition, and give the money-movement gate a named owner, criteria and an audit record — or it will be ticked by whoever needs it ticked.*

**7. Pricing contradicts itself in three places.** The 0 bp reduce-only lane destroys the evidence WNFT requires (`isAppAttributedFill` is strictly `> 0`; revoking the builder fee is *implemented* as approving `"0%"`, so 0 bp and revoked are indistinguishable). The shipped fee row is a hard-coded `sizeUsd * 0.0005` (`TradePage.tsx:595,823`) that shows $0.50 on a $1,000 taker order that truly costs ~$0.95 — a 47% understatement — while L264 claims the split display already exists. And the 20% subsidy bucket can absorb at most $7.50/user × 250 = $1,875. *Fix: delete the 0 bp lane, show native + P34K separately from a real fee-tier source, and move fee subsidy out of the cash allocation.*

**8. Every experiment in P1 is unpowered against the sprint's own N.** Eleven arms × ten conversions = 110 of 250 WNFT consumed just to reach the declaration floor, on users enrolled in multiple simultaneous tests. At n=10 the Poisson 95% CI on CAC is [0.54x, 2.09x]; the 125% stop rule fires at random. The scale gate's 99.99% needs 30,000 clean observations (rule of three) against a cohort floor of 500 fills. *Fix: cut to 2–3 arms total; restate the scale gate as zero-defect at a stated N with a confidence bound.*

---

## (a) Factual errors about the codebase — mechanical

| # | Doc | Reality | One-line fix |
|---|---|---|---|
| 1 | L91, L421 cite `4612df3e` | Unreachable object; no branch contains it; not an ancestor of `main`. Shipped as `bed0adee` (#19) | Swap the hash |
| 2 | L91/L421 pin the ladder to migration `019` | `020:191` does `create or replace` on the same signature under 3 minutes later (17:36:57 → 17:39:44), moving `funded` from `onramp_orders` to a cumulative `hl_deposits` net that must clear $50 both then and now | Cite `019` + `020` |
| 3 | L113, L427 "two distinct **fills**" | `020:277` counts `distinct t.order_id` | Say "orders" |
| 4 | L218 "`0 / 1 / 3 / 6` milestone weights" | Inviter is 0/0/3/6, invitee 0/1/1/2 (`referrals.ts:26-31`); 500 XP needs weight 2, absent from the stated schedule. The same wrong label is at `referrals.ts:12` | Fix both places; state two vectors |
| 5 | L87/L427 "migrations `016`/`017` add daily check-ins, ranks…" | `016` adds streak/lifetime *queries*; check-in lives in `api/rewards/check-in.ts`; `017` is two unrelated bug fixes; rank thresholds are in code on purpose (`tiers.ts:6-9`), in no migration | Re-describe; add `tiers.ts` + `check-in.ts` to P0-11's acceptance |
| 6 | L231 "streak … derive from the append-only ledger" | `rewards_check_in_streak` filters `and l.season_id = p_season_id`, and a season is `date_trunc('month')` (`012:57-58`). **Every streak resets on the 1st.** No user can hold 250 XP/day on days 1–6 of any month | Decide season-scoped vs lifetime, then change `016` or the doc — and re-derive "streak at risk" and P1-06 |
| 7 | L235 "The check-in screen always shows the highest-impact incomplete step" | Not built. `PointsPage.tsx:263-285` shows streak/day/next-XP only; quests are a flat map in fixed construction order (`engine.ts:307-353`). P1-06 schedules it | Move the sentence out of "the existing implementation is preserved" |
| 8 | L242 "Rank unlocks status, badges, leagues, saved-alert capacity, campaign eligibility" | Rank does exactly one thing: a `tier_bonus` row on check-in. `tierBonusFor` has one production caller (`check-in.ts:92`). No badge/league/alert-cap code exists; P2-04 schedules two of them | Replace with "rank currently adds a check-in bonus only" |
| 9 | L240 "existing rank thresholds remain the launch baseline" | Basecamp→Climber is 2,500 season XP at 1 XP/$1 notional inside a calendar month. A just-qualified WNFT holds ~200 XP. The entire acquisition cohort finishes at multiplier 1.0 | Re-scale for newcomers as a P0 decision, or stop calling rank a lever for this cohort |
| 10 | L264 "Every review shows native Hyperliquid fees and the P34K fee separately" | One undifferentiated "Fee" row, hard-coded `* 0.0005`, not even read from `getBuilderFeeTenthsBp()` — a 2 bp lane would still render 5 bp | Delete the present-tense claim; L95 already has it right |
| 11 | L97 "onramp-only referral funding evidence" | Fixed by migration `020` in `32c924ee` — the same commit that added this doc. Only staff/test/internal-account exclusion remains (grep for `staff`/`employee`/`is_test`: zero hits) | Strike the blocker; re-size P0-06 XL → S |
| 12 | P0-05 "expose pending/held/reversed reasons" | No such state exists; every entry writes `status: "posted"` unconditionally (`referrals.ts:81,101`), and there is no reversal path for `source='referral'` in `api/` | Re-size P0-05 above M; it is a hard dependency of P0-13 |
| 13 | Non-goals L511/L513 (no raw-volume boards, no absolute position sizes) | `rewards_season_leaderboard` orders by `total_volume desc` and returns `eligible_volume`, rendered per-entry as USD (`PointsPage.tsx:417`) beside a permanent `md5(uuid)` alias | Drop volume from the row, or drop the non-goal |
| 14 | L214 inviter Funded = 0 | The app still ships a "Funded referral — 500 XP" quest card that completes with a full progress bar and pays nothing (`engine.ts:328-337` vs `fill-sync.ts:396-399`) | Remove the card or the reward label before the pilot |
| 15 | Pilot gate "current … migrations are deployed" | Doc stops at `019`; `main` has `020`, `021`; `022` exists only on this branch (`7b34b3aa`); `023` is untracked | Enumerate the set in the gate; commit `023`, merge `022` |
| 16 | P0-09 "requested fee are stored per order" (L) | The fee is a module-level `_config` set once at boot from a Vite build-time env var; `getBuilderConfig()` is zero-arg and serves all six order paths; there is no orders table and no order endpoint | Re-size above L; name the on-chain approval-max constraint as part of the design |
| 17 | §6 treats builder revenue as one stream | Code defaults to `0x99E3…Fb5D`; `TELEGRAM_BOT_SETUP.md:58` documents `0x1924…80e5`; `config.ts:82` has no default and hard-errors. The daily export is keyed by address | Pin one address as a launch config item in the pilot gate |

---

## (b) Internal contradictions and arithmetic errors

Beyond ranked items 3, 4, 7 and 8:

- **Treasury `B` does two incompatible jobs.** Fee subsidy is *foregone revenue*, not cash, and the direct-referral line is non-cash during the sprint (L290) — so up to 40% of `B` is imputed while the CAC ceiling and P0-01 treat it as one spendable pool. *Fix: split into a cash envelope and a foregone-revenue cap.*
- **The 20% subsidy line is unspendable above B ≈ $9,375.** (5−2 bp) × $25,000 = $7.50/user; × 250 = $1,875 max; ~$0.15/user at the qualification floor. 0.20·B = $1,875 implies a $37.50 CAC ceiling. *Fix: rename it a credits bucket, or raise the lane caps.*
- **Two non-identical definitions of success.** L155-161 has the 40% channel cap; L468-476 has "two independent channels" and "referrals ≥20%". Neither cross-references. The gate's last condition — "higher retention is not purchased solely by progressively larger rewards" — has no metric, contradicting the DoD at L622. *Fix: merge into one list; quantify or delete that condition.*
- **"Week 12" ≠ "final week."** 90/7 = 12.86 weeks; week 12 is days 78–84, the final week is 85–90. With the 72h hold, acquisition must stop ~day 81 to count toward the gate. *Fix: define the sprint as 84 days.*
- **D30 is unmeasurable for ~60% of the cohort** (only users qualifying by day 60 count), and it is not revenue-weighted — one $50 fill in a nine-day window passes, at $0.025 of revenue. The referral Retained rung already carries the fix. *Fix: read D7 at day 90, D30 at day 120; apply the $1.00 fee condition to the north-star D30.*
- **P2-09 relaxes a non-goal.** L508 requires creators "prove lower WNFT CAC"; L490 reopens on "beat the median channel on WNFT CAC **or** D30". *Fix: make it AND.*
- **Ten seed affiliates collide with P2-01's ten-user suppression floor** — ~10–12 WNFT each, unreportable to the partner and unusable for the ten-conversion CAC rule. *Fix: seed 4–5.*
- **The Size column is never defined and no team size appears anywhere.** P0 is 2 S / 7 M / 8 L / 3 XL — 36 to 72 engineer-weeks against a 12.86-week calendar. *Fix: publish the t-shirt→weeks mapping and headcount, or the schedule cannot be checked by anyone.*

---

## (c) External and competitive facts that are wrong or unverified

1. **Telegram Blockchain Guidelines (verified by fetch).** Mini apps must "Exclusively use the TON Blockchain", and "Only interface with cryptocurrency wallets connected by the TON Connect SDK." Explicitly Not Permitted: *"Connecting an Ethereum wallet to sign a transaction within the app"*; *"Rewarding users for connecting a wallet from blockchains such as Ethereum, Bitcoin, etc."*; *"Directing or linking users to external platforms or websites where cryptoassets not based on TON are promoted or utilized."* Deadlines were 2025-02-01 and 2025-02-21 — long past. Exemption: *"Regular Telegram bots that do not have a Mini App component are exempt."* This repo is a Mini App (`index.html:11` loads `telegram-web-app.js`), signs EIP-712 from a Privy embedded EVM wallet, and contains zero TON Connect. The doc's "escape hatch to the official interface" (L68) and P2-10 are themselves the cited prohibited example. **Caveat: I verified the rule text, not enforcement. Many EVM mini apps operate today; the risk is discretionary, not certain.** *Fix: re-scope P0-18 to the structural decision and take it before spend.*
2. **The all-in fee is never stated.** HL tier-0 is 0.045% taker / 0.015% maker. 5 bp is **+111% taker, +333% maker**; 2 bp is +44% / +133%. P2-12's "compare 2/3/5 bp" is comparing +44%, +67% and +111% cost increases. *Fix: state all-in cost everywhere the fee appears.*
3. **The #1 named threat is zero-fee.** Lighter Standard accounts pay 0 maker / 0 taker; the Telegram Wallet integration launched 2026-04-02, custodial, 50+ markets including metals, stocks and oil. The doc's response row contains no price argument. *Fix: rewrite the row or concede the segment.*
4. **"Clearer fee subsidies" vs Perps.bot is false.** Perps.bot is 0.05% base with a **permanent** 10% referral discount → 0.045% effective. Its modal referred user pays 9.0 bp all-in vs P34K's standard 9.5 bp. P34K is cheaper only inside the 30-day / $25k window. *Fix: change the response to progression + execution safety.*
5. **FOMO is missing from the competitive table.** Telegram Mini App + iOS/Android on Hyperliquid, identical 0.05% builder fee plus $1/trade (~0.095% all-in), copy trading live since April 2026, 24h protocol revenue above Hyperliquid's own on 2026-08-16 — eleven days before this doc. Closer than Dreamcash or "super apps". *Fix: add the row.*
6. **Hyperliquid's own referral program is cited (L626) and never used.** Setting P34K's code on wallets it creates yields ~0.432 bp/fill (+8.6% on top of 5 bp) *and* cuts the user's native taker fee from 4.5 to 4.32 bp — the single best answer to "no third-party builder surcharge". `grep setReferrer|referralCode` in the SDK: nothing. *Fix: set the code at wallet creation; add to P0-09.*
7. **Hyperliquid shipped an official Android app on 2026-04-01 whose entire MVP scope is fill push notifications** — precisely the differentiator claimed at L68 and invested in at P2-06 (L). *Fix: re-weight P2-06.*
8. **Builder-side preconditions are absent from the pilot gate:** the builder must hold ≥100 USDC perps account value and use `standard` account abstraction mode; each user may hold at most 10 active builder-code approvals. Below the floor, every fill silently stops being attributable. *Fix: add both to the gate's monitored preconditions.*
9. **`ApproveBuilderFee` must be signed by the main wallet, not the agent**, and the code approves a max equal to the configured fee (`builder.ts:58-64`). P1-05's "assignment shown before builder approval" therefore leaves 2 bp users unable to trade on day 31 without a second Privy signature at the exact moment their price rises. *Fix: always approve the 5 bp ceiling and charge 2 bp per order.* Silver lining the doc should claim: the on-chain approval max means price genuinely **cannot** change silently — a stronger disclosure story than P1-13's process promise.
10. **Unverified, five-minute check:** `vercel.json` sets `X-Frame-Options: DENY` for `/(.*)` over the mini-app dist while also using the legacy `routes` key, which Vercel documents as mutually exclusive with `headers`. Telegram web clients iframe Mini Apps. Curl the deployed HTML before treating this as a P0-18 issue.

---

## (d) Strategic judgement I disagree with — this is a debate, not a fix

1. **The business as specified has no unit that can repay a CAC.** Qualification is $0.10 of gross revenue; retained is $1.00; a newcomer who exhausts the entire 2 bp allowance is worth $5.00. Repaying a $25 CAC at 5 bp needs $50,000 of lifetime notional — 1,000x a $50 account. The doc never writes a per-user volume assumption. My position: either the funnel targets accounts an order of magnitude larger than $50, or acquisition must be organic/zero-CAC and a treasury sprint is the wrong instrument. The doc should make that argument, not skip it.
2. **The evergreen "≤50% of settled builder revenue" rule is not a sustainable successor.** At 20% D30 (~80% monthly churn), holding a flat user base requires 3,200 × CAC of monthly notional per retained user — $80,000/month at $25 CAC. `N` cancels, so scale does not help. There is no self-funding path in this document, only a treasury one.
3. **The lead differentiator is false for the cohort the funnel acquires.** Login is email/sms/telegram with `createOnLogin: "users-without-wallets"` (`App.tsx:361-379`): a fresh Privy wallet, no collateral, no history, tier 0. The doc's own funnel puts "Telegram wallet created" *before* "Hyperliquid account funded". Continuity is real only for an existing HL trader importing a key, and no backlog item provides one. Build the import path or drop the claim.
4. **"Earn progress" is a strictly dominated currency.** pvp.trade runs a visually identical level ladder paying 5–30% USDC rakeback plus 10/3/1% referral cash at a 10 USDC claim floor. P34K's XP redeems for nothing by design — while the shipped app says "Claim coming soon" (`en.json:266`), "Weekly pool: TBD" (:256) and "Cash rewards and the weekly raffle are **paused**" (:244) against a payout leg that is structurally unreachable. Fix that copy regardless; the strategic question is whether a non-convertible scoreboard is a switching reason for someone paying a surcharge. I do not think it is.
5. **The strongest available position is sitting unused inside a competitive-table cell:** *P34K is the fastest way to notice and act on a Hyperliquid position from your phone, and it costs 5 bp.* That is a product claim, it survives day 91 and the subsidy's expiry, and it is testable in a week with no engineering. The current promise leads with progress and benefits — the thing the doc has decided will never be worth anything. It also asks for a referral in the sentence a stranger reads first; cut that clause.
6. **Sequencing: a 20-item measurement build gates the first acquired user, but the untested constraint is demand, not attribution precision.** Two cheaper tests are in no backlog item: (i) publish the promise line into three Telegram perp channels behind three t.me deep links and measure click → start → stated intent; (ii) a ~25-user concierge pilot with one static code per channel, one uniform fee lane, and funded/traded reconciled by hand from builder-attributed fills the repo already produces. Only P0-15/16/19/20 are genuinely non-deferrable — they are safety, not measurement.
7. **Creators-as-replaceable-channels is the right call for the wrong reason.** The right reason is margin structure: pvp.trade transfers 10/3/1% plus rakeback permanently, which a 5 bp business with $1–5 per retained user cannot fund. "Replaceable" is weaker and does not survive the counter that creator networks are a *retention* mechanism. The doc owes a non-social answer to "why is the app opened on a day the user wasn't going to trade", and "streak at risk" — on a streak that silently resets on the 1st — is not it.
8. **P0-13's five anti-sybil signals do not survive contact.** Self-referral has no cap, velocity rule or rate limit (`program.ts:318-339` blocks only literal same-user); duplicate identity has nothing to key on because email login makes identities free; circular funding and shared destination die after one non-P34K hop; and correlated trade patterns is self-defeating because the doc's own activation journey (L194-201) prescribes the identical pattern. The real defence (P2-11, XL) is scheduled *after* the sprint — the sprint is its training data, bought at full CAC from the adversary. The qualification bar needs a cost floor, or holds have to be manual and slow. Note the irony: migration `020` correctly accepting a plain Hyperliquid `send` as funding (`deposits.ts:63,137`) is exactly what collapses the attacker's capital-rotation cost to zero.

---

## Edges of this audit — what could NOT be verified

- **Deployment state.** Everything here is repo state. Nobody checked which migrations are actually applied to the production Supabase, or which builder address each environment runs. The pilot gate's "deployed and verified in the target environment" is unresolvable from outside.
- **Telegram enforcement posture.** The rule text is verified; enforcement is not, and is discretionary.
- **Whether `f=0` fills appear in Hyperliquid's daily `builder_fills` export.** The builder-codes docs do not say. The 0 bp lane's attribution is unresolved by *evidence*, not just by this codebase.
- **Whether `X-Frame-Options: DENY` actually reaches the deployed response** (the `routes`/`headers` conflict in `vercel.json`).
- **Competitor facts** (Lighter zero-fee, Perps.bot 0.045% effective, pvp.trade rakeback, FOMO revenue, the HL Android app) come from vendor docs and press as of today. No pricing was checked live in-product.
- **Velocity.** The repo has 9 weeks of zero commits followed by a 3-day, 15-PR burst. No sustainable rate exists to project P0 against — the record spans a 20x range (2 weeks to 41 weeks for P0). No schedule claim in this report is a schedule claim.
- **Working-tree state.** Migration `023_largest_trade_progress.sql` is untracked and four files are uncommitted. Part of this audit read state no one else can see.

---

## Next actions, in priority order

1. **Rewrite the WNFT definition** — orders not fills; notional-denominated bar; gated on `builder_fills` from migration `021`, not `userFills.builderFee`; with a cost floor that prices out the $1.50 attack. Then re-derive CAC, CPA and the referral rungs from it.
2. **Re-open P0-18 as a structural Telegram decision** and answer it before any paid Mini App traffic.
3. **Write the per-user lifetime-notional assumption and a payback formula into the doc, set `B`,** and replace the `B/250` ceiling with per-paid-channel CAC on paid-attributed conversions plus a minimum learning spend.
4. **Fix the 17 mechanical doc-vs-code errors in (a)** — half a day — and commit `023`, merge `022`.
5. **Fix the sequencing:** 25/100/250 becomes an exposure cap, Wave 3 starts at 25, drop either "250 cumulative" or "50 in week 12", and publish the Size scale plus a headcount.
6. **Kill the 0 bp lane, always approve the 5 bp ceiling, and make the fee review show native + P34K from a real fee-tier source.**
7. **Before writing more spec, run the two cheap tests** — the one-week three-channel link test on the promise as written, and a 25-user concierge pilot on the trust floor alone (P0-15/16/19/20). Decide from that whether the 20-item measurement build earns its calendar.
8. **Fix the user-facing copy that contradicts the doc** — "Claim coming soon", "Weekly pool: TBD", the 500 XP "Funded referral" card, and per-user USD volume on the leaderboard.