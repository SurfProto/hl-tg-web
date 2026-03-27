// Configuration exports
export const config = {
  hyperliquid: {
    testnet: import.meta.env.VITE_HYPERLIQUID_TESTNET === 'true',
  },
  builder: {
    address: import.meta.env.VITE_BUILDER_ADDRESS || '0x0000000000000000000000000000000000000000',
    fee: parseInt(import.meta.env.VITE_BUILDER_FEE || '50', 10),
  },
  privy: {
    appId: import.meta.env.VITE_PRIVY_APP_ID || 'YOUR_PRIVY_APP_ID',
  },
  supabase: {
    url: import.meta.env.VITE_SUPABASE_URL || '',
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  },
  onramp: {
    url: import.meta.env.VITE_ONRAMP_URL || '',
  },
} as const;
