# How Simple Wallet Uses Alchemy

Simple Wallet is a working, multi-chain wallet whose entire on-chain data layer
runs on [Alchemy](https://www.alchemy.com/). This document is a guided tour of
**how** it uses Alchemy — a reference implementation you can read end to end.

**Using one Alchemy API key powers four different Alchemy products
across nine EVM chains plus Solana, shared by three separate apps** (a Node CLI,
a Chrome extension, and an Expo mobile app) from a single TypeScript core.

| Alchemy product | What the wallet uses it for | Primary code |
| --- | --- | --- |
| **JSON-RPC** (EVM + Solana) | Balances, token reads, gas, transaction submission | [`src/ethereum/provider.ts`](../src/ethereum/provider.ts), [`src/solana/provider.ts`](../src/solana/provider.ts) |
| **Transfers API** (`alchemy_getAssetTransfers`) | EVM transaction history | [`src/ethereum/alchemy-transfers.ts`](../src/ethereum/alchemy-transfers.ts) |
| **Prices API** | USD token prices (by symbol and by contract) | [`src/price-providers/alchemy.ts`](../src/price-providers/alchemy.ts) |
| **Portfolio Data API** | One-call unified balances + prices + metadata | [`src/portfolio-api.ts`](../src/portfolio-api.ts) |

> For a flat inventory of every external service and environment variable (not
> just Alchemy), see [external-apis-and-env.md](./external-apis-and-env.md).
> This document is the narrative tour plus the
> [endpoint reference](#endpoint-reference); that one is the cross-service
> reference table.

---

## The one-key, many-chains model

Alchemy does **not** issue a separate key per chain. A single key authenticates
against every chain — the **hostname selects the chain**:

```
https://eth-mainnet.g.alchemy.com/v2/<KEY>      → Ethereum
https://base-mainnet.g.alchemy.com/v2/<KEY>     → Base
https://polygon-mainnet.g.alchemy.com/v2/<KEY>  → Polygon
https://solana-mainnet.g.alchemy.com/v2/<KEY>   → Solana
https://api.g.alchemy.com/prices/v1/<KEY>/...   → Prices API
https://api.g.alchemy.com/data/v1/<KEY>/...     → Portfolio Data API
```

The wallet stores these URLs in [`config.json`](../config.json) with a
`${ALCHEMY_API_KEY}` placeholder and substitutes the real key at runtime. The
canonical substitution lives in
[`src/config-utils.ts`](../src/config-utils.ts) (`substitutePlaceholder`); a URL
whose required key is missing is dropped from the failover array rather than
sent with an empty key.

Each network's `rpcUrl` is an **array**: the Alchemy endpoint first, a public
RPC second. If Alchemy is unreachable, the provider fails over to the public
endpoint automatically — so the wallet degrades gracefully but prefers Alchemy
for reliability and rate limits.

---

## 1. JSON-RPC — balances, reads, gas, and sends

**EVM** ([`src/ethereum/provider.ts`](../src/ethereum/provider.ts)): every EVM
read and write goes through Alchemy JSON-RPC via ethers `JsonRpcProvider`:

- Native and ERC-20 balances (`getBalance`, `balanceOf`), batched through
  Multicall3 to collapse many token reads into one round trip.
- Token metadata, `estimateGas`, `getFeeData`, and `sendTransaction` /
  `sendToken`.
- The provider iterates the `rpcUrl` array with retry/failover, and log output
  redacts the `/v2/<key>` segment so keys never reach the console.

The provider factory in [`src/providers.ts`](../src/providers.ts) strips the
ethers Polygon gas-station plugin so `getFeeData()` uses standard `eth_gasPrice`
against the Alchemy endpoint rather than a third-party gas oracle.

**Solana** ([`src/solana/provider.ts`](../src/solana/provider.ts)): uses
`@solana/web3.js` `Connection` against `solana-mainnet.g.alchemy.com`, with
`getBalance`, `getParsedTokenAccountsByOwner` (SPL balances), blockhash and
priority-fee reads, and `sendRawTransaction`. Solana transaction history uses
the same Alchemy-first connection in
[`src/solana/explorer.ts`](../src/solana/explorer.ts).

**Chains:** all nine EVM networks (Ethereum, Sepolia, Base, Arbitrum, Optimism,
Polygon, Avalanche, BNB Smart Chain, Linea) plus Solana mainnet/devnet.

---

## 2. Transfers API — EVM transaction history

Fetching a full transaction history from raw JSON-RPC is painful. Alchemy's
[`alchemy_getAssetTransfers`](https://docs.alchemy.com/reference/alchemy-getassettransfers)
returns categorized transfers (external, internal, ERC-20, ERC-721, ERC-1155)
in one call.

[`src/ethereum/alchemy-transfers.ts`](../src/ethereum/alchemy-transfers.ts)
(`AlchemyTransfersClient`) issues two parallel calls — one for sent, one for
received — and merges them. It requests the `internal` category only on chains
that support it (mainnet, polygon).

The dispatch decision lives in
[`src/explorer-api.ts`](../src/explorer-api.ts) (`getAllTransactions`): if the
network has an Alchemy URL **and** is in the Transfers allowlist
(`mainnet, sepolia, base, polygon, arbitrum, optimism`), it uses the Transfers
API. For EVM chains Alchemy Transfers does not yet cover
(**avalanche, bsc, linea**), it transparently falls back to the Etherscan V2 API
behind the same interface — a good example of using Alchemy where it's strongest
and filling gaps without changing callers.

---

## 3. Prices API — USD token prices

[`src/price-providers/alchemy.ts`](../src/price-providers/alchemy.ts)
(`AlchemyPriceProvider`) is registered at **priority 0** in
[`src/price-providers/index.ts`](../src/price-providers/index.ts) — it is tried
before CoinGecko and CoinPaprika.

- Current price by symbol: `GET /prices/v1/<key>/tokens/by-symbol`.
- Price by contract address: `POST /prices/v1/<key>/tokens/by-address`, mapping
  each chain to its Alchemy slug via `CHAIN_ID_TO_ALCHEMY_SLUG`.

It intentionally throws fast for historical charts and token metadata (which the
Prices API doesn't cover), so the price manager falls through to CoinGecko for
those. This layered provider pattern lets each source do what it's best at while
Alchemy stays the default for spot prices.

---

## 4. Portfolio Data API — the unified fast path

The most powerful integration. Instead of N RPC calls per chain per token,
[`src/portfolio-api.ts`](../src/portfolio-api.ts) (`fetchAlchemyPortfolio`)
issues a single `POST` to
`https://api.g.alchemy.com/data/v1/<key>/assets/tokens/by-address` with
`withMetadata`, `withPrices`, `includeNativeTokens`, and `includeErc20Tokens`.
One request returns **balances, USD prices, and token metadata** for multiple
addresses across multiple chains at once.

It respects Alchemy's batch limits (2 addresses × 5 networks per call) and maps
the wallet's network keys to portfolio slugs via
`NETWORK_KEY_TO_PORTFOLIO_SLUG` (the 9 EVM chains + Solana mainnet).

Both rich UIs use it as their primary refresh path, falling back to per-chain
RPC only if it fails:

- **Extension:** `refreshViaPortfolioApi()` in
  [`extension/background/service-worker.ts`](../extension/background/service-worker.ts).
- **Mobile:** `fetchAlchemyPortfolioWithRetry()` in
  [`mobile-wallet/services/WalletBridge.ts`](../mobile-wallet/services/WalletBridge.ts),
  with bounded retry/backoff.

---

## Endpoint reference

Every Alchemy call the wallet makes, in one place. All hosts follow the
[one-key model](#the-one-key-many-chains-model) above — `<key>` is the
substituted `ALCHEMY_API_KEY`.

### EVM JSON-RPC

Issued by [`src/ethereum/provider.ts`](../src/ethereum/provider.ts) through
ethers `JsonRpcProvider` against `https://<chain>.g.alchemy.com/v2/<key>`
(the nine hosts listed in the coverage matrix below). Mapping wallet features
to the underlying RPC methods:

| Wallet feature | JSON-RPC method(s) |
| --- | --- |
| Native balance | `eth_getBalance` |
| ERC-20 balances + metadata | `eth_call` (`balanceOf` / `decimals` / `symbol` / `name`, batched through Multicall3 to collapse many token reads into one round trip) |
| Fee estimation | `eth_gasPrice` / `eth_maxPriorityFeePerGas` via ethers `getFeeData()` (the Polygon gas-station plugin is stripped in [`src/providers.ts`](../src/providers.ts) so fees come from Alchemy, not a third-party oracle) |
| Gas limit | `eth_estimateGas` |
| Send (native + ERC-20) | `eth_sendRawTransaction` (locally signed), then `eth_getTransactionReceipt` for confirmation |
| Housekeeping (issued by ethers) | `eth_chainId`, `eth_blockNumber` |

The `rpcUrl` config array is iterated in order with retry/exponential backoff;
Alchemy is first, public RPC endpoints are the failover.

### Solana JSON-RPC

Issued through `@solana/web3.js` `Connection` against
`https://solana-{mainnet,devnet}.g.alchemy.com/v2/<key>`:

| Wallet feature | RPC method(s) | Code |
| --- | --- | --- |
| SOL balance | `getBalance` | [`src/solana/provider.ts`](../src/solana/provider.ts) |
| SPL token balances | `getParsedTokenAccountsByOwner`, `getAccountInfo` (associated token accounts) | [`src/solana/provider.ts`](../src/solana/provider.ts) |
| Fee estimation | `getLatestBlockhash`, `getFeeForMessage`, `getRecentPrioritizationFees` | [`src/solana/provider.ts`](../src/solana/provider.ts) |
| Send + confirm | `sendRawTransaction`, `getSignatureStatus` | [`src/solana/provider.ts`](../src/solana/provider.ts) |
| Transaction history | `getSignaturesForAddress`, `getParsedTransaction` | [`src/solana/explorer.ts`](../src/solana/explorer.ts) |

### Transfers API

[`src/ethereum/alchemy-transfers.ts`](../src/ethereum/alchemy-transfers.ts)
calls [`alchemy_getAssetTransfers`](https://docs.alchemy.com/reference/alchemy-getassettransfers)
(a JSON-RPC method on the same per-chain hosts):

| Aspect | Value |
| --- | --- |
| Calls per refresh | 2 in parallel — one with `fromAddress` (sent), one with `toAddress` (received); results merged, de-duped by hash, sorted newest-first |
| `category` | `external` + `erc20` everywhere; `internal` added only on Ethereum mainnet and Polygon (the chains where Alchemy supports it) |
| Other request params | `fromBlock: 0x0`, `toBlock: latest`, `order: desc`, `withMetadata: true`, `excludeZeroValue: true`, `maxCount` ≤ 1000 |
| Pagination | First page only — Alchemy's opaque `pageKey` cursor is not followed |
| Chains | mainnet, sepolia, base, polygon, arbitrum, optimism (`ALCHEMY_TRANSFERS_NETWORKS`); avalanche / bsc / linea fall back to Etherscan V2 — dispatch in [`src/explorer-api.ts`](../src/explorer-api.ts) `getAllTransactions` |

### Prices API

[`src/price-providers/alchemy.ts`](../src/price-providers/alchemy.ts), base
`https://api.g.alchemy.com/prices/v1/<key>`:

| Endpoint | Used for | Notes |
| --- | --- | --- |
| `GET /tokens/by-symbol?symbols=<SYM>` | Spot price of natives and majors | Gated by the `SUPPORTED_SYMBOLS` allowlist (majors, stablecoins, top DeFi, SPL ecosystem); anything else goes straight to CoinGecko |
| `POST /tokens/by-address` | Spot price of an ERC-20 by contract | Body pairs each address with its network slug via `CHAIN_ID_TO_ALCHEMY_SLUG` (all nine EVM chains) |

Registered at priority 0 — tried before CoinGecko/CoinPaprika. Historical
charts and token metadata intentionally throw so the price manager falls
through to CoinGecko for those.

### Portfolio Data API

[`src/portfolio-api.ts`](../src/portfolio-api.ts), single endpoint
`POST https://api.g.alchemy.com/data/v1/<key>/assets/tokens/by-address`:

| Aspect | Value |
| --- | --- |
| Batch limits | 2 address entries per request × 5 networks per address; larger portfolios are split into multiple requests |
| Request flags | `withMetadata`, `withPrices`, `includeNativeTokens`, `includeErc20Tokens` |
| Network slugs | `NETWORK_KEY_TO_PORTFOLIO_SLUG` — all nine EVM chains plus Solana mainnet. Quirk: the endpoint accepts `solana-mainnet`, not the `sol-mainnet` slug some docs list (verified against the live API) |
| Not covered | Bitcoin, XRP, TON, Solana devnet — those refresh through their per-chain providers |

### Key validation

[`src/alchemy-key.ts`](../src/alchemy-key.ts) validates a pasted key with a
single bounded-timeout `eth_blockNumber` POST to
`https://eth-mainnet.g.alchemy.com/v2/<key>` — used by the first-run flows on
all three platforms.

### Chain × product coverage

| Network | JSON-RPC | Tx history | Prices | Portfolio |
| --- | --- | --- | --- | --- |
| Ethereum (`eth-mainnet`) | ✓ | Transfers (+ internal) | ✓ | ✓ |
| Sepolia (`eth-sepolia`) | ✓ | Transfers | ✓ | ✓ |
| Base (`base-mainnet`) | ✓ | Transfers | ✓ | ✓ |
| Arbitrum (`arb-mainnet`) | ✓ | Transfers | ✓ | ✓ |
| Optimism (`opt-mainnet`) | ✓ | Transfers | ✓ | ✓ |
| Polygon (`polygon-mainnet`) | ✓ | Transfers (+ internal) | ✓ | ✓ |
| Avalanche (`avax-mainnet`) | ✓ | Etherscan V2 fallback | ✓ | ✓ |
| BNB Smart Chain (`bnb-mainnet`) | ✓ | Etherscan V2 fallback | ✓ | ✓ |
| Linea (`linea-mainnet`) | ✓ | Etherscan V2 fallback | ✓ | ✓ |
| Solana mainnet (`solana-mainnet`) | ✓ | Solana RPC (via Alchemy) | by symbol | ✓ |
| Solana devnet (`solana-devnet`) | ✓ | Solana RPC (via Alchemy) | — | — |

"Tx history" names the source behind `getAllTransactions`; "Prices — by
symbol" means the by-address contract lookup is EVM-only, while SOL and SPL
majors resolve through the by-symbol endpoint.

---

## Configuring the key per platform

The same key, sourced differently per build system:

| Platform | Variable | How it's read |
| --- | --- | --- |
| CLI / Node | `ALCHEMY_API_KEY` | `process.env`, substituted by [`src/config-utils.ts`](../src/config-utils.ts) |
| Chrome extension | `VITE_ALCHEMY_API_KEY` | Vite inlines `import.meta.env.VITE_ALCHEMY_API_KEY` at build; [`vite.config.extension.ts`](../vite.config.extension.ts) copies `config.json` and runtime substitution keys off the `VITE_` value |
| Mobile (Expo) | `EXPO_PUBLIC_ALCHEMY_API_KEY` | [`mobile-wallet/app.config.js`](../mobile-wallet/app.config.js) maps it into `expo.extra.alchemyApiKey`; [`mobile-wallet/config/bundled-config.ts`](../mobile-wallet/config/bundled-config.ts) reads and substitutes it |

To run the wallet you only need the one key — see the
[README quickstart](../README.md) and [.env.example](../.env.example).

### Entering the key at runtime

Each app also offers a first-run "get started with Alchemy" flow (skippable,
re-reachable from settings) that validates a pasted key live — a JSON-RPC
`eth_blockNumber` against Ethereum mainnet via
[`src/alchemy-key.ts`](../src/alchemy-key.ts) — before saving it:

| Platform | Where the entered key lives | Entry points |
| --- | --- | --- |
| CLI | Repo-root `.env` (written with all three platform variants, mode 0600) | First-run prompt; "Alchemy API Key" in the initial and settings menus |
| Extension | `chrome.storage.local` (never leaves the service worker; UI sees a masked form only) | Welcome step before create/import; Settings → Network & API |
| Mobile | `expo-secure-store` (OS Keychain/Keystore) | Onboarding screen before create/import; Profile → Alchemy API Key |

**Precedence:** a runtime-entered key always wins over the build-time env
key (`ALCHEMY_API_KEY` / `VITE_` / `EXPO_PUBLIC_`); removing it falls back
to the build-time key when one exists, else to public-RPC degraded mode.
Applying or removing a key re-substitutes RPC URLs and resets cached
providers in place — no restart needed on any platform.

---

## Security patterns worth copying

Embedding a data-provider key in a client app is inherently exposed (extension
and mobile bundles are inspectable). Simple Wallet mitigates this with patterns
worth reusing in your own Alchemy integration:

- **Key redaction in logs** — [`src/utils/redact-logs.ts`](../src/utils/redact-logs.ts)
  patches `console.*` to strip the key from any logged URL, on every platform.
- **Host allowlist** — [`src/config/network-policy.ts`](../src/config/network-policy.ts)
  allowlists `*.g.alchemy.com` and `api.g.alchemy.com`, so the wallet only talks
  to expected hosts.
- **Extension CSP** — [`extension/manifest.json`](../extension/manifest.json)
  restricts `connect-src` to the specific Alchemy hosts it uses.
- **Restrict the key in Alchemy's dashboard** — for shipped extension/mobile
  builds, scope the key by allowed origins, bundle IDs, and extension IDs. See
  [docs/security.md](./security.md).

---

## Not used yet (good extension ideas)

Two Alchemy product areas the wallet does **not** currently use — natural next
steps if you want to extend this showcase:

- **NFT API** — `getNFTsForOwner` / NFT metadata for an in-wallet NFT gallery.
- **Webhooks / Notify** — push transaction notifications instead of polling.
