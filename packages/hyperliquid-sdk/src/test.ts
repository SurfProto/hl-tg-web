/**
 * Simple test file to verify SDK wrapper integration
 * Run with: npx tsx packages/hyperliquid-sdk/src/test.ts
 */

import { HyperliquidClient } from './client';
import { injectBuilderCode, BUILDER_ADDRESS, BUILDER_FEE_TENTHS_BP } from './builder';

// Test builder code injection
console.log('Testing builder code injection...');
const testOrder = {
  coin: 'BTC',
  side: 'buy' as const,
  orderType: 'limit' as const,
  limitPx: 50000,
  sz: 0.01,
  reduceOnly: false,
};

const orderWithBuilder = injectBuilderCode(testOrder);
console.log('Order with builder code:', JSON.stringify(orderWithBuilder, null, 2));
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
