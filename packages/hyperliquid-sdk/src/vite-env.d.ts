/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HYPERLIQUID_TESTNET?: string;
  readonly VITE_BUILDER_ADDRESS?: string;
  readonly VITE_BUILDER_FEE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
