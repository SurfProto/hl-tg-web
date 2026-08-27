# P34K Growth-First Moat and 90-Day Design Backlog

**Date:** 2026-08-27

**Status:** Growth-first direction approved in conversation; written
specification awaiting review

**Decision:** Run a treasury-funded 90-day growth sprint whose primary outcome
is weekly new funded-and-traded users. Product work is prioritized by its effect
on acquisition, activation, referral, retention or safe scaling. Creators and
communities are replaceable acquisition channels, not the product thesis.

## Executive summary

P34K should not begin by building a creator network, a general financial super
app or a desktop terminal. It should build the most effective Telegram-native
funnel for turning a perp-curious user into an active Hyperliquid trader:

```text
Campaign, affiliate or referral
  -> Telegram wallet created
  -> daily check-in and activation quests
  -> Hyperliquid account funded
  -> two P34K-attributed trades
  -> funded-and-traded qualification
  -> invitee benefit and acquisition reward
  -> streak, rank, credits and useful alerts
  -> user invites the next trader
```

The sprint uses treasury budget to overcome the cold start. Builder-fee revenue
is measured, but it does not need to fund the initial acquisition offer. This
resolves the earlier contradiction between a low introductory fee and a large
reward pool.

The moat is not points by themselves. It is the accumulated system that can:

1. acquire Telegram perp users through many interchangeable channels;
2. attribute every wallet, funding event and P34K trade to the correct channel;
3. pay only for verified funded-and-traded users rather than clicks or wallets;
4. convert activated traders into direct referrers;
5. retain them through daily habit, progression, fee benefits and account
   utility; and
6. learn which channel, offer and cohort creates retained, economically useful
   Hyperliquid traders at the lowest cost.

If it works, competitors can copy a quest or a leaderboard but not P34K's
channel relationships, conversion history, fraud graph, cohort economics and
habitual Telegram distribution at once.

## Positioning

The user-facing promise is:

> Start trading Hyperliquid from Telegram, earn progress every day, and unlock
> better benefits as you fund, trade and bring real traders with you.

P34K preserves the strongest product advantage it already has: a trader uses
the same Hyperliquid account, collateral, positions, history, markets and fee
tier that remain visible through the official interface. The user does not
need to migrate to another perp venue to participate in P34K's growth program.

### Competitive implications

| Threat | What it wins on | P34K response |
|---|---|---|
| Telegram Wallet plus Lighter | Default Telegram distribution and a simple venue entry point | Hyperliquid account continuity, all supported Hyperliquid/HIP-3 markets, stronger progression and a referral program optimized for verified activation. |
| Official Hyperliquid frontend | Canonical feature set and no third-party builder surcharge | Telegram acquisition, daily habit, quests, referrals, notifications and rapid mobile actions; retain the official interface as an escape hatch. |
| Perps.bot | Hyperliquid trading in Telegram, natural-language trading and an aggressive three-level referral offer | Clearer fee subsidies, stronger daily progression, direct funded-and-traded rewards, partner/card discovery and safer execution receipts. |
| pvp.trade | Groups, levels, rakeback, clans and multi-level referrals | Simpler direct attribution, lower fraud surface, explicit qualification, daily check-ins and rewards that favor activated and retained users over referral depth. |
| Based, Dreamcash and financial super apps | Broad wallet, rewards and card narratives | Stay focused on Telegram perp activation; test card demand through referrals before taking on card-program complexity. |

Creators, channel owners and communities may be excellent traffic sources, but
P34K initially treats them as affiliates with campaign links and verified CPA
reporting. Creator signals, reputation and revenue sharing ship only if creator
cohorts beat other channels on funded-and-traded CAC and retention.

### Current foundations and remaining blockers

The repository already contains the parts of the growth engine that should be
extended rather than rebuilt:

- commit `69835525` and migration `014` reconnect referral links and make XP
  and leaderboard projections rebuildable;
- commit `a2fd79fb` and migration `015` add notification delivery status and a
  self-test path;
- commit `00eaf2c2` plus migrations `016`/`017` add daily check-ins, streaks,
  season ranks and lifetime XP; and
- commit `17c2516c` plus migration `018` attribute trading XP through positive
  builder fees instead of a public client-order tag; and
- commit `4612df3e` plus migration `019` add lifetime
  dry/funded/traded/retained referral evidence and the `0 / 1 / 3 / 6` XP
  ladder adopted below.

Material launch blockers still include the browser-stored agent secret, a
hard-coded trade-fee estimate, simplified liquidation math, ambiguous
timeout/retry outcomes, onramp-only referral funding evidence and the absence
of campaign/CAC attribution.

