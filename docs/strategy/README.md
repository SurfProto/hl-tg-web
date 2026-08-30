# Strategy

## Validation

[`2026-08-30-growth-strategy-validation.md`](2026-08-30-growth-strategy-validation.md)
audits the growth-first moat design against the codebase it claims, the
arithmetic it asserts and the market it describes. Read it before acting on that
document: the unit its budget, CPA and success criteria are all denominated in
does not survive contact with the code.

## Notes recovered 2026-08-29

Four strategy documents written on 2026-08-26, published as Claude artifacts,
and later deleted. They are the competitive and economic analysis that the
growth-first moat design was built on top of — the moat doc states its
conclusions, these state the reasoning and the sources.

They were recovered from the session transcript on 2026-08-29 because all four
artifact URLs had stopped resolving and no other copy existed.

## The documents

| File | Published as | Subject |
|---|---|---|
| [`2026-08-26-the-five-basis-point-problem.html`](2026-08-26-the-five-basis-point-problem.html) | *The Five Basis Point Problem* | What 5 bp on notional can and cannot fund, measured against Dreamcash's spend |
| [`2026-08-26-what-xp-is-for.html`](2026-08-26-what-xp-is-for.html) | *What XP Is For* | Ranks, redemptions, the referral ladder, and the card and HIP-3 research |
| [`2026-08-26-where-the-money-sits.html`](2026-08-26-where-the-money-sits.html) | *Where The Money Sits* | Balance taxonomy, card settlement float, and what Hyperbeat resolved |
| [`2026-08-26-the-retention-loop.html`](2026-08-26-the-retention-loop.html) | *The Retention Loop* | The leak after a trading session, and a roadmap sequenced by dependency |

Open them in a browser; each is a self-contained page.

## Where they sit in the lineage

Three successive positions were taken on the same question. These four notes
belong to the first.

1. **These notes** (2026-08-26) — a Telegram-native membership layer. XP is
   reputation; Credits, funded by *settled* builder revenue, are the currency.
2. **`3688fec6`** (2026-08-27 13:53, on `feat/notification-observability`, never
   merged) — the creator-and-community execution network. Same filename as the
   document below, materially different thesis. Anyone reading that branch is
   reading an abandoned direction.
3. **[`../superpowers/specs/2026-08-27-telegram-execution-moat-design.md`](../superpowers/specs/2026-08-27-telegram-execution-moat-design.md)**
   (`32c924ee`, on `main`) — growth-first, treasury-funded, WNFT as the north
   star, creators demoted to one acquisition channel among several.

Positions 1 and 3 disagree in ways worth keeping visible. These notes argue the
structural advantage is Telegram distribution — a link in a chat opens a working
terminal with no app-store install, already localised for the audience Telegram
actually has — where the current doc leads with Hyperliquid account continuity.
They also carry material the current doc dropped: Hyperbeat as the nearest
competitor, yield on idle balance as a retention lever, `bridge_sponsorship_events`
as the cheapest redemption already in the schema, and the sanctions constraint on
RUB markets.

Their sharpest claim is one the current backlog does not answer:

> You have two users. No item below changes that. [...] If you only do one thing
> this month, make it the channel, not the code.

## Fidelity

Reconstructed from the `Write` and `Edit` tool calls in the originating session,
so the content is exact rather than transcribed.

- *The Five Basis Point Problem* and *Where The Money Sits* were published once
  and never edited. They are byte-identical to what was published.
- *What XP Is For* and *The Retention Loop* were revised after their first
  publish and re-published. The nine subsequent edits are replayed here in order,
  so these files match the **final** published version, not the first. The
  revision to *What XP Is For* was substantive: a section titled "What XP redeems
  into" became "Don't let XP be the currency", and two sections were added.

Figures in all four were read from the repository at `dac71ff`. They have not
been re-verified against current `main` and several are now stale — the funding
evidence, builder-fee attribution and referral ladder they describe as broken
have since been repaired. Read them for the reasoning, not the repo state.
