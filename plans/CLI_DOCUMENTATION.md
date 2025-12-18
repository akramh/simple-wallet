# CLI Documentation

## Overview

The CLI (`src/index.ts`) is the original and most direct interface to the Simple Crypto Wallet. It runs in a Node.js environment and provides a text-based, interactive menu system for all wallet operations. It is primarily used for testing core functionality and for users who prefer terminal tools.

## Entry Point

-   **File**: `src/index.ts`
-   **Execution**: `npm run dev` (which runs `tsx src/index.ts`)

## Architecture

The CLI is a thin consumer of the **Core SDK**. It does not contain business logic; instead, it focuses on:
1.  **Input Collection**: Using `readline` or `inquirer` patterns to get user input (passwords, addresses).
2.  **Output Formatting**: displaying balances, tables, and spinners using `ora` and chalk-like formatting.
3.  **State Management**: Holding the instance of `WalletAppService`.

### Components

-   **`main()`**: The event loop that continuously presents the menu until exit.
-   **`ui-helpers.ts`**: Utilities for consistent terminal output (headers, dividers, currency formatting).

## Features & Flows

### 1. Initialization
On startup, the CLI:
-   Initializes the `FileStorage` adapter (reads from `wallets.json`, `config.json`).
-   Instantiates `WalletAppService`.
-   Checks if any wallets exist.
    -   If **No**: Prompts to Create or Import.
    -   If **Yes**: Prompts to Load (Unlock) or Import another.

### 2. Main Menu
Once unlocked, the user sees:
1.  **View Portfolio**: Aggregates value across all tokens on the current network.
2.  **Send Transaction**: Wizard for sending ETH, BTC, SOL, XRP, or ERC-20s.
3.  **Address & Receive**: Displays the address and QR code (ASCII art).
4.  **Transaction History**: Fetches and displays recent txs in a table.
5.  **Switch Network**: Toggles between Mainnet/Testnet and different chains.
6.  **Manage Tokens**: Add/Remove custom ERC-20 tokens.
7.  **Wallet Management**: Create new account (HD derivation), Export, Delete.

### 3. XRP Support (New)
The CLI has been updated to fully support the new XRP modules:
-   **Portfolio**: Displays XRP balance (fetching reserve requirements).
-   **Send**: Prompts for "Destination Tag" (optional) when sending XRP.
-   **History**: Shows XRP payment transactions.

## Configuration

The CLI relies on:
-   `config.json`: Defines available networks and RPC endpoints.
-   `.env`: Loads API keys (e.g., `EXPLORER_API_KEY`) for fetching history and balances.

## Development & Testing

The CLI is the primary target for the integration tests (`npm test`).
-   Tests mock user input to simulate flows through the CLI methods.
-   It verifies that the `WalletAppService` responds correctly to "user" commands.
