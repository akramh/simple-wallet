// Vite inlines `VITE_*` prefixed env vars at build time. Declare the shape
// so popup/sidepanel TypeScript checks recognize `import.meta.env` without
// pulling in the full `vite/client` lib.

interface ImportMetaEnv {
  readonly VITE_ALCHEMY_API_KEY?: string;
  readonly VITE_HELIUS_API_KEY?: string;
  readonly VITE_COINGECKO_API_KEY?: string;
  readonly VITE_EXPLORER_API_KEY?: string;
  readonly VITE_EXPLORER_API_KEY_MAINNET?: string;
  readonly VITE_EXPLORER_API_KEY_SEPOLIA?: string;
  readonly VITE_EXPLORER_API_KEY_BASE?: string;
  readonly VITE_EXPLORER_API_KEY_ARBITRUM?: string;
  readonly VITE_EXPLORER_API_KEY_OPTIMISM?: string;
  readonly VITE_EXPLORER_API_KEY_POLYGON?: string;
  readonly VITE_EXPLORER_API_KEY_AVALANCHE?: string;
  readonly VITE_EXPLORER_API_KEY_BSC?: string;
  readonly VITE_EXPLORER_API_KEY_LINEA?: string;
  readonly VITE_EXPLORER_API_KEY_SOLANA_MAINNET?: string;
  readonly VITE_EXPLORER_API_KEY_SOLANA_DEVNET?: string;
  readonly VITE_TONCENTER_API_KEY?: string;
  readonly VITE_TONCENTER_API_KEY_TON_MAINNET?: string;
  readonly VITE_TONCENTER_API_KEY_TON_TESTNET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