## North star and reporting contract

### Primary metric

**Weekly new funded-and-traded users (WNFT)** is the number of unique P34K users
who qualify for the first time during the reporting week.

A user qualifies when all of the following are true:

- the P34K identity and Hyperliquid account have not qualified previously;
- at least $50 of qualifying net-new funding is present for 72 hours;
- funding may arrive through P34K's onramp, a bridge, transfer or any other
  supported Hyperliquid funding route;
- the user has at least two distinct P34K builder-fee-attributed fills;
- the fills produce at least $0.10 in cumulative P34K builder fees and occur
  within 30 days of the first qualifying funding event;
- the account is not a test, employee, self-referral, duplicate-owner or held
  abuse account; and
- fill and funding evidence survives replay and reconciliation.

The user is counted in the week qualification becomes confirmed, not the week
the wallet was created. A provisional same-day number may be displayed, but it
must never be mixed with confirmed WNFT.

### Funnel metrics

Every channel and campaign reports:

```text
measurable open
  -> authenticated wallet
  -> first check-in
  -> funded
  -> first P34K fill
  -> confirmed funded-and-traded
  -> D7 active
  -> D30 retained
  -> first qualified referral
```

Required supporting metrics are conversion at every step, median time between
steps, confirmed CAC per WNFT, D7/D30 retention, builder revenue, incentive
cost, suspected-fraud rate and payback. A user is D30 trading-retained when at
least one P34K-attributed fill occurs during days 22–30 after qualification.
Wallets, raw volume, XP and daily active users are diagnostics rather than the
north star.

Confirmed CAC includes attributable paid media, released partner CPA, realized
fee subsidy, redeemed credits and campaign-specific operating cost, divided by
confirmed WNFT. Issued but unredeemed credits are reported separately as an
outstanding covered balance.

### 90-day planning target

The initial planning target is:

- 250 cumulative confirmed WNFT during the sprint;
- at least 50 confirmed WNFT in week 12;
- at least 20% D30 trading retention among cohorts old enough to measure;
- confirmed CAC no higher than the treasury ceiling;
- no single paid channel producing more than 40% of confirmed WNFT; and
- fraud/hold loss below 5% of acquisition spend.

Before spend begins, the treasury owner sets a fixed sprint budget `B`. The
portfolio CAC ceiling is `B / 250`. A campaign pauses after at least ten
confirmed conversions if its projected CAC exceeds 125% of that ceiling unless
an explicit learning exception is recorded.

## Growth engine design

### 1. Channel and campaign registry

Every acquisition source is one of:

- direct user referral;
- affiliate or Telegram channel;
- paid Telegram placement;
- ecosystem or card partner;
- creator experiment; or
- unattributed organic.

Each source receives signed campaign links with source, campaign, creative,
offer and policy versions. A user's first eligible acquisition referrer is
immutable. Later campaigns may receive session-level influence attribution but
cannot steal the acquisition reward.

### 2. Activation journey

An invited user lands in a short Telegram journey:

1. create or recover the Privy-backed account;
2. see the active newcomer offer and its expiry;
3. complete the daily check-in;
4. fund the Hyperliquid account;
5. understand and approve the trading agent and builder fee;
6. place the first reviewed order;
7. complete a second genuine P34K-attributed order; and
8. see qualification, progress and the next useful action.

The interface always distinguishes “wallet created,” “funded,” “trade
observed,” “qualification pending” and “confirmed.” A user never sees a reward
as earned while funding or fills remain reversible or unverified.

### 3. Referral loop

Every eligible user receives one direct referral code. There is no permanent
multi-level retail tree. High-performing referrers can enter the affiliate
program, where identity, campaign limits and economics are reviewed explicitly.

Referral milestones are per invitee and idempotent:

| Milestone | Evidence | Inviter seasonal XP | Invitee seasonal XP | Economic treatment during sprint |
|---|---|---:|---:|---|
| Dry | A valid acquisition referral is assigned and the eligible wallet exists | 0 | 0 | Analytics only; no cash, credit or XP. The invitee may earn the ordinary daily check-in. |
| Funded | $50 qualifying funding held for 72 hours | 0 | 250 | Invitee may enter the funded fee-subsidy experiment; no inviter payout. |
| Traded | Confirmed WNFT definition is satisfied | 750 | 250 | Campaign-configured inviter and invitee fee-credit test; held accounts receive nothing. |
| Retained | At least three trading days, including one in days 22–30, and at least $1 settled P34K builder fees | 1,500 | 500 | Additional retention credit or affiliate CPA test may be released after review. |

