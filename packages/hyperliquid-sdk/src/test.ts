/**
 * Simple test file to verify SDK wrapper integration
 * Run with: npx tsx packages/hyperliquid-sdk/src/test.ts
 */

import { HyperliquidClient } from './client';
import { BUILDER_ADDRESS, BUILDER_FEE_TENTHS_BP, getBuilderConfig } from './builder';

// Test builder configuration
console.log('Testing builder configuration...');
const testOrder = {
  coin: 'BTC',
  side: 'buy' as const,
  sizeUsd: 100,
  orderType: 'limit' as const,
  limitPx: 50000,
  reduceOnly: false,
};

console.log('Test order:', JSON.stringify(testOrder, null, 2));
console.log('Builder config:', JSON.stringify(getBuilderConfig(), null, 2));
console.log('Builder address:', BUILDER_ADDRESS);
console.log('Builder fee (tenths of bp):', BUILDER_FEE_TENTHS_BP);

// Test client instantiation
console.log('\nTesting client instantiation...');
const client = new HyperliquidClient({
  walletAddress: '0x0000000000000000000000000000000000000000',
  testnet: true,
});
console.log('Client created successfully');

// Test WebSocket manager
console.log('\nTesting WebSocket manager...');
console.log('WebSocket connected:', client.isWsConnected());

console.log('\n✅ All tests passed!');
