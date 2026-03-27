import type { Order, BuilderCode } from '@repo/types';
import type { HyperliquidClient } from './client';

// Builder code configuration
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
  const maxFeeRate = feeToPercentString(BUILDER_FEE_TENTHS_BP);
  await client.approveBuilderFee(BUILDER_ADDRESS, maxFeeRate);
}

/**
 * Check if builder fee is approved for the user.
 * Returns the max approved fee rate (0 = not approved).
 */
export async function isBuilderFeeApproved(client: HyperliquidClient): Promise<boolean> {
  const maxFee = await client.getMaxBuilderFee(BUILDER_ADDRESS);
  return maxFee > 0;
}

/**
 * Inject builder code into an order.
 * This should be called for every order placed.
 */
export function injectBuilderCode(order: Order): Order & { builder: BuilderCode } {
  return {
    ...order,
    builder: {
      b: BUILDER_ADDRESS,
      f: BUILDER_FEE_TENTHS_BP,
    },
  };
}
