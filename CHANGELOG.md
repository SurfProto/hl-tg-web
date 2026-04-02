# Changelog

## Week of 2026-03-27 to 2026-04-02

### Highlights

- Launched the redesigned Telegram trading experience with a new four-tab shell, richer home and coin detail views, and a guided trade flow built around numpad sizing, leverage controls, and TIF settings.
- Expanded market coverage and discovery with spot support, HIP-3 market handling, tradfi and crypto cross-filtering, sub-filters, pre-launch filtering, and corrected market display names.
- Improved portfolio and account visibility with combined portfolio value, clearer total equity versus available balance, account, points, and settings flows, plus home loading skeletons and cleaner market list presentation.
- Hardened trading and funding reliability across auth, agent wallet setup, leverage validation, bridge flows, transfer handling, pricing, and websocket connectivity.
- Added stronger safety rails for agent-driven trading, including expiry detection with reapproval prompts, runtime crash containment via an app-level error boundary, and bridge preflight checks for Arbitrum USDC balances.

### Notable Changes

- Added spot markets, HIP-3 detection, bridge permit flow, USDC-USDH swap support, and combined portfolio valuation.
- Refactored Hyperliquid trading onto a thinner adapter and added minimum trade validation.
- Added Privy-funded and sponsored deposit flows, then stabilized gas estimation and builder fee prompting around those flows.
- Fixed Telegram auth regressions, restored email linking, and aligned agent execution with the main account.
- Introduced toast notifications, decimal precision cleanup, and orders tab consistency improvements.
- Corrected HIP-3 categorization and placement so those markets behave properly across tabs and filters.
