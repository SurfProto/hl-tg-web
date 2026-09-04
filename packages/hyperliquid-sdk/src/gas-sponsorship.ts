// Whether the app pays the gas on the Arbitrum leg of a deposit.
//
// Populated by configureGasSponsorship() at app startup, the same way builder
// config is injected, so this package keeps zero Vite/import.meta.env
// references.
const _config = {
  sponsorDeposits: false,
};

/**
 * Call once at app startup, before rendering.
 *
 * Deliberately a runtime toggle rather than a constant. Privy's native
 * sponsorship has two prerequisites that live outside this repository — TEE
 * execution enabled for the app, and Arbitrum selected in the dashboard's
 * "App pays" chain list — and their documentation does not say what happens
 * when `sponsor: true` arrives without them, or when the sponsorship balance
 * runs dry. If any of that misbehaves, deposits are the thing that breaks, and
 * an environment variable turns it off in the time it takes to redeploy config
 * rather than code.
 *
 * @example
 * // apps/tg-mini-app/src/main.tsx
 * configureGasSponsorship(import.meta.env.VITE_SPONSOR_DEPOSIT_GAS);
 */
export function configureGasSponsorship(enabled: boolean | string | undefined): void {
  if (enabled === undefined || enabled === null) return;
  _config.sponsorDeposits =
    typeof enabled === "boolean" ? enabled : enabled.trim().toLowerCase() === "true";
}

/**
 * Whether to ask Privy to sponsor the deposit transaction.
 *
 * Also decides whether the review sheet claims sponsorship. The two must not
 * drift: telling somebody their gas is covered while they pay it is the kind of
 * copy that costs trust exactly once, which is why both read this and not a
 * separate flag.
 *
 * Privy sponsors the embedded EOA itself over EIP-7702, so the address stays
 * the one the Hyperliquid account, agent approval and reward history are keyed
 * to. No smart wallet, no new address.
 */
export function isDepositGasSponsored(): boolean {
  return _config.sponsorDeposits;
}
