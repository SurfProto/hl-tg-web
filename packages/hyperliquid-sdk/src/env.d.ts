interface ImportMetaEnv {
  readonly VITE_BUILDER_ADDRESS?: string;
  readonly VITE_BUILDER_FEE?: string;
  readonly VITE_HYPERLIQUID_TESTNET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
