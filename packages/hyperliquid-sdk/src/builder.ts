import type { Order, BuilderCode } from '@repo/types';

// Builder code configuration
// TODO: Replace with actual values from environment or config
export const BUILDER_ADDRESS = import.meta.env.VITE_BUILDER_ADDRESS || '0x0000000000000000000000000000000000000000';
export const BUILDER_FEE_TENTHS_BP = parseInt(import.meta.env.VITE_BUILDER_FEE || '10', 10); // 10 = 1bp

/**
 * Approve builder fee for the user
 * This should be called once on first app load
 */
export async function approveBuilderFee(signer: unknown): Promise<void> {
  // TODO: Implement actual approval logic using the signer
  // This will call the Hyperliquid exchange endpoint with approveBuilderFee action
  console.log('Approving builder fee:', {
    builder: BUILDER_ADDRESS,
    maxFeeRate: `${BUILDER_FEE_TENTHS_BP}0`,
  });
  
  // Placeholder for actual implementation
  // const action = {
  //   type: 'approveBuilderFee',
  //   builder: BUILDER_ADDRESS,
  //   maxFeeRate: `${BUILDER_FEE_TENTHS_BP}0`,
  // };
  // await signAndSend(signer, action);
}

/**
 * Inject builder code into an order
 * This should be called for every order placed
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

/**
 * Check if builder fee is approved for the user
 */
export async function isBuilderFeeApproved(userAddress: string): Promise<boolean> {
  // TODO: Implement actual check using Hyperliquid info endpoint
  console.log('Checking builder fee approval for:', userAddress);
  return false;
}
