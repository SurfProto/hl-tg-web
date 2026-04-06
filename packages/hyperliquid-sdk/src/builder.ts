import type { HyperliquidClient } from "./client";

// Internal builder config — populated by configureBuilder() at app startup.
// Using a mutable object so the shared package has zero Vite/import.meta.env references.
const _config = {
  address: "0x99E3327611c4d5aBfeaA9c64C151817a9554Fb5D" as string,
  feeTenthsBp: 50, // default 5bp
};

// ZERO_ADDRESS is intentionally unexported — only used internally for the "not configured" check.
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Call this once at app startup (before any rendering) to inject builder config
 * from the host app's environment variables.
 *
 * @example
 * // apps/tg-mini-app/src/main.tsx
 * configureBuilder(import.meta.env.VITE_BUILDER_ADDRESS, Number(import.meta.env.VITE_BUILDER_FEE));
 */
export function configureBuilder(
  address: string | undefined,
  feeTenthsBp?: number,
): void {
  if (address) _config.address = address;
  if (feeTenthsBp != null && !Number.isNaN(feeTenthsBp))
    _config.feeTenthsBp = feeTenthsBp;
}

export function getBuilderAddress(): string {
  return _config.address;
}

export function getBuilderFeeTenthsBp(): number {
  return _config.feeTenthsBp;
}

/**
 * Convert tenths of basis points to percentage string for SDK.
 * 10 tenths = 1bp = 0.01% → "0.01%"
 */
export function feeToPercentString(tenthsBp: number): `${string}%` {
  const percent = tenthsBp / 1000;
  return `${percent}%` as `${string}%`;
}

/**
 * Returns true when builder configuration should be applied to trading actions.
 */
export function isBuilderConfigured(): boolean {
  return _config.address.toLowerCase() !== ZERO_ADDRESS;
}

/**
 * Approve builder fee for the user.
 * Must be called once before orders with builder code can succeed.
 */
export async function approveBuilderFee(
  client: HyperliquidClient,
): Promise<void> {
  if (!isBuilderConfigured()) return;
  const maxFeeRate = feeToPercentString(_config.feeTenthsBp);
  await client.approveBuilderFee(_config.address, maxFeeRate);
}

/**
 * Check if builder fee is approved for the user.
 */
export async function isBuilderFeeApproved(
  client: HyperliquidClient,
): Promise<boolean> {
  if (!isBuilderConfigured()) return true;
  const maxFee = await client.getMaxBuilderFee(_config.address);
  return maxFee > 0;
}

/**
 * Returns the configured builder payload for order placement, if enabled.
 */
export function getBuilderConfig() {
  if (!isBuilderConfigured()) return undefined;
  return {
    b: _config.address as `0x${string}`,
    f: _config.feeTenthsBp,
  };
}
