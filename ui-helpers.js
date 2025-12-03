import chalk from 'chalk';

// UI Helper Functions for Consistent Formatting

/**
 * Display a header with context information
 */
export function showHeader(walletName = null, accountIndex = null, networkName = null, address = null) {
  console.log('\n' + chalk.cyan('═'.repeat(60)));
  console.log(chalk.cyan.bold('  Simple Crypto Wallet'));

  if (walletName || accountIndex !== null || networkName) {
    const parts = [];
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
 * Display a section header
 */
export function showSection(title) {
  console.log(chalk.bold.white(title.toUpperCase()));
}

/**
 * Display a separator
 */
export function showSeparator() {
  console.log(chalk.gray('─'.repeat(60)));
}

/**
 * Display a box around important information
 */
export function showBox(title, content, type = 'info') {
  const colors = {
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
 * Success message
 */
export function showSuccess(message) {
  console.log(chalk.green('✓') + ' ' + chalk.white(message));
}

/**
 * Error message with optional suggestions
 */
export function showError(message, suggestions = []) {
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
 * Warning message
 */
export function showWarning(message) {
  console.log(chalk.yellow('⚠') + ' ' + chalk.white(message));
}

/**
 * Info message
 */
export function showInfo(message) {
  console.log(chalk.blue('ℹ') + ' ' + chalk.white(message));
}

/**
 * Loading message
 */
export function showLoading(message) {
  console.log(chalk.cyan('⏳') + ' ' + chalk.white(message));
}

/**
 * Format an Ethereum address for display
 */
export function formatAddress(address) {
  if (!address) return '';
  return chalk.cyan(address.toLowerCase());
}

/**
 * Format ETH amount for display
 */
export function formatAmount(amount, currency = 'ETH') {
  return chalk.green.bold(amount) + ' ' + chalk.gray(currency);
}

/**
 * Format a transaction hash
 */
export function formatTxHash(hash) {
  if (!hash) return '';
  return chalk.magenta(hash);
}

/**
 * Display account information in a clean format
 */
export function showAccountInfo(address, balance = null) {
  console.log('\n' + chalk.gray('━'.repeat(60)));
  console.log(chalk.white.bold('Account Information'));
  console.log(chalk.gray('━'.repeat(60)));
  console.log(chalk.gray('Address:  ') + formatAddress(address));
  if (balance !== null) {
    console.log(chalk.gray('Balance:  ') + formatAmount(balance));
  }
  console.log(chalk.gray('━'.repeat(60)) + '\n');
}

/**
 * Create a menu separator for inquirer choices
 */
export function menuSeparator(label = '') {
  return {
    type: 'separator',
    line: chalk.gray('─'.repeat(60))
  };
}

/**
 * Format menu choice with description
 */
export function menuChoice(name, description = '', value = null) {
  const displayName = description
    ? `${chalk.white(name.padEnd(30))} ${chalk.gray(description)}`
    : chalk.white(name);

  return {
    name: displayName,
    value: value || name
  };
}

/**
 * Clear screen helper
 */
export function clearScreen() {
  console.clear();
}

/**
 * Display mnemonic in a secure box
 */
export function showMnemonic(mnemonic) {
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

/**
 * Get block explorer URL for a transaction
 */
export function getBlockExplorerUrl(txHash, networkKey) {
  const explorers = {
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
 * Display transaction details with block explorer link
 */
export function showTransactionDetails(receipt, networkKey) {
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
  formatTxHash,
  showAccountInfo,
  menuSeparator,
  menuChoice,
  clearScreen,
  showMnemonic,
  getBlockExplorerUrl,
  showTransactionDetails
};
