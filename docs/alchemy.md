# How Simple Wallet Uses Alchemy

Simple Wallet is a working, multi-chain wallet whose entire on-chain data layer
runs on [Alchemy](https://www.alchemy.com/). This document is a guided tour of
**how** it uses Alchemy — a reference implementation you can read end to end.

The headline: **one Alchemy API key powers four different Alchemy products
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
> This document is the narrative tour; that one is the reference table.

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

## Configuring the key per platform

The same key, sourced differently per build system:

| Platform | Variable | How it's read |
| --- | --- | --- |
| CLI / Node | `ALCHEMY_API_KEY` | `process.env`, substituted by [`src/config-utils.ts`](../src/config-utils.ts) |
| Chrome extension | `VITE_ALCHEMY_API_KEY` | Vite inlines `import.meta.env.VITE_ALCHEMY_API_KEY` at build; [`vite.config.extension.ts`](../vite.config.extension.ts) copies `config.json` and runtime substitution keys off the `VITE_` value |
| Mobile (Expo) | `EXPO_PUBLIC_ALCHEMY_API_KEY` | [`mobile-wallet/app.config.js`](../mobile-wallet/app.config.js) maps it into `expo.extra.alchemyApiKey`; [`mobile-wallet/config/bundled-config.ts`](../mobile-wallet/config/bundled-config.ts) reads and substitutes it |

To run the wallet you only need the one key — see the
[README quickstart](../README.md) and [.env.example](../.env.example).

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