These are literal launch amounts produced from a 250 XP unit and `0 / 1 / 3 /
6` milestone weights. Each milestone is earned once in the referred user's
lifetime, not once per season. Referral XP receives no rank multiplier. Empty
wallets remain visible in the funnel but never create reward inventory.

### 4. Daily habit and progression

Daily check-ins remain a first-class feature. The existing implementation is
preserved:

- 100 base XP;
- 25 additional XP per consecutive day;
- the streak increment is capped after six steps, for a maximum 250 base XP;
- one idempotent check-in per UTC day;
- streak and lifetime XP derive from the append-only ledger; and
- current season rank may add its separately recorded bonus.

The check-in screen always shows the highest-impact incomplete activation step.
For an unfunded user that is funding; for a funded user it is the first verified
trade; for a qualified user it is retention, alerts or referral. Check-ins are
retention assistance, not evidence of successful acquisition.

Existing rank thresholds remain the launch baseline and are tuned only after
observing a complete season. Rank unlocks status, badges, leagues, additional
saved-alert/workspace capacity and eligibility for campaigns. It never raises
leverage, bypasses risk checks or promises a token.

### 5. Quest portfolio

| Quest lane | Examples | Growth purpose | Guardrail |
|---|---|---|---|
| Activation | First check-in, funding, first verified trade, second verified trade | Move users toward WNFT | One-time and evidence-backed. |
| Safety | Explain/revoke agent, create protection, enable private alerts, first reduce-only close | Reduce fear and avoid early loss of trust | Never reward leverage or liquidation proximity. |
| Referral | Dry, funded, traded and retained milestones | Create compounding acquisition | Per invitee, once per lifetime and held for abuse review. |
| Social | Join an official channel, complete an educational share, bring a unique qualified open | Expand measurable reach | Maximum 5% of seasonal XP; no follower or impression rewards. |
| Partner | Complete an explicitly disclosed card or ecosystem flow | Test adjacent acquisition | Partner-funded where possible; privacy and disclosure review. |
| Retention | D7 return, D30 active day, completed alert remediation | Improve cohort quality | No daily-trading or turnover streak. |

Quests never reward losses, liquidations, leverage increases, raw churn or
self-funded circular activity.

### 6. Pricing and sprint subsidy

The standard P34K builder fee remains **5 bp** while the newcomer sprint lane is
**2 bp** for the first 30 days or first $25,000 of eligible notional, whichever
comes first. Explicit reduce-only risk remediation opened from a P34K alert may
use **0 bp** where supported. Every review shows native Hyperliquid fees and the
P34K fee separately.

The 2 bp lane is an acquisition subsidy, not the sustainable reward budget. The
treasury ledger books `(5 bp - charged bp) * eligible notional` as foregone
builder revenue against campaign CAC. The positive 2 bp charge preserves
builder-fee-based trade attribution.

At $1 million of standard 5 bp volume, P34K earns $500 before costs. An
evergreen post-sprint program may allocate no more than 50% of settled builder
revenue across credits, partners and campaigns. The treasury sprint is tracked
separately and may be contribution-negative within its approved fixed budget.

No fee or subsidy changes silently by user. Experiment assignment is disclosed,
stable for its eligibility window and stored with the order policy version.

### 7. Treasury acquisition budget

The default planning allocation of `B` is:

- 35% affiliate and Telegram-channel CPA;
- 20% direct-referral incentive experiments;
- 20% newcomer fee subsidy and credits;
- 15% paid placements and creative testing; and
- 10% fraud, support and experiment reserve.

Ordinary users initially receive XP and non-transferable P34K fee credits.
Affiliates may receive manually approved USDC or invoiced CPA after identity,
sanctions, geography and tax review. Automated cash payouts remain disabled
until a separate money-movement gate passes.

A capped, manually reviewed user-USDC bounty may be tested after the treasury
ledger, sanctions/geography review, transfer-reference reconciliation and
manual canary pass. It is an experiment arm, not the default referral promise,
and cannot pay a held or unconfirmed user.

Credits are USD-denominated, non-transferable, expire after 90 days and reduce
only future P34K builder fees. XP is never burned or converted into credits,
cash or a guaranteed future token.

### 8. Retention and reactivation

Telegram messages are lifecycle tools, not broadcast spam:

- incomplete funding reminder;
- funded but not traded reminder;
- qualification confirmed;
- streak at risk;
- rank or quest unlocked;
- fee-credit expiry;
- useful fill, protection and account-risk alerts; and
- D7/D30 reactivation offer for eligible experiments.

