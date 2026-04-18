# External APIs and Environment Variables

This document inventories the external services used by the wallet, why each
one is contacted, and which environment variables configure those calls.

## Runtime External APIs

| Service | Hosts / Endpoints | Used For | Environment Variables |
| --- | --- | --- | --- |
| Alchemy chain JSON-RPC | `https://<chain>.g.alchemy.com/v2/<key>` for EVM networks and Solana | Primary RPC for EVM and Solana: balances, token reads, gas data, transaction submission, Solana RPC calls, and Alchemy Transfers over JSON-RPC | `ALCHEMY_API_KEY`, `VITE_ALCHEMY_API_KEY`, `EXPO_PUBLIC_ALCHEMY_API_KEY` |
| Public EVM RPC fallbacks | `ethereum-rpc.publicnode.com`, `ethereum-sepolia-rpc.publicnode.com`, `sepolia.gateway.tenderly.co`, `endpoints.omniatech.io`, `rpc.sepolia.org`, `mainnet.base.org`, `arb1.arbitrum.io`, `mainnet.optimism.io`, `polygon-rpc.com`, `api.avax.network`, `bsc-dataseed.binance.org`, `rpc.linea.build` | Fallback JSON-RPC providers when a preceding RPC endpoint fails or a keyed endpoint is unavailable | None |
| Alchemy Transfers API | `alchemy_getAssetTransfers` through the configured Alchemy RPC URL | EVM transaction history for `mainnet`, `sepolia`, `base`, `polygon`, `arbitrum`, and `optimism` | Same Alchemy key used in the RPC URL |
| Alchemy Portfolio API | `https://api.g.alchemy.com/data/v1/<key>/assets/tokens/by-address` | Extension unified portfolio fast path for supported EVM networks and Solana mainnet | `VITE_ALCHEMY_API_KEY` in extension builds |
| Alchemy Prices API | `https://api.g.alchemy.com/prices/v1/<key>/...` | First-priority current USD token prices by symbol and by contract address | `ALCHEMY_API_KEY`, `VITE_ALCHEMY_API_KEY`, `EXPO_PUBLIC_ALCHEMY_API_KEY` through mobile config |
| Etherscan V2 API | `https://api.etherscan.io/v2/api` | EVM transaction and ERC-20 transfer history fallback using `chainid` query params | `EXPLORER_API_KEY`, `VITE_EXPLORER_API_KEY`, optional `EXPLORER_API_KEY_<NETWORK>` / `VITE_EXPLORER_API_KEY_<NETWORK>` |
| Mempool.space API | `https://mempool.space/api`, `https://mempool.space/testnet/api` | Bitcoin balances, UTXOs, transaction history, fee estimates, block height, and signed transaction broadcast | None |
| Solana public RPC fallbacks | `solana-mainnet.rpc.extrnode.com`, `rpc.ankr.com/solana`, `api.devnet.solana.com` | Solana fallback RPC for balances, SPL balances, blockhash lookup, sends, signature status, and transaction history | None |
| XRP Ledger WebSocket APIs | `wss://xrplcluster.com`, `wss://s1.ripple.com`, `wss://s2.ripple.com`, `wss://s.altnet.rippletest.net:51233` | XRP balances, reserves, transaction history, fees, ledger data, transaction lookup, and transaction submission | None |
| Toncenter JSON-RPC | `https://toncenter.com/api/v2/jsonRPC`, `https://testnet.toncenter.com/api/v2/jsonRPC` | TON balances, transaction history, fee estimation, seqno reads, transfer sends, and post-send polling | `TONCENTER_API_KEY`, `TONCENTER_API_KEY_TON_MAINNET`, `TONCENTER_API_KEY_TON_TESTNET`, `VITE_TONCENTER_API_KEY`, `VITE_TONCENTER_API_KEY_TON_MAINNET`, `VITE_TONCENTER_API_KEY_TON_TESTNET` |
| CoinGecko API | `https://api.coingecko.com/api/v3`, or `https://pro-api.coingecko.com/api/v3` when a key is set | Price fallback, ERC-20 contract price lookups, historical charts, and token metadata | `COINGECKO_API_KEY`, `VITE_COINGECKO_API_KEY` |
| CoinPaprika API | `https://api.coinpaprika.com/v1` | Third-tier fallback for current prices, historical prices, and token metadata | None |

