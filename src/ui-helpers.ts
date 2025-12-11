/**
 * @file ui-helpers.ts
 * @description Terminal UI formatting utilities for the CLI wallet application.
 * 
 * Provides a consistent visual style for the command-line interface with
 * colored output, formatted boxes, styled messages, and menu helpers.
 * Uses the `chalk` library for terminal color support.
 * 
 * @responsibilities
 * - Consistent header and section formatting
 * - Message styling (success, error, warning, info)
 * - Box layouts for important information
 * - Address, amount, and transaction hash formatting
 * - Menu separator and choice helpers for inquirer
 * - Secure mnemonic display formatting
 * 
 * @dependencies
 * - chalk: Terminal color/styling library
 * 
 * @example
 * ```typescript
 * import { showHeader, showSuccess, showError } from './ui-helpers.js';
 * 
 * showHeader('main-wallet', 0, 'Ethereum Mainnet', '0x...');
 * showSuccess('Transaction sent successfully!');
 * showError('Insufficient balance', ['Check your balance', 'Try a smaller amount']);
 * ```
 */

import chalk from 'chalk';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Type of box styling for the showBox function.
 * Each type corresponds to a different color scheme.
 */
type BoxType = 'info' | 'success' | 'warning' | 'error';

/**
 * Menu separator for inquirer prompt choices.
 * Displays a horizontal line to group related options.
 */
interface MenuSeparator {
  type: 'separator';
  line: string;
}

/**
 * Menu choice item for inquirer prompt.
 */
interface MenuChoice {
  /** Display name shown in the menu */
  name: string;
  /** Value returned when this choice is selected */
  value: string;
}

/**
 * Minimal transaction receipt for display purposes.
 */
interface TransactionReceipt {
  /** Transaction hash */
  hash: string;
  /** Block number where transaction was mined */
  blockNumber: number;
  /** Gas used by the transaction */
  gasUsed: bigint | string;
}

// ============================================================================
// Header and Section Functions
// ============================================================================

/**
 * Displays the application header with optional wallet context.
 * Shows a styled banner with wallet name, account number, network, and address.
 * 
 * @param walletName - Name of the current wallet (optional)
 * @param accountIndex - Zero-based account index (displayed as 1-based)
 * @param networkName - Human-readable network name (optional)
 * @param address - Ethereum address to display (optional)
 * 
 * @example
 * ```typescript
 * // Full header with all context
 * showHeader('main-wallet', 0, 'Ethereum Mainnet', '0x742d35Cc...');
 * 
 * // Simple header without context
 * showHeader();
 * ```
 */
export function showHeader(walletName: string | null = null, accountIndex: number | null = null, networkName: string | null = null, address: string | null = null): void {
  console.log('\n' + chalk.cyan('═'.repeat(60)));
  console.log(chalk.cyan.bold('  Simple Crypto Wallet'));

  if (walletName || accountIndex !== null || networkName) {
    const parts: string[] = [];
    if (walletName) parts.push(chalk.white(`Wallet: ${walletName}`));
    if (accountIndex !== null) parts.push(chalk.white(`Account #${accountIndex + 1}`));
    if (networkName) parts.push(chalk.white(networkName));

    console.log(chalk.cyan('  ') + parts.join(chalk.gray(' • ')));
  }

  if (address) {
    console.log(chalk.cyan('  ') + chalk.gray('Address: ') + formatAddress(address));
  }

  console.log(chalk.cyan('═'.repeat(60)) + '\n');
}

/**
 * Displays a section title in uppercase bold white text.
 * Used to group related content in the CLI output.
 * 
 * @param title - Section title (will be uppercased)
 * 
 * @example
 * ```typescript
 * showSection('account details');
 * // Outputs: ACCOUNT DETAILS
 * ```
 */
export function showSection(title: string): void {
  console.log(chalk.bold.white(title.toUpperCase()));
}

/**
 * Displays a horizontal separator line.
 * Used to visually divide sections in the CLI output.
 */
export function showSeparator(): void {
  console.log(chalk.gray('─'.repeat(60)));
}

// ============================================================================
// Box and Message Functions
// ============================================================================

/**
 * Displays content in a styled box with a title.
 * Box color varies by type: blue (info), green (success), yellow (warning), red (error).
 * 
 * @param title - Box title displayed at the top
 * @param content - Content to display (supports newlines)
 * @param type - Box styling type (default: 'info')
 * 
 * @example
 * ```typescript
 * showBox('Important', 'Your wallet has been created.', 'success');
 * showBox('Warning', 'Low balance detected.\nConsider adding funds.', 'warning');
 * ```
 */