Each category has opt-in state, cooldown, deduplication and one-tap mute.
Messages open authenticated fresh state rather than stale trading actions.

## What creates the moat

The moat compounds in four layers.

### Distribution layer

Signed links, campaign operations, Telegram partners, direct referrals and
ecosystem/card relationships create multiple sources of qualified traffic. No
single creator or partner owns the funnel.

### Conversion layer

P34K knows which onboarding step blocks each user and can optimize wallet,
funding and first-trade conversion without asking them to leave Telegram or
move away from Hyperliquid.

### Verification layer

Funding, builder-attributed fills, rewards, reversals and holds form one
replayable evidence chain. Competitors can offer larger headline rewards, but
P34K pays for real activation and can price fraud into every channel.

### Retention layer

Daily check-ins, streaks, ranks, quests, credits, notifications and validated
card or localized-market partnerships make P34K a recurring habit. Cohort
history then improves campaign selection and lowers CAC, which funds the next
cohort.

## System boundaries

1. **Attribution service:** channel, campaign, referral and offer identities.
2. **Qualification service:** funding, verified fills and WNFT state machine.
3. **Rewards service:** append-only XP, ranks, streaks, quests and credits.
4. **Treasury growth ledger:** budgets, subsidies, CPA, holds and campaign CAC.
5. **Execution trust boundary:** agent security, idempotent orders, fee/risk
   review and reconciliation.
6. **Lifecycle service:** Telegram messages, cooldowns, deep links and consent.
7. **Experiment and analytics service:** assignment, funnel, cohorts, CAC,
   retention and stop rules.
8. **Partner surface:** affiliate reporting and card/ecosystem referrals without
   access to individual wallet or Telegram data.

The XP ledger never moves money. The treasury ledger never decides rank. A
campaign link never grants trading authority. Telegram messages never sign an
order.

## Pilot gate versus scale gate

### Pilot launch gate

The first allowlisted growth cohort may begin as soon as all of these are true:

- WNFT, campaign and reward events replay deterministically;
- current referral, rank/check-in, notification and builder-attribution
  migrations are deployed and verified in the target environment;
- fee review shows the actual native fee, P34K fee and subsidy lane;
- liquidation/risk review never presents the current simplified estimate as an
  authoritative exchange value;
- no exportable agent private key remains in ordinary browser storage;
- duplicate taps, reconnects and timeout-after-acceptance cannot blindly create
  a second economic order;
- testnet and capped mainnet canaries cover funding, two trades, qualification,
  reversal and reward hold;
- entry protection is shown as pending, confirmed or unprotected, and an
  unprotected filled position has a tested repair action;
- a signed pilot configuration names and enforces per-order notional, daily new
  risk, maximum leverage and cohort-size limits before the first mainnet user;
- no known critical execution or reward defect remains; and
- Telegram Mini App, ordinary-bot and web/PWA operating policy has an approved
  decision and recovery path.

There is no 30-day percentage requirement before acquisition begins. The pilot
cohort exists to generate that evidence. It starts allowlisted and expands in
explicit steps such as 25, 100 and 250 qualified users.

### Scale and automation gate

Automatic economic rewards, uncapped acquisition or materially higher exposure
requires:

- 30 consecutive days with at least 99.9% intent-to-fill matching;
- at least 99.99% builder-fee value reconciliation;
- zero known duplicate economic orders in the measured cohort;
- fewer than 0.1% outcomes unresolved after five minutes;
- deterministic reward and treasury replay;
- fraud/hold loss below 5% of acquisition spend;
- declared protection and notification SLOs met; and
- manual review of at least 100 qualification journeys.

Failure pauses the affected campaign or payout lane, not withdrawals or the
user's independent access to Hyperliquid.

## P0 backlog — launch the measured growth pilot

