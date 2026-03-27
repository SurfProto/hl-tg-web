import type { HyperliquidClient } from './client';

// Builder code configuration
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const BUILDER_ADDRESS = import.meta.env.VITE_BUILDER_ADDRESS || '0x0000000000000000000000000000000000000000';
export const BUILDER_FEE_TENTHS_BP = parseInt(import.meta.env.VITE_BUILDER_FEE || '50', 10); // 50 = 5bp

/**
 * Convert tenths of basis points to percentage string for SDK.
 * 10 tenths = 1bp = 0.01% → "0.01%"
 * 1 tenth = 0.1bp = 0.001% → "0.001%"
 */
export function feeToPercentString(tenthsBp: number): `${string}%` {
  const percent = tenthsBp / 1000; // 10 tenths / 1000 = 0.01
  return `${percent}%` as `${string}%`;
}

/**
 * Approve builder fee for the user.
 * Must be called once before orders with builder code can succeed.
 */
export async function approveBuilderFee(client: HyperliquidClient): Promise<void> {
  if (!isBuilderConfigured()) return;
  const maxFeeRate = feeToPercentString(BUILDER_FEE_TENTHS_BP);
  await client.approveBuilderFee(BUILDER_ADDRESS, maxFeeRate);
}

/**
 * Check if builder fee is approved for the user.
 * Returns the max approved fee rate (0 = not approved).
 */
export async function isBuilderFeeApproved(client: HyperliquidClient): Promise<boolean> {
  if (!isBuilderConfigured()) return true;
  const maxFee = await client.getMaxBuilderFee(BUILDER_ADDRESS);
  return maxFee > 0;
}

/**
 * Returns true when builder configuration should be applied to trading actions.
 */
export function isBuilderConfigured(): boolean {
  return BUILDER_ADDRESS.toLowerCase() !== ZERO_ADDRESS;
}

/**
 * Returns the configured builder payload for order placement, if enabled.
 */
export function getBuilderConfig() {
  if (!isBuilderConfigured()) return undefined;
  return {
    b: BUILDER_ADDRESS as `0x${string}`,
    f: BUILDER_FEE_TENTHS_BP,
  };
}