export function showBox(title: string, content: string, type: BoxType = 'info'): void {
  const colors: Record<BoxType, typeof chalk.blue> = {
    info: chalk.blue,
    success: chalk.green,
    warning: chalk.yellow,
    error: chalk.red
  };

  const color = colors[type] || chalk.blue;
  const width = 58;

  console.log('\n' + color('┌' + '─'.repeat(width) + '┐'));
  console.log(color('│') + ' ' + chalk.bold(title.padEnd(width - 1)) + color('│'));
  console.log(color('├' + '─'.repeat(width) + '┤'));

  const lines = content.split('\n');
  lines.forEach(line => {
    console.log(color('│') + ' ' + line.padEnd(width - 1) + color('│'));
  });

  console.log(color('└' + '─'.repeat(width) + '┘') + '\n');
}

/**
 * Displays a success message with a green checkmark.
 * 
 * @param message - Success message to display
 * 
 * @example
 * ```typescript
 * showSuccess('Transaction sent successfully!');
 * // Outputs: ✓ Transaction sent successfully!
 * ```
 */
export function showSuccess(message: string): void {
  console.log(chalk.green('✓') + ' ' + chalk.white(message));
}

/**
 * Displays an error message with optional suggestions for resolution.
 * Shows a red X icon and formats suggestions as a bullet list.
 * 
 * @param message - Error message to display
 * @param suggestions - Optional array of suggestion strings
 * 
 * @example
 * ```typescript
 * showError('Insufficient balance', [
 *   'Check your current balance',
 *   'Try a smaller amount'
 * ]);
 * ```
 */
export function showError(message: string, suggestions: string[] = []): void {
  console.log('\n' + chalk.red.bold('✗ Error\n'));
  console.log(chalk.white(message) + '\n');

  if (suggestions.length > 0) {
    console.log(chalk.yellow('Suggestions:'));
    suggestions.forEach(suggestion => {
      console.log(chalk.gray('  •') + ' ' + chalk.white(suggestion));
    });
    console.log('');
  }
}

/**
 * Displays a warning message with a yellow warning icon.
 * 
 * @param message - Warning message to display
 */
export function showWarning(message: string): void {
  console.log(chalk.yellow('⚠') + ' ' + chalk.white(message));
}

/**
 * Displays an informational message with a blue info icon.
 * 
 * @param message - Info message to display
 */
export function showInfo(message: string): void {
  console.log(chalk.blue('ℹ') + ' ' + chalk.white(message));
}

/**
 * Displays a loading message with a hourglass icon.
 * Use before long-running operations.
 * 
 * @param message - Loading message to display
 */