| ID | Item | Outcome and measurable acceptance | Depends on | Size |
|---|---|---|---|---|
| P0-01 | Sprint charter and treasury envelope | Record `B`, 250-user target, portfolio CAC ceiling, channel allocations, approvers and stop authority before paid spend. No campaign can spend without a remaining budget. | Founder/treasury decision | S |
| P0-02 | Canonical WNFT contract | Implement one versioned definition for provisional, confirmed, held and reversed WNFT. Replay produces identical users and qualification weeks. | Funding/fill evidence | L |
| P0-03 | Channel and campaign registry | Every non-organic link names source, campaign, creative, offer and policy version; disabled or expired campaigns fail visibly. | Event contract | M |
| P0-04 | Signed acquisition links and immutable first attribution | Telegram reopen, browser fallback and manual code entry preserve the correct first referrer; tampering and self-referral fail; later campaigns cannot steal reward ownership. | P0-03; existing referral flow | L |
| P0-05 | Dry/funded/traded/retained referral state machine | Deploy/verify `4612df3e` and migration `019`; per-invitee transitions use this spec's evidence, are idempotent and expose pending/held/reversed reasons; each lifetime milestone grants once. | P0-02/04 | M |
| P0-06 | All-route funding qualification | Detect qualifying Hyperliquid funding beyond the in-app onramp; 72-hour hold and withdrawals reconcile; staff/test/internal transfers are excluded. | Account funding history | XL |
| P0-07 | Builder-verified trade qualification | Deploy/verify `17c2516c` and migration `018`; two positive-builder-fee fills and cumulative fee threshold qualify deterministically; a CLOID prefix alone never qualifies. | Builder data; P0-02 | M |
| P0-08 | Treasury CAC and subsidy ledger | Append-only entries cover approved budget, spend, foregone fee, issued/expired/burned credit, CPA hold, release and reversal; campaign totals balance daily. | P0-01/03 | XL |
| P0-09 | Versioned 2 bp newcomer and 5 bp standard policy | Eligibility, expiry and requested fee are stored per order; the correct approval maximum is verified; review shows native fee, P34K fee, subsidy and USD cost. | Fee-rate source; order review | L |
| P0-10 | Referral XP and campaign benefit policy | Publish milestone XP, lifetime idempotency, campaign caps, credit experiments, expiry, holds, reversals and no-token language; every grant names the active policy. | P0-05/08 | M |
| P0-11 | Deploy and verify daily check-ins, ranks and lifetime XP | Verify `00eaf2c2` plus migrations `016`/`017`; duplicate check-ins grant nothing; UTC streak, tier bonus and lifetime totals rebuild exactly. | Existing rewards ledger | S |
| P0-12 | Activation journey and progress UI | User always sees current stage, missing evidence, offer expiry and next action; median wallet-to-first-review time in canary is under ten minutes. | P0-02/05/09/11 | L |
| P0-13 | Anti-sybil holds and review queue | Seeded self-referral, duplicate identity, circular funding, shared destination and correlated trade patterns enter a reasoned hold; shared IP alone never decides; manual release/reject is audited. | P0-05/06/07 | L |
| P0-14 | Growth and cohort dashboard | Confirmed WNFT, funnel, CAC, D7/D30, spend, builder revenue and holds reconcile by source/campaign daily; provisional and confirmed counts never mix. | P0-02/03/08 | L |
| P0-15 | Secure agent signer migration | No exportable agent private key remains in ordinary browser storage; legacy capability migrates or invalidates safely; logout, wallet change and revoke remove local authority. | Privy/signing design | XL |
| P0-16 | Idempotent order intent and unknown-outcome reconciliation | Stable intent IDs prevent duplicate orders across taps/retries; transport ambiguity enters `outcome_unknown` and reconciles against Hyperliquid before retry. | Execution persistence | L |
| P0-17 | Pilot limits, canaries and rollback | Testnet and allowlisted mainnet journeys cover funding, two trades, holds and reversals; per-order/daily limits, cohort steps and rollback owner are enforced. | All P0 truth paths | L |
| P0-18 | Telegram policy and recovery decision | Document supported Mini App, ordinary-bot and external-web behavior under Telegram's rules; users retain authenticated read/recovery access if Mini App trading is restricted. | Product/legal review | M |
| P0-19 | Honest pilot risk preview | Remove or disable the simplistic liquidation formula as an authoritative value; label exchange facts, estimates and unavailable states; risk-increasing orders fail closed on materially stale state while reduce/cancel remains accessible. | Account/market freshness | M |
| P0-20 | Protection confirmation and repair | Entry protection is never claimed before trigger acknowledgement; pending, protected and unprotected states are explicit; retries cannot create duplicate triggers; one-tap repair identifies the exact exposed position. | P0-16; trigger-order queries | M |

### P0 launch outcome

P0 is complete when an allowlisted campaign can bring a new user through the
entire journey, count that user once as confirmed WNFT, hold/release the correct
benefits, show the correct CAC, and repeat the journey under failure injection
without duplicate economic actions.

## P1 backlog — run and optimize the 90-day sprint