## Explorer Link Hosts

These hosts are used to build user-facing transaction or address links. They
are not currently used as programmatic API sources.

| Host | Purpose |
| --- | --- |
| `etherscan.io`, `sepolia.etherscan.io` | Ethereum / Sepolia transaction links |
| `basescan.org` | Base transaction links |
| `arbiscan.io` | Arbitrum transaction links |
| `optimistic.etherscan.io` | Optimism transaction links |
| `polygonscan.com` | Polygon transaction links |
| `snowtrace.io` | Avalanche transaction links |
| `bscscan.com` | BNB Smart Chain transaction links |
| `lineascan.build` | Linea transaction links |
| `mempool.space` | Bitcoin transaction and address links |
| `solscan.io` | Solana transaction links |
| `xrpscan.com`, `testnet.xrpscan.com` | XRP Ledger transaction links |
| `tonscan.org`, `testnet.tonscan.org` | TON transaction and address links |

Because these are browser-facing links, they may belong in UI config, but they
do not need to be treated as data APIs unless code starts fetching from them.

## Environment Variables

### Active Variables

| Variable | Platforms | Used For |
| --- | --- | --- |
| `ALCHEMY_API_KEY` | CLI, mobile | Substitutes `${ALCHEMY_API_KEY}` in EVM and Solana RPC URLs; also used by Alchemy Prices in Node/mobile contexts |
| `VITE_ALCHEMY_API_KEY` | Extension | Vite-inlined Alchemy key for RPC URL substitution, Alchemy Prices, Alchemy Portfolio, and log redaction |
| `EXPO_PUBLIC_ALCHEMY_API_KEY` | Mobile | Mobile fallback source for the Alchemy key when `ALCHEMY_API_KEY` is not set |
| `EXPLORER_API_KEY` | CLI, mobile, extension through `VITE_EXPLORER_API_KEY` fallback logic | Global Etherscan V2 API key |
| `VITE_EXPLORER_API_KEY` | Extension | Vite-inlined global Etherscan V2 API key |
| `EXPLORER_API_KEY_MAINNET` | CLI | Optional network-specific Etherscan key for Ethereum mainnet |
| `EXPLORER_API_KEY_SEPOLIA` | CLI | Optional network-specific Etherscan key for Sepolia |
| `EXPLORER_API_KEY_BASE` | CLI | Optional network-specific Etherscan key for Base if an Etherscan fallback path is configured |
| `EXPLORER_API_KEY_ARBITRUM` | CLI | Optional network-specific Etherscan key for Arbitrum if an Etherscan fallback path is configured |
| `EXPLORER_API_KEY_OPTIMISM` | CLI | Optional network-specific Etherscan key for Optimism if an Etherscan fallback path is configured |
| `EXPLORER_API_KEY_POLYGON` | CLI | Optional network-specific Etherscan key for Polygon if an Etherscan fallback path is configured |
| `EXPLORER_API_KEY_AVALANCHE` | CLI | Optional network-specific Etherscan key for Avalanche if an Etherscan fallback path is configured |
| `EXPLORER_API_KEY_BSC` | CLI | Optional network-specific Etherscan key for BNB Smart Chain if an Etherscan fallback path is configured |
| `EXPLORER_API_KEY_LINEA` | CLI | Optional network-specific Etherscan key for Linea if an Etherscan fallback path is configured |
| `VITE_EXPLORER_API_KEY_MAINNET` | Extension | Optional network-specific Etherscan key for Ethereum mainnet |
| `VITE_EXPLORER_API_KEY_SEPOLIA` | Extension | Optional network-specific Etherscan key for Sepolia |
| `VITE_EXPLORER_API_KEY_BASE` | Extension | Optional network-specific Etherscan key for Base if an Etherscan fallback path is configured |
| `VITE_EXPLORER_API_KEY_ARBITRUM` | Extension | Optional network-specific Etherscan key for Arbitrum if an Etherscan fallback path is configured |
| `VITE_EXPLORER_API_KEY_OPTIMISM` | Extension | Optional network-specific Etherscan key for Optimism if an Etherscan fallback path is configured |
| `VITE_EXPLORER_API_KEY_POLYGON` | Extension | Optional network-specific Etherscan key for Polygon if an Etherscan fallback path is configured |
| `VITE_EXPLORER_API_KEY_AVALANCHE` | Extension | Optional network-specific Etherscan key for Avalanche if an Etherscan fallback path is configured |
| `VITE_EXPLORER_API_KEY_BSC` | Extension | Optional network-specific Etherscan key for BNB Smart Chain if an Etherscan fallback path is configured |
| `VITE_EXPLORER_API_KEY_LINEA` | Extension | Optional network-specific Etherscan key for Linea if an Etherscan fallback path is configured |
| `TONCENTER_API_KEY` | CLI, extension via `VITE_TONCENTER_API_KEY` fallback logic | Global Toncenter API key fallback |
| `TONCENTER_API_KEY_TON_MAINNET` | CLI, mobile | Toncenter mainnet API key |
| `TONCENTER_API_KEY_TON_TESTNET` | CLI, mobile | Toncenter testnet API key |
| `VITE_TONCENTER_API_KEY` | Extension | Vite-inlined global Toncenter API key fallback |
| `VITE_TONCENTER_API_KEY_TON_MAINNET` | Extension | Vite-inlined Toncenter mainnet API key |
| `VITE_TONCENTER_API_KEY_TON_TESTNET` | Extension | Vite-inlined Toncenter testnet API key |
| `COINGECKO_API_KEY` | CLI, mobile | CoinGecko key for Pro API host and higher rate limits |
| `VITE_COINGECKO_API_KEY` | Extension | Vite-inlined CoinGecko key |