export function showLoading(message: string): void {
  console.log(chalk.cyan('⏳') + ' ' + chalk.white(message));
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Formats an Ethereum address with cyan coloring.
 * Lowercases the address for consistency.
 * 
 * @param address - Ethereum address to format
 * @returns Formatted address string with ANSI color codes
 */
export function formatAddress(address: string): string {
  if (!address) return '';
  return chalk.cyan(address.toLowerCase());
}

/**
 * Formats a currency amount with the symbol.
 * Amount is displayed in bold green, symbol in gray.
 *
 * @param amount - Amount to display
 * @param currency - Currency symbol (default: 'ETH')
 * @returns Formatted amount string with ANSI color codes
 *
 * @example
 * ```typescript
 * formatAmount('1.5', 'ETH');  // "1.5 ETH" (styled)
 * formatAmount('100', 'USDC'); // "100 USDC" (styled)
 * ```
 */
export function formatAmount(amount: string, currency: string = 'ETH'): string {
  return chalk.green.bold(amount) + ' ' + chalk.gray(currency);
}

/**
 * Formats a USD price value for display.
 * Handles various value ranges with appropriate formatting.
 *
 * @param value - USD value to format (null if unavailable)
 * @returns Formatted USD string or '--' if unavailable
 *
 * @example
 * ```typescript
 * formatUsdPrice(1234.56);   // "$1,234.56"
 * formatUsdPrice(0.005);     // "<$0.01"
 * formatUsdPrice(1500000);   // "$1.50M"
 * formatUsdPrice(null);      // "--"
 * ```
 */
export function formatUsdPrice(value: number | null): string {
  if (value === null || value === undefined) return chalk.gray('--');
  if (value === 0) return chalk.gray('$0.00');
  if (value < 0.01) return chalk.gray('<$0.01');
  if (value < 1000) {
    return chalk.yellow(`$${value.toFixed(2)}`);
  }
  if (value < 1000000) {
    return chalk.yellow(`$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }
  // Millions
  return chalk.yellow(`$${(value / 1000000).toFixed(2)}M`);
}

/**
 * Formats a balance line with optional USD value.
 * Displays token balance followed by USD equivalent in parentheses.
 *
 * @param balance - Token balance amount
 * @param symbol - Token symbol
 * @param usdValue - Optional USD value
 * @param isNative - Whether this is the native token
 * @returns Formatted balance line
 */
export function formatBalanceWithUsd(
  balance: string,
  symbol: string,
  usdValue: number | null = null,
  isNative: boolean = false
): string {
  const label = `${symbol}${isNative ? ' (native)' : ''}`.padEnd(18);
  const balanceStr = chalk.green.bold(balance.padStart(14));
  const usdStr = usdValue !== null ? ` ${formatUsdPrice(usdValue)}` : '';
  return `${label} ${balanceStr}${usdStr}`;
}

/**
 * Formats a transaction hash with magenta coloring.
 * 
 * @param hash - Transaction hash to format
 * @returns Formatted hash string with ANSI color codes
 */
export function formatTxHash(hash: string): string {
  if (!hash) return '';
  return chalk.magenta(hash);
}

/**
 * Displays account information in a styled format.
 * Shows address and optional balance in a bordered section.
 * 
 * @param address - Ethereum address to display
 * @param balance - Optional balance to display (in ETH)
 */
export function showAccountInfo(address: string, balance: string | null = null): void {
  console.log('\n' + chalk.gray('━'.repeat(60)));
  console.log(chalk.white.bold('Account Information'));
  console.log(chalk.gray('━'.repeat(60)));
  console.log(chalk.gray('Address:  ') + formatAddress(address));
  if (balance !== null) {
    console.log(chalk.gray('Balance:  ') + formatAmount(balance));
  }
  console.log(chalk.gray('━'.repeat(60)) + '\n');
}

// ============================================================================
// Menu Helper Functions (for inquirer)
// ============================================================================

/**
 * Creates a menu separator for use with inquirer prompts.
 * Displays a horizontal gray line to visually group menu options.
 * 
 * @param label - Optional label (currently unused, reserved for future use)
 * @returns MenuSeparator object for inquirer
 * 
 * @example
 * ```typescript
 * const choices = [
 *   { name: 'Option 1', value: '1' },
 *   menuSeparator(),
 *   { name: 'Option 2', value: '2' }
 * ];
 * ```
 */
export function menuSeparator(label: string = ''): MenuSeparator {
  return {
    type: 'separator',
    line: chalk.gray('─'.repeat(60))
  };
}

/**
 * Creates a formatted menu choice for inquirer prompts.
 * Displays name padded with optional description in gray.
 * 
 * @param name - Choice name (displayed prominently)
 * @param description - Optional description (displayed in gray)
 * @param value - Value returned when selected (defaults to name)
 * @returns MenuChoice object for inquirer
 * 
 * @example
 * ```typescript
 * const choices = [
 *   menuChoice('Send ETH', 'Transfer native currency'),
 *   menuChoice('Send Token', 'Transfer ERC-20 tokens')
 * ];
 * ```
 */
export function menuChoice(name: string, description: string = '', value: string | null = null): MenuChoice {
  const displayName = description
    ? `${chalk.white(name.padEnd(30))} ${chalk.gray(description)}`
    : chalk.white(name);

  return {
    name: displayName,
    value: value || name
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Clears the terminal screen.
 * Wrapper around console.clear() for consistency.
 */
export function clearScreen(): void {
  console.clear();
}

// ============================================================================
// Security-Sensitive Display Functions
// ============================================================================

/**
 * Displays a wallet's recovery phrase in a secure, formatted box.
 * Shows 12-word mnemonic in two columns with numbered words.
 * Includes prominent security warnings about protecting the phrase.
 * 
 * @param mnemonic - Space-separated 12-word recovery phrase
 * 
 * @example
 * ```typescript
 * showMnemonic('word1 word2 word3 ... word12');
 * // Displays:
 * // ┌──────────────────────────────────────────────────────────┐
 * // │ Recovery Phrase (12 words)                               │
 * // ├──────────────────────────────────────────────────────────┤
 * // │  1. word1                      7. word7                  │
 * // │  2. word2                      8. word8                  │
 * // │  ...                                                     │
 * // └──────────────────────────────────────────────────────────┘
 * ```
 */
export function showMnemonic(mnemonic: string): void {
  const words = mnemonic.split(' ');
  const halfLength = Math.ceil(words.length / 2);

  console.log('\n' + chalk.yellow('┌' + '─'.repeat(58) + '┐'));
  console.log(chalk.yellow('│') + chalk.bold.yellow(' Recovery Phrase (12 words)'.padEnd(58)) + chalk.yellow('│'));
  console.log(chalk.yellow('├' + '─'.repeat(58) + '┤'));

  for (let i = 0; i < halfLength; i++) {
    const left = `${(i + 1).toString().padStart(2, ' ')}. ${words[i]}`;
    const right = i + halfLength < words.length
      ? `${(i + halfLength + 1).toString().padStart(2, ' ')}. ${words[i + halfLength]}`
      : '';

    const line = `${left.padEnd(28)} ${right}`;
    console.log(chalk.yellow('│') + ' ' + chalk.white(line.padEnd(57)) + chalk.yellow('│'));
  }

  console.log(chalk.yellow('└' + '─'.repeat(58) + '┘') + '\n');

  console.log(chalk.red.bold('⚠  SECURITY WARNING'));
  console.log(chalk.white('  • Never share this phrase with anyone'));
  console.log(chalk.white('  • Anyone with this phrase can access your funds'));
  console.log(chalk.white('  • Store it safely offline\n'));
}

// ============================================================================
// Block Explorer Functions
// ============================================================================

/**
 * Generates a block explorer URL for viewing a transaction.
 * Supports multiple EVM networks with their respective explorers.
 * 
 * @param txHash - Transaction hash to link to
 * @param networkKey - Network identifier (e.g., 'mainnet', 'polygon')
 * @returns Full explorer URL or null if network is not supported
 * 
 * @example
 * ```typescript
 * const url = getBlockExplorerUrl('0xabc...', 'mainnet');
 * // Returns: 'https://etherscan.io/tx/0xabc...'
 * 
 * const unknown = getBlockExplorerUrl('0xdef...', 'unknown');
 * // Returns: null
 * ```
 */
export function getBlockExplorerUrl(txHash: string, networkKey: string): string | null {
  const explorers: Record<string, string> = {
    mainnet: `https://etherscan.io/tx/${txHash}`,
    sepolia: `https://sepolia.etherscan.io/tx/${txHash}`,
    goerli: `https://goerli.etherscan.io/tx/${txHash}`,
    polygon: `https://polygonscan.com/tx/${txHash}`,
    mumbai: `https://mumbai.polygonscan.com/tx/${txHash}`,
    bsc: `https://bscscan.com/tx/${txHash}`,
    bscTestnet: `https://testnet.bscscan.com/tx/${txHash}`,
    arbitrum: `https://arbiscan.io/tx/${txHash}`,
    optimism: `https://optimistic.etherscan.io/tx/${txHash}`,
  };

  return explorers[networkKey] || null;
}

/**
 * Displays transaction receipt details with block explorer link.
 * Shows hash, block number, gas used, and explorer URL.
 *
 * @param receipt - Transaction receipt with hash, blockNumber, gasUsed
 * @param networkKey - Network identifier for explorer URL lookup
 *
 * @example
 * ```typescript
 * showTransactionDetails(
 *   { hash: '0xabc...', blockNumber: 12345, gasUsed: 21000n },
 *   'mainnet'
 * );
 * ```
 */
export function showTransactionDetails(receipt: TransactionReceipt, networkKey: string): void {
  showSeparator();
  console.log(chalk.gray('Hash:      ') + formatTxHash(receipt.hash));
  console.log(chalk.gray('Block:     ') + chalk.white(receipt.blockNumber));
  console.log(chalk.gray('Gas Used:  ') + chalk.white(receipt.gasUsed.toString()));

  const explorerUrl = getBlockExplorerUrl(receipt.hash, networkKey);
  if (explorerUrl) {
    console.log(chalk.gray('Explorer:  ') + chalk.blue.underline(explorerUrl));
  }

  showSeparator();
}

/**
 * Transaction confirmation display parameters.
 */
interface TransactionConfirmationParams {
  /** Token symbol being sent */
  tokenSymbol: string;
  /** Amount being sent */
  amount: string;
  /** Recipient address */
  recipient: string;
  /** Network name */
  networkName: string;
  /** USD value of the amount (null if unavailable) */
  amountUsd: number | null;
  /** Gas cost in native token */
  gasCostNative: string;
  /** Native token symbol */
  nativeSymbol: string;
  /** USD value of gas cost (null if unavailable) */
  gasCostUsd: number | null;
  /** Total USD cost (null if unavailable) */
  totalUsd: number | null;
  /** Whether gas estimation failed */
  gasEstimateFailed?: boolean;
}

/**
 * Displays a transaction confirmation screen with detailed cost breakdown.
 * Shows amount, recipient, network, gas fees, and total cost in USD.
 *
 * @param params - Transaction confirmation parameters
 *
 * @example
 * ```typescript
 * showTransactionConfirmation({
 *   tokenSymbol: 'ETH',
 *   amount: '0.1',
 *   recipient: '0x742d35Cc...',
 *   networkName: 'Ethereum Mainnet',
 *   amountUsd: 250,
 *   gasCostNative: '0.002',
 *   nativeSymbol: 'ETH',
 *   gasCostUsd: 5,
 *   totalUsd: 255
 * });
 * ```
 */
export function showTransactionConfirmation(params: TransactionConfirmationParams): void {
  const {
    tokenSymbol,
    amount,
    recipient,
    networkName,
    amountUsd,
    gasCostNative,
    nativeSymbol,
    gasCostUsd,
    totalUsd,
    gasEstimateFailed
  } = params;

  console.log('\n' + chalk.cyan('═'.repeat(50)));
  console.log(chalk.cyan.bold('        Confirm Transaction'));
  console.log(chalk.cyan('═'.repeat(50)) + '\n');

  // Amount
  console.log(chalk.gray('Amount:              ') + chalk.green.bold(`${amount} ${tokenSymbol}`));
  if (amountUsd !== null) {
    console.log(chalk.gray('                     ') + formatUsdPrice(amountUsd));
  }
  console.log('');

  // Recipient
  const shortRecipient = `${recipient.substring(0, 10)}...${recipient.substring(recipient.length - 8)}`;
  console.log(chalk.gray('To:                  ') + chalk.cyan(shortRecipient));
  console.log('');

  // Network
  console.log(chalk.gray('Network:             ') + chalk.white(networkName));
  console.log('');

  // Gas Fee
  console.log(chalk.gray('─'.repeat(50)));
  if (gasEstimateFailed) {
    console.log(chalk.gray('Estimated Network Fee:'));
    console.log(chalk.gray('                     ') + chalk.yellow('Unable to estimate'));
  } else {
    console.log(chalk.gray('Estimated Network Fee:'));
    const formattedGas = parseFloat(gasCostNative).toFixed(6);
    console.log(chalk.gray('                     ') + chalk.white(`${formattedGas} ${nativeSymbol}`));
    if (gasCostUsd !== null) {
      console.log(chalk.gray('                     ') + formatUsdPrice(gasCostUsd));
    }
  }
  console.log(chalk.gray('─'.repeat(50)));

  // Total
  if (totalUsd !== null) {
    console.log(chalk.gray('Total Cost:          ') + chalk.yellow.bold(formatUsdPrice(totalUsd).replace(/\x1b\[[0-9;]*m/g, '')));
  }

  console.log(chalk.cyan('═'.repeat(50)) + '\n');
}

/**
 * Displays the total portfolio value.
 *
 * @param totalUsd - Total portfolio value in USD
 */
export function showPortfolioTotal(totalUsd: number): void {
  console.log('');
  showSeparator();
  console.log(chalk.white.bold('Total Portfolio Value: ') + formatUsdPrice(totalUsd));
  showSeparator();
}

// ============================================================================
// Default Export (all functions as object)
// ============================================================================

/**
 * Default export containing all UI helper functions.
 * Allows importing all functions as a single module.
 * 
 * @example
 * ```typescript
 * import ui from './ui-helpers.js';
 * 
 * ui.showHeader('my-wallet');
 * ui.showSuccess('Done!');
 * ```
 */
export default {
  showHeader,
  showSection,
  showSeparator,
  showBox,
  showSuccess,
  showError,
  showWarning,
  showInfo,
  showLoading,
  formatAddress,
  formatAmount,
  formatUsdPrice,
  formatBalanceWithUsd,
  formatTxHash,
  showAccountInfo,
  menuSeparator,
  menuChoice,
  clearScreen,
  showMnemonic,
  getBlockExplorerUrl,
  showTransactionDetails,
  showTransactionConfirmation,
  showPortfolioTotal
};