| ID | Item | Outcome and measurable acceptance | Depends on | Size |
|---|---|---|---|---|
| P1-01 | Seed affiliate and Telegram partner cohort | Recruit ten test channels/affiliates across at least three audience types; every agreement pays on confirmed WNFT or retained WNFT, not wallets or impressions. | P0 campaign/qualification | M |
| P1-02 | Paid-placement experiment | Run at least three creative hooks and two channel types with unique links; stop rules apply automatically; no winning claim before ten confirmed conversions per arm. | P0-01/03/14 | M |
| P1-03 | Direct user referral launch | Invite, copy and status UX expose dry/funded/traded/retained progress; at least 95% of valid sampled links preserve attribution through Telegram reopen. | P0-04/05/12 | M |
| P1-04 | Two-sided benefit experiment | Compare XP-only, inviter/invitee fee-credit and—only after its manual money-movement mini-gate—capped USDC arms; assignment is stable and disclosed; readout includes WNFT lift, D30, fraud and incremental CAC. | P0-08/10/14 | L |
| P1-05 | Newcomer fee-lane experiment | Compare eligible 2 bp newcomer pricing with a disclosed standard-fee control only when assignment is shown before builder approval and remains inside the published policy; otherwise use time-sequenced cohorts. Measure review-to-fill, not only volume; no order exceeds policy. | P0-09/14 | M |
| P1-06 | Check-in activation routing | Each daily check-in recommends the highest-impact incomplete step; measure check-in-to-funding and check-in-to-first-trade conversion without changing the existing streak grant. | P0-11/12 | M |
| P1-07 | Activation and safety quests | Launch first funding, two verified trades, agent education, protection and private-alert quests; every completion has evidence and one idempotency key. | P0 truth services | M |
| P1-08 | Capped social quests | Test official-channel and educational-share quests under a 5% seasonal XP budget; no raw impression/follower reward and no economic payout from social proof alone. | Campaign registry; quest engine | S |
| P1-09 | Growth ranks and leaderboards | Keep lifetime/season rank visible; add separate confirmed-referrer and newcomer boards with opaque aliases, “around me,” caps and held-user exclusion. Raw volume does not determine growth rank. | P0-05/11/13 | L |
| P1-10 | Lifecycle messaging | Funding, first-trade, qualification, streak, rank and credit messages have consent, cooldown, dedupe, deep-link and mute; delivery and conversion are measurable by campaign. | Notification foundation; P0-12 | L |
| P1-11 | Shareable progress and referral cards | Produce privacy-safe streak, rank and referral-progress cards with signed campaign links; wallet, absolute balance and Telegram handle are hidden by default. | P1-03/09 | M |
| P1-12 | Card referral-out MVP | Evaluate at least five self-funded card providers for supported regions, chains, custody, funding path, fees, disclosures and affiliate terms; list only approved providers; track outbound click and reported conversion without handling KYC or funds. | Partner/legal review | M |
| P1-13 | Experiment assignment and decision log | Every fee, reward, message and creative experiment has hypothesis, primary metric, guardrails, sample rule, start/stop time and decision; no hidden per-user price changes. | P0-14 | M |
| P1-14 | Growth fraud operations | Daily queue, evidence, reviewer, appeal and campaign-level fraud reporting operate within a 24-hour SLA; campaigns can pause without freezing unaffected users. | P0-13/14 | M |
| P1-15 | Sprint close and next-budget decision | At day 90, report 250-target attainment, final-week WNFT, channel mix, CAC, D30, revenue, subsidy, fraud and confidence; choose scale, revise or stop each channel separately. | All P1 experiments | S |

### P1 success gate

The program enters the compounding phase when:

- at least 250 cumulative users qualify and at least 50 qualify in week 12;
- at least two independent channels acquire within the CAC ceiling;
- at least 20% of measurable users remain trading-active at D30;
- direct referrals contribute at least 20% of new WNFT or show statistically
  credible progress toward it;
- fraud/hold loss is below 5% of acquisition spend;
- the scale and automation gate remains satisfied; and
- higher retention is not purchased solely by progressively larger rewards.

## P2 backlog — compound the growth moat