### Legacy or Effectively Unused Variables

| Variable | Status | Notes |
| --- | --- | --- |
| `HELIUS_API_KEY` | Legacy compatibility | Read by config substitution for older Solana RPC URLs containing `${HELIUS_API_KEY}`, but current `config.json` uses Alchemy and public Solana RPC fallbacks. |
| `VITE_HELIUS_API_KEY` | Legacy compatibility | Same as `HELIUS_API_KEY`, plus registered for extension log redaction. |
| `EXPLORER_API_KEY_SOLANA_MAINNET` | Effectively unused | Can be loaded into config, but Solana runtime code uses RPC directly and does not consume `explorerApiKey`. |
| `EXPLORER_API_KEY_SOLANA_DEVNET` | Effectively unused | Same as above. |
| `VITE_EXPLORER_API_KEY_SOLANA_MAINNET` | Effectively unused | Declared and loadable by shared config helpers, but no Solana explorer API client consumes it. |
| `VITE_EXPLORER_API_KEY_SOLANA_DEVNET` | Effectively unused | Same as above. |

## Allowlist Cleanup Candidates

The following domains appear in CSP or mobile network-security allowlists, but
runtime code does not currently fetch them as APIs:

- `api.basescan.org`
- `api.arbiscan.io`
- `api-optimistic.etherscan.io`
- `api.polygonscan.com`
- `api.snowtrace.io`
- `api.bscscan.com`
- `api.lineascan.build`
- `api.solscan.io`
- `api.xrpscan.com`
- `api.tonscan.org`
- `mainnet.helius-rpc.com` if legacy Helius support is removed

Keep the non-`api.` explorer website domains if transaction and address links
remain part of the UI.