| ID | Item | Outcome and measurable acceptance | Depends on | Size |
|---|---|---|---|---|
| P2-01 | Self-serve affiliate portal | Approved partners create campaigns, view privacy-safe WNFT/retention and reconcile held/released CPA; cohorts below ten users are suppressed. | Proven P1 partner channel | L |
| P2-02 | Evergreen fee credits | Credits issue only within settled-revenue or explicit treasury coverage, expire after 90 days and burn against actual P34K builder fees with no negative balance. | Treasury/revenue ledgers | XL |
| P2-03 | Personalized quest routing | Recommend quests by funnel stage and cohort evidence; optimization targets incremental WNFT/D30 rather than XP consumption. | Sufficient experiment history | L |
| P2-04 | Leagues, badges and seasonal events | Newcomer and referral leagues use capped verified activity; no whale can dominate through raw notional; seasonal events publish a fixed XP/credit budget. | P1 ranks; anti-sybil | L |
| P2-05 | Verified PnL and execution cards | Cards use authenticated fills, include fees/funding and distinguish realized/unrealized; privacy-safe links attribute qualified acquisition. | Verified fills; privacy policy | L |
| P2-06 | Actionable risk and execution alerts | Fill, rejection, protection and margin alerts open fresh authenticated reduce/cancel/protect/review actions; the bot never signs. | Sustained execution SLOs | L |
| P2-07 | Card partner deep links and co-marketing | Approved issuer partners offer region-aware deep links and reported conversions; P34K does not collect issuer KYC, custody card funds or touch trading collateral, while affiliate disclosure, geography and data-sharing obligations remain explicit. | P1-12 demand evidence | L |
| P2-08 | Localized Hyperliquid/HIP-3 discovery | Local currency display, regional watchlists, trading-hour/oracle disclosures and partner campaigns help users find existing regional or stock-like HIP-3 markets without P34K deploying one. | Market metadata; regional demand | L |
| P2-09 | Creator acquisition experiment | Add structured signals or creator pages only for creators whose affiliate cohorts beat the median channel on WNFT CAC or D30; user confirmation remains mandatory. | P1 channel evidence | L |
| P2-10 | Authenticated web/PWA recovery | The same Privy identity deliberately links outside Telegram without creating another wallet; positions, qualification and rewards remain consistent. | Telegram policy; signer design | XL |
| P2-11 | Advanced channel and fraud graph | Model shared funding/destination, referral loops, campaign overlap and retained value; automated decisions meet documented precision and preserve appeal. | Larger cohort baseline | XL |
| P2-12 | Sustainable pricing decision | Compare 2/3/5 bp retention, conversion and contribution cohorts; choose evergreen pricing that supports product value without depending on treasury subsidy. | Sprint and D30 economics | M |

## P3 backlog — separately gated options

| ID | Option | Reopen only when |
|---|---|---|
| P3-01 | Automated user cash bounties | Money-movement threat model, legal/geography decision, treasury limits, sanctions controls, durable transfer references, manual canary and reconciliation all pass. |
| P3-02 | Embedded or P34K-branded card | Referral-out demand is proven; one geography has a credible retained/KYC-eligible cohort; issuer/program-manager terms and economics cover fraud, FX, support, custody and compliance. Card funds remain isolated from trading margin. |
| P3-03 | Token design | Six consecutive months of healthy retention without token messaging, positive contribution after rewards, sybil loss below 2%, launch-jurisdiction legal memo and non-speculative utility. XP carries no automatic conversion. |
| P3-04 | Co-launched regional HIP-3 market | Localized discovery proves regional demand; an existing deployer, oracle/data provider, market maker and legal owner commit to the launch and economics. |
| P3-05 | Owned HIP-3 deployment | Committed stake/capital, redundant oracle plan, multiple makers, 24/7 operations, slashing controls, legal approval and modeled revenue at least three times the operating/capital hurdle. |
| P3-06 | Automatic copy trading | User-confirmed creator drafts prove demand; separate legal, suitability, risk-policy, durable strategy-state, outage and pricing design is approved. |

## Explicit non-goals during the sprint

- building a creator marketplace before creators prove lower WNFT CAC;
- paying meaningful rewards for impressions, followers or wallet creation;
- permanent multi-level retail referral economics;
- raw-volume, leverage or PnL-only leaderboards;
- converting or burning XP into cash, credits or a future token;
- public wallet fragments, Telegram handles or absolute position sizes;
- an embedded card, card custody or access to Hyperliquid margin collateral;
- owning a HIP-3 deployment;
- automatic creator/copy execution;
- venue aggregation or a full desktop-terminal clone; and
- blocking withdrawals or independent Hyperliquid access because a growth
  campaign is held.

## Error handling and abuse rules

- A transport timeout after signing enters `outcome_unknown`; it never invites
  a blind retry or qualifies a reward.
- Funding or fills that reverse append reversal entries and may reverse WNFT,
  XP or credits according to the published policy.
- Expired, disabled or tampered campaign links explain the state and continue as
  unattributed organic where safe.
- A held user sees the milestone as under review, not failed or earned.
- Shared IP alone never establishes abuse.
- Campaign suspension stops new attribution/spend without affecting positions,
  withdrawals or unrelated check-ins.
- Partner reports expose cohorts and totals, never individual wallets or
  Telegram identities.
- Credit and XP corrections append ledger entries instead of rewriting history.

## Verification strategy

### Contract tests

- WNFT state transitions, week assignment, holds and reversals;
- acquisition/referral precedence through Telegram and browser paths;
- all-route funding and builder-fee fill attribution;
- pricing eligibility, expiry and builder approval maximum;
- XP lifetime idempotency, social/campaign caps, daily check-in idempotency,
  rank bonus and projection replay;
- budget, credit and CPA ledger balance; and
- privacy and campaign-disable invariants.

### End-to-end canaries

- organic, direct-referral and affiliate journeys;
- wallet creation, external funding, two trades and 72-hour confirmation;
- partial fill, cancellation, timeout-after-acceptance and reversed funding;
- duplicate click, duplicate check-in and duplicate worker delivery;
- held, released and rejected acquisition rewards;
- Telegram iOS, Android and desktop reopen/deep-link behavior; and
- browser/PWA recovery where enabled.

### Experiment quality

- assignment occurs before exposure and remains stable;
- one primary outcome and explicit guardrails per test;
- campaign/creative version is stored with every event;
- no winner is declared from wallets or volume when WNFT is the objective;
- results show absolute numbers and cohort maturity; and
- spend stops automatically at the approved limit.

## Implementation-plan decomposition

This strategy is intentionally broader than one safe implementation plan. Once
the written design is approved, execution is decomposed into these workstreams:

1. **Measurement and attribution:** P0-01 through P0-07 and P0-14.
2. **Execution trust floor:** P0-15 through P0-20.
3. **Referral and rewards:** P0-05, P0-10 through P0-13, then P1-03/04/06–09.
4. **Pricing and treasury economics:** P0-08/09, then P1-02/04/05/13.
5. **Growth operations and lifecycle:** P0-12/17, then P1-01/02/10/11/14/15.
6. **Card referral-out validation:** P1-12 as an independent, non-custodial
   partner workstream.

Measurement and the trust floor begin in parallel; the trust floor gates
mainnet acquisition. Each plan has its own migrations, release gate and
verification. No plan may silently change the XP, price or campaign policy
owned by another boundary.

## Critical delivery sequence

```text
Wave 0: define and measure
  P0-01 -> P0-02 -> P0-03/P0-04 -> P0-05/P0-06/P0-07

Wave 1: price and reward safely
  P0-08/P0-09/P0-10/P0-11 -> P0-12/P0-13/P0-14

Wave 2: clear the pilot trust floor
  P0-15 through P0-20 -> allowlisted 25-user pilot
  -> 100-user step -> 250-user step

Wave 3: buy, activate and compound
  P1-01/P1-02 -> P1-03/P1-04/P1-05
  -> P1-06 through P1-14 -> P1-15 sprint decision

Wave 4: compound only the proven loops
  P2 items after the P1 success gate

Wave 5: regulated and capital-heavy options
  P3 items through independent gates
```

## Definition of done for every backlog item

An item is done only when it has:

- an explicit effect on WNFT, a funnel step, retention or safe scale;
- measurable acceptance and an operating owner;
- server/exchange facts separated from estimates;
- idempotency and replay behavior for stored state;
- automated tests proportional to economic risk;
- privacy, secret-redaction and abuse review;
- campaign/policy versioning where behavior can change;
- a staged rollout and spend/exposure limit; and
- a verified rollback or reconciliation path.

## Sources informing the design

- [Hyperliquid referrals](https://hyperliquid.gitbook.io/hyperliquid-docs/referrals)
- [Hyperliquid fees](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees)
- [Hyperliquid builder codes](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes)
- [Telegram blockchain guidelines](https://core.telegram.org/bots/blockchain-guidelines)
- [Perps.bot product overview](https://perpsbot.mintlify.app/)
- [Perps.bot fees](https://perpsbot.mintlify.app/fees)
- [pvp.trade referrals and rakeback](https://docs.pvp.trade/en-referrals)
- [pvp.trade levels](https://docs.pvp.trade/en-levels)
- [Dreamcash XP rules](https://docs.dreamcash.xyz/season-1/earning-xp.md)
- [Dreamcash affiliate program](https://docs.dreamcash.xyz/season-1/affiliate-program.md)
- [Privy cards integration guide](https://docs.privy.io/financial-flows/cards/integration-guide)
- [HIP-3 builder-deployed perpetuals](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-3-builder-deployed-perpetuals)
