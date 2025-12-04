import inquirer from 'inquirer';
import { Wallet } from './wallet.js';
import fs from 'fs';
import qrcode from 'qrcode-terminal';
import { ethers } from 'ethers';
import chalk from 'chalk';
import { validatePasswordLength, hasExistingWallets, needsMigration, encryptMnemonic, validateMnemonic } from './crypto-utils.js';
import * as ui from './ui-helpers.js';
import type { Config, Token, TokenRegistry, TokenMetadata } from './types/index.js';

// Load and type config
const configData = JSON.parse(fs.readFileSync('config.json', 'utf8')) as Config & { network: string };
const config: Config & { network: string } = configData;
const wallet = new Wallet(config);

// Token registry (built-in + user-added)
const TOKEN_LIST_PATH = 'tokens.json';
const CUSTOM_TOKENS_PATH = 'tokens-user.json';

const builtInTokens: TokenRegistry = safeReadJSON(TOKEN_LIST_PATH, {});
let customTokens: TokenRegistry = safeReadJSON(CUSTOM_TOKENS_PATH, {});

// Global password cache (in-memory only)
let masterPassword: string | null = null;
let currentWalletName: string | null = null;

function safeReadJSON<T>(path: string, fallback: T): T {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, 'utf8')) as T;
  } catch (error) {
    return fallback;
  }
}

function saveCustomTokens(): void {
  fs.writeFileSync(CUSTOM_TOKENS_PATH, JSON.stringify(customTokens, null, 2));
}

function getNativeToken(networkKey: string): Token {
  const networkConfig = config.networks[networkKey] || {};
  const symbol = networkConfig.nativeSymbol || 'ETH';
  const name = networkConfig.nativeName || networkConfig.name || 'Ether';
  return {
    symbol,
    type: 'native',
    decimals: 18,
    name,
    address: ''
  };
}

function getTokensForNetwork(networkKey: string): Token[] {
  const tokens: Token[] = [];
  const nativeToken = getNativeToken(networkKey);

  // Always include native token first
  tokens.push(nativeToken);

  const seenAddresses = new Set<string>();
  const appendToken = (token: Token): void => {
    if (token.type === 'native') {
      return;
    }
    if (!token.address) {
      return;
    }
    const key = token.address.toLowerCase();
    if (seenAddresses.has(key)) {
      return;
    }
    seenAddresses.add(key);
    tokens.push({
      ...token,
      address: token.address.toLowerCase()
    });
  };

  (builtInTokens[networkKey] || []).forEach(appendToken);
  (customTokens[networkKey] || []).forEach(appendToken);

  return tokens;
}

function upsertCustomToken(networkKey: string, token: Token): void {
  if (!customTokens[networkKey]) {
    customTokens[networkKey] = [];
  }

  const existingIndex = customTokens[networkKey].findIndex(t => t.address?.toLowerCase() === token.address.toLowerCase());
  if (existingIndex >= 0) {
    customTokens[networkKey][existingIndex] = { ...customTokens[networkKey][existingIndex], ...token };
  } else {
    customTokens[networkKey].push({ ...token, address: token.address.toLowerCase() });
  }

  saveCustomTokens();
}

function deleteCustomToken(networkKey: string, address: string): void {
  if (!customTokens[networkKey]) return;
  customTokens[networkKey] = customTokens[networkKey].filter(t => t.address.toLowerCase() !== address.toLowerCase());
  saveCustomTokens();
}

function findTokenBySymbol(networkKey: string, symbol: string): Token | undefined {
  const tokens = getTokensForNetwork(networkKey);
  return tokens.find(t => t.symbol.toLowerCase() === symbol.toLowerCase());
}

async function main(): Promise<void> {
  ui.clearScreen();
  ui.showHeader(null, null, config.networks[config.network].name);

  await wallet.initialize();

  // Check if migration is needed
  if (needsMigration()) {
    await migrateExistingWallets();
  }

  const existingWallets = wallet.getAllWallets();
  const walletNames = Object.keys(existingWallets);

  if (walletNames.length > 0) {
    await selectWalletMenu(existingWallets);
  } else {
    await initialMenu();
  }
}

// Password management functions
async function promptMasterPasswordSetup(): Promise<string> {
  console.log('\n═══════════════════════════════════════');
  console.log('    🔐 Master Password Setup');
  console.log('═══════════════════════════════════════');
  console.log('\nThis password will encrypt ALL your wallets.');
  console.log('⚠️  You CANNOT recover your password if you forget it!');
  console.log('Minimum 8 characters required.\n');

  while (true) {
    const { password } = await inquirer.prompt<{ password: string }>([
      {
        type: 'password',
        name: 'password',
        message: 'Create master password:',
        mask: '*'
      }
    ]);

    if (!validatePasswordLength(password)) {
      console.log('\n❌ Password must be at least 8 characters\n');
      continue;
    }

    const { confirm } = await inquirer.prompt<{ confirm: string }>([
      {
        type: 'password',
        name: 'confirm',
        message: 'Confirm master password:',
        mask: '*'
      }
    ]);

    if (password !== confirm) {
      console.log('\n❌ Passwords do not match. Please try again.\n');
      continue;
    }

    masterPassword = password;
    console.log('\n✅ Master password set successfully!\n');
    return password;
  }
}

async function promptMasterPassword(): Promise<string> {
  const { password } = await inquirer.prompt<{ password: string }>([
    {
      type: 'password',
      name: 'password',
      message: 'Enter master password:',
      mask: '*'
    }
  ]);

  return password;
}

async function ensureMasterPassword(): Promise<string> {
  if (!masterPassword) {
    masterPassword = await promptMasterPassword();
  }
  return masterPassword;
}

async function migrateExistingWallets(): Promise<void> {
  console.log('\n⚠️  MIGRATION REQUIRED\n');
  console.log('Your wallets are stored in plaintext format.');
  console.log('For security, they need to be encrypted with a password.\n');

  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    {
      type: 'confirm',
      name: 'proceed',
      message: 'Proceed with migration?',
      default: true
    }
  ]);

  if (!proceed) {
    console.log('\n❌ Migration cancelled. Exiting for security.\n');
    process.exit(0);
  }

  try {
    // Set up master password
    const password = await promptMasterPasswordSetup();

    // Read existing wallets
    const data = fs.readFileSync('./wallets.json', 'utf8');
    const wallets: Record<string, any> = JSON.parse(data);

    // Backup original file
    fs.writeFileSync('./wallets.json.backup', data);
    console.log('✅ Backup created: wallets.json.backup\n');

    // Migrate each wallet
    let migratedCount = 0;
    for (const [name, walletData] of Object.entries(wallets)) {
      if (walletData.mnemonic && !walletData.encryptedMnemonic) {
        console.log(`Encrypting wallet: ${name}...`);

        const { encrypted, salt } = encryptMnemonic(walletData.mnemonic, password);

        wallets[name].encryptedMnemonic = encrypted;
        wallets[name].salt = salt;
        delete wallets[name].mnemonic; // Remove plaintext

        migratedCount++;
      }
    }

    // Save encrypted wallets
    fs.writeFileSync('./wallets.json', JSON.stringify(wallets, null, 2));

    console.log(`\n✅ Successfully encrypted ${migratedCount} wallet(s)!`);
    console.log('Original backup: wallets.json.backup\n');

  } catch (error) {
    const err = error as Error;
    console.log(`\n❌ Migration error: ${err.message}\n`);
    process.exit(1);
  }
}

async function selectWalletMenu(existingWallets: Record<string, any>): Promise<void> {
  ui.clearScreen();
  ui.showHeader();

  ui.showSection('Select Wallet');
  console.log('');

  const walletChoices = Object.keys(existingWallets).map(name => {
    const walletData = existingWallets[name];

    // Get primary address from accounts (already saved)
    let primaryAddress = 'No accounts';
    if (walletData.accounts && walletData.accounts[0]) {
      primaryAddress = walletData.accounts[0].address.substring(0, 12) + '...';
    }

    const accountCount = walletData.accounts ? Object.keys(walletData.accounts).length : 1;

    return ui.menuChoice(
      name,
      `${primaryAddress} (${accountCount} account${accountCount !== 1 ? 's' : ''})`,
      name
    );
  });

  walletChoices.push(new inquirer.Separator() as any);
  walletChoices.push(ui.menuChoice('Add New Wallet', '', 'add_new'));
  walletChoices.push(ui.menuChoice('Exit', '', 'exit'));

  const { selectedWallet } = await inquirer.prompt<{ selectedWallet: string }>([
    {
      type: 'list',
      name: 'selectedWallet',
      message: 'Select a wallet:',
      loop: false,
      pageSize: 25,
      choices: walletChoices
    }
  ]);

  if (selectedWallet === 'add_new') {
    await initialMenu();
  } else if (selectedWallet === 'exit') {
    ui.showSuccess('Goodbye!');
    process.exit(0);
  } else {
    // Load wallet with password
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        const password = await ensureMasterPassword();
        const walletData = wallet.loadWallet(selectedWallet, password);
        if (walletData) {
          ui.showSuccess(`Loaded wallet: ${walletData.address}`);
          await mainMenu(selectedWallet);
          return;
        }
      } catch (error) {
        attempts++;
        ui.showError(`Incorrect password (${attempts}/${maxAttempts})`, []);
        masterPassword = null; // Clear cached password

        if (attempts >= maxAttempts) {
          ui.showWarning('Too many failed attempts. Returning to menu.');
          await selectWalletMenu(existingWallets);
          return;
        }
      }
    }
  }
}

async function initialMenu(): Promise<void> {
  ui.showInfo('No wallet loaded. Create a new wallet or import an existing one.');
  console.log('');

  const { action } = await inquirer.prompt<{ action: string }>([
    {
      type: 'list',
      name: 'action',
      message: 'Select an action:',
      choices: [
        ui.menuChoice('Create New Wallet', 'Generate a new wallet', 'create'),
        ui.menuChoice('Import Existing Wallet', 'Restore from recovery phrase', 'import'),
        ui.menuChoice('Import from Backup', 'Restore from backup file', 'import_backup'),
        new inquirer.Separator(''),
        ui.menuChoice('Change Network', 'Switch between networks', 'network'),
        ui.menuChoice('Back to Wallet Selection', '', 'back'),
        ui.menuChoice('Exit', '', 'exit')
      ]
    }
  ]);

  switch (action) {
    case 'create':
      await createWallet();
      break;
    case 'import':
      await importWallet();
      break;
    case 'import_backup':
      await importWalletFromBackup();
      break;
    case 'network':
      await changeNetwork();
      break;
    case 'back':
      const existingWallets = wallet.getAllWallets();
      if (Object.keys(existingWallets).length > 0) {
        await selectWalletMenu(existingWallets);
      } else {
        console.log('\n⚠️  No saved wallets found\n');
        await initialMenu();
      }
      break;
    case 'exit':
      console.log('Goodbye!');
      process.exit(0);
  }
}

async function createWallet(): Promise<void> {
  ui.clearScreen();
  ui.showHeader();
  ui.showLoading('Creating new wallet...');

  // Check if first-time setup
  const isFirstWallet = !hasExistingWallets();

  // Get password (setup or use cached)
  let password: string;
  if (isFirstWallet) {
    password = await promptMasterPasswordSetup();
  } else {
    password = await ensureMasterPassword();
  }

  const walletData = wallet.createNewWallet(password);

  ui.clearScreen();
  ui.showHeader();
  ui.showSuccess('Wallet created successfully!');
  console.log('');

  ui.showAccountInfo(walletData.address);
  ui.showMnemonic(walletData.mnemonic);

  const answers = await inquirer.prompt<{ save: boolean; walletName?: string }>([
    {
      type: 'confirm',
      name: 'save',
      message: 'Save wallet to file?',
      default: true
    },
    {
      type: 'input',
      name: 'walletName',
      message: 'Enter a name for this wallet:',
      default: `Wallet_${walletData.address.substring(2, 8)}`,
      when: (answers) => answers.save,
      validate: (input) => {
        if (!input || input.trim().length === 0) {
          return 'Wallet name cannot be empty';
        }
        const existingWallets = wallet.getAllWallets();
        if (existingWallets[input.trim()]) {
          return 'A wallet with this name already exists';
        }
        return true;
      }
    }
  ]);

  let savedWalletName: string | null = null;
  if (answers.save && answers.walletName) {
    savedWalletName = wallet.saveWallet(answers.walletName.trim());
  }

  await mainMenu(savedWalletName);
}

async function importWallet(): Promise<void> {
  console.log('\n📥 Import Wallet\n');

  // Check if first-time setup
  const isFirstWallet = !hasExistingWallets();

  // Get password (setup or use cached)
  let password: string;
  if (isFirstWallet) {
    password = await promptMasterPasswordSetup();
  } else {
    password = await ensureMasterPassword();
  }

  const { mnemonic } = await inquirer.prompt<{ mnemonic: string }>([
    {
      type: 'input',
      name: 'mnemonic',
      message: 'Enter your 12-word mnemonic phrase:',
      validate: (input) => {
        const words = input.trim().split(/\s+/);
        if (words.length !== 12) {
          return 'Please enter exactly 12 words';
        }
        return true;
      }
    }
  ]);

  try {
    const walletData = wallet.importWallet(mnemonic.trim(), password);
    console.log('\n✅ Wallet imported successfully!');
    console.log('📍 Address:', walletData.address, '\n');

    const answers = await inquirer.prompt<{ save: boolean; walletName?: string }>([
      {
        type: 'confirm',
        name: 'save',
        message: 'Save wallet to file?',
        default: true
      },
      {
        type: 'input',
        name: 'walletName',
        message: 'Enter a name for this wallet:',
        default: `Wallet_${walletData.address.substring(2, 8)}`,
        when: (answers) => answers.save,
        validate: (input) => {
          if (!input || input.trim().length === 0) {
            return 'Wallet name cannot be empty';
          }
          const existingWallets = wallet.getAllWallets();
          if (existingWallets[input.trim()]) {
            return 'A wallet with this name already exists';
          }
          return true;
        }
      }
    ]);

    let savedWalletName: string | null = null;
    if (answers.save && answers.walletName) {
      savedWalletName = wallet.saveWallet(answers.walletName.trim());
    }

    await mainMenu(savedWalletName);
  } catch (error) {
    const err = error as Error;
    console.log('\n❌ Error:', err.message, '\n');
    await initialMenu();
  }
}

async function importWalletFromBackup(): Promise<void> {
  ui.clearScreen();
  ui.showHeader();

  ui.showSection('Import from Backup');
  ui.showInfo('Restore a wallet from an encrypted backup file');
  console.log('');

  const { backupPath } = await inquirer.prompt<{ backupPath: string }>([
    {
      type: 'input',
      name: 'backupPath',
      message: 'Backup file path:',
      validate: (input) => {
        if (!input || input.trim().length === 0) {
          return 'Please enter a valid file path';
        }
        if (!fs.existsSync(input)) {
          return 'File does not exist';
        }
        return true;
      }
    }
  ]);

  // Get password for the backup
  const { backupPassword } = await inquirer.prompt<{ backupPassword: string }>([
    {
      type: 'password',
      name: 'backupPassword',
      message: 'Enter password for backup file:',
      mask: '*'
    }
  ]);

  try {
    const importedWalletName = wallet.importFromBackup(backupPath, backupPassword);

    // Set master password if this is first wallet
    const isFirstWallet = Object.keys(wallet.getAllWallets()).length === 1;
    if (isFirstWallet) {
      masterPassword = backupPassword;
    } else {
      // Ensure cached password matches
      if (masterPassword !== backupPassword) {
        ui.showWarning('Backup password differs from master password');
        ui.showInfo('Re-enter your master password to continue using other wallets');
        masterPassword = null;
        await ensureMasterPassword();
      }
    }

    ui.showSuccess(`Wallet imported successfully as: ${importedWalletName}`);

    await inquirer.prompt<{ continue: string }>([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);

    // Load the imported wallet
    const walletData = wallet.loadWallet(importedWalletName, backupPassword);
    if (walletData) {
      await mainMenu(importedWalletName);
    } else {
      await initialMenu();
    }
  } catch (error) {
    const err = error as Error;
    ui.showError(`Import failed: ${err.message}`, [
      'Verify the backup file is valid',
      'Check that the password is correct',
      'Ensure the file has not been corrupted'
    ]);

    await inquirer.prompt<{ continue: string }>([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);

    await initialMenu();
  }
}

async function mainMenu(walletName: string | null): Promise<void> {
  currentWalletName = walletName;
  const currentAddress = wallet.getAddress();
  const accountIndex = wallet.currentAccountIndex;

  ui.clearScreen();
  ui.showHeader(walletName, accountIndex, config.networks[config.network].name, currentAddress);

  const { action } = await inquirer.prompt<{ action: string }>([
    {
      type: 'list',
      name: 'action',
      message: 'Select an action:',
      loop: false,
      pageSize: 25,
      choices: [
        new inquirer.Separator(ui.menuSeparator().line),
        new inquirer.Separator('  ACCOUNT ACTIONS'),
        new inquirer.Separator(ui.menuSeparator().line),
        ui.menuChoice('Check Balance', 'View your current balance', 'balance'),
        ui.menuChoice('Portfolio (All Networks)', 'View balances across networks', 'portfolio_all'),
        ui.menuChoice('Send Transaction', 'Send ETH to another address', 'send'),
        ui.menuChoice('Receive', 'Show your address & QR code', 'receive'),
        new inquirer.Separator(''),
        new inquirer.Separator(ui.menuSeparator().line),
        new inquirer.Separator('  WALLET MANAGEMENT'),
        new inquirer.Separator(ui.menuSeparator().line),
        ui.menuChoice('Manage Accounts', 'Switch or create accounts', 'accounts'),
        ui.menuChoice('Switch Wallet', 'Load a different wallet', 'switch'),
        new inquirer.Separator(''),
        new inquirer.Separator(ui.menuSeparator().line),
        new inquirer.Separator('  ADVANCED'),
        new inquirer.Separator(ui.menuSeparator().line),
        ui.menuChoice('Manage Tokens', 'Add or remove ERC-20 tokens', 'tokens'),
        ui.menuChoice('Show Secrets', 'View private key & mnemonic', 'secrets'),
        ui.menuChoice('Export Wallet', 'Backup wallet to file', 'export'),
        ui.menuChoice('Change Network', 'Switch between networks', 'network'),
        ui.menuChoice('Delete Wallet', 'Remove current wallet', 'delete'),
        new inquirer.Separator(''),
        ui.menuChoice('Exit', '', 'exit')
      ]
    }
  ]);

  switch (action) {
    case 'balance':
      await checkBalance(currentWalletName);
      break;
    case 'portfolio_all':
      await checkPortfolioAllNetworks(currentWalletName);
      break;
    case 'send':
      await sendCrypto(currentWalletName);
      break;
    case 'receive':
      await showReceiveAddress(currentWalletName);
      break;
    case 'accounts':
      await manageAccounts(currentWalletName);
      break;
    case 'secrets':
      await showWalletSecrets(currentWalletName);
      break;
    case 'tokens':
      await manageTokens(currentWalletName);
      break;
    case 'export':
      await exportWallet(currentWalletName);
      break;
    case 'network':
      await changeNetwork();
      break;
    case 'switch':
      await switchWallet();
      break;
    case 'delete':
      await deleteCurrentWallet(currentWalletName);
      break;
    case 'exit':
      console.log('Goodbye!');
      process.exit(0);
  }
}

async function checkBalance(currentWalletName: string | null): Promise<void> {
  const address = wallet.getAddress();
  ui.clearScreen();
  ui.showHeader(currentWalletName, wallet.currentAccountIndex, config.networks[config.network].name, address);

  try {
    ui.showLoading('Fetching balance from blockchain...');
    console.log('');
    const tokens = getTokensForNetwork(config.network);
    const portfolio = await wallet.getPortfolio(tokens);

    ui.showSuccess('Balances retrieved successfully!');
    ui.showSection('Portfolio');
    ui.showSeparator();

    portfolio.forEach(({ token, balance, error }) => {
      const label = `${token.symbol}${token.type === 'native' ? ' (native)' : ''}`.padEnd(18);
      if (error) {
        console.log(`${label} ${chalk.red('Error')} ${chalk.gray(`(${error})`)}`);
      } else {
        console.log(`${label} ${ui.formatAmount(balance, token.symbol)}`);
      }
    });

    ui.showSeparator();

  } catch (error) {
    const err = error as Error;
    ui.showError(
      err.message,
      [
        'Check your internet connection',
        'Verify the network RPC endpoint in config.json',
        'Try switching to a different network'
      ]
    );
  }

  await inquirer.prompt<{ continue: string }>([{
    type: 'input',
    name: 'continue',
    message: 'Press Enter to continue...'
  }]);

  await mainMenu(currentWalletName);
}

async function checkPortfolioAllNetworks(currentWalletName: string | null): Promise<void> {
  const originalNetwork = config.network;
  const address = wallet.getAddress();
  ui.clearScreen();
  ui.showHeader(currentWalletName, wallet.currentAccountIndex, 'All Networks', address);

  const networks = Object.keys(config.networks);
  const results: Array<{
    network: string;
    success: boolean;
    portfolio?: Array<{ token: Token; balance: string; error?: string }>;
    error?: string;
  }> = [];

  for (const net of networks) {
    try {
      // Swap provider context per network to reuse the same wallet/account.
      await wallet.setNetwork(net);
      const tokens = getTokensForNetwork(net);
      const portfolio = await wallet.getPortfolio(tokens);
      results.push({ network: net, success: true, portfolio });
    } catch (error) {
      const err = error as Error;
      results.push({ network: net, success: false, error: err.message });
    }
  }

  // restore original network context
  await wallet.setNetwork(originalNetwork);

  results.forEach(({ network, success, portfolio, error }) => {
    ui.showSection(config.networks[network]?.name || network);
    if (!success) {
      ui.showWarning(`Failed: ${error}`);
      console.log('');
      return;
    }
    ui.showSeparator();
    portfolio?.forEach(({ token, balance, error: tokenError }) => {
      const label = `${token.symbol}${token.type === 'native' ? ' (native)' : ''}`.padEnd(18);
      if (tokenError) {
        console.log(`${label} ${chalk.red('Error')} ${chalk.gray(`(${tokenError})`)}`);
      } else {
        console.log(`${label} ${ui.formatAmount(balance, token.symbol)}`);
      }
    });
    ui.showSeparator();
    console.log('');
  });

  await inquirer.prompt<{ continue: string }>([{
    type: 'input',
    name: 'continue',
    message: 'Press Enter to continue...'
  }]);

  await mainMenu(currentWalletName);
}

async function sendCrypto(currentWalletName: string | null): Promise<void> {
  const address = wallet.getAddress();
  ui.clearScreen();
  ui.showHeader(currentWalletName, wallet.currentAccountIndex, config.networks[config.network].name, address);

  ui.showSection('Send Transaction');
  ui.showInfo('Press Ctrl+C to cancel at any time');
  console.log('');

  const tokens = getTokensForNetwork(config.network);
  const { tokenSymbol } = await inquirer.prompt<{ tokenSymbol: string }>([
    {
      type: 'list',
      name: 'tokenSymbol',
      message: 'Select token to send:',
      loop: false,
      choices: tokens.map(t => ({
        name: `${t.symbol}${t.type === 'native' ? ' (native)' : ''}`,
        value: t.symbol
      }))
    }
  ]);

  const selectedToken = findTokenBySymbol(config.network, tokenSymbol);
  if (!selectedToken) {
    ui.showError('Token not found', []);
    await mainMenu(currentWalletName);
    return;
  }
  const tokenLabel = `${selectedToken.symbol}${selectedToken.type === 'native' ? ' (native)' : ''}`;

  const answers = await inquirer.prompt<{
    toAddress?: string;
    amount?: string;
    confirm?: boolean;
  }>([
    {
      type: 'input',
      name: 'toAddress',
      message: 'Recipient address (or leave empty to cancel):',
      validate: (input) => {
        if (!input || input.trim() === '') {
          return true; // Allow empty to cancel
        }
        if (!input.startsWith('0x') || input.length !== 42) {
          return 'Please enter a valid Ethereum address';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'amount',
      message: `Amount (in ${selectedToken.symbol}):`,
      when: (answers) => answers.toAddress && answers.toAddress.trim() !== '',
      validate: (input) => {
        if (!input || input.trim() === '') {
          return true; // Allow empty to cancel
        }
        const num = parseFloat(input);
        if (isNaN(num) || num <= 0) {
          return 'Please enter a valid amount';
        }
        return true;
      }
    },
    {
      type: 'confirm',
      name: 'confirm',
      message: (answers) => `Send ${answers.amount} ${selectedToken.symbol} to ${answers.toAddress}?`,
      when: (answers) => answers.toAddress && answers.toAddress.trim() !== '' && answers.amount && answers.amount.trim() !== '',
      default: false
    }
  ]);

  // Check if user cancelled
  if (!answers.toAddress || answers.toAddress.trim() === '' ||
      !answers.amount || answers.amount.trim() === '' ||
      !answers.confirm) {
    ui.showWarning('Transaction cancelled');
    await mainMenu(currentWalletName);
    return;
  }

  try {
    ui.showLoading('Sending transaction to the network...');
    const receipt = await wallet.sendToken(selectedToken, answers.toAddress, answers.amount);

    ui.showSuccess('Transaction confirmed!');
    console.log('');
    ui.showTransactionDetails(receipt, config.network);
    console.log('');

    await inquirer.prompt<{ continue: string }>([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);
  } catch (error) {
    const err = error as Error;
    ui.showError(`Transaction failed: ${err.message}`, [
      'Verify you have sufficient balance for the transaction and gas fees',
      'Check that the recipient address is valid',
      'Ensure your network connection is stable'
    ]);

    await inquirer.prompt<{ continue: string }>([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);
  }

  await mainMenu(currentWalletName);
}

async function showReceiveAddress(currentWalletName: string | null): Promise<void> {
  const address = wallet.getAddress();
  ui.clearScreen();
  ui.showHeader(currentWalletName, wallet.currentAccountIndex, config.networks[config.network].name, address);

  ui.showSection('Receive Crypto');
  const tokens = getTokensForNetwork(config.network);
  const tokenSymbols = tokens.map(t => t.symbol).join(', ');

  ui.showInfo(`Share this address to receive: ${tokenSymbols}`);
  console.log('');

  ui.showSeparator();
  console.log(ui.formatAddress(address));
  ui.showSeparator();

  console.log('\n' + chalk.white.bold('Scan QR Code:\n'));
  qrcode.generate(address, { small: true });
  console.log('');

  await inquirer.prompt<{ continue: string }>([{
    type: 'input',
    name: 'continue',
    message: 'Press Enter to continue...'
  }]);

  await mainMenu(currentWalletName);
}

async function showWalletSecrets(currentWalletName: string | null): Promise<void> {
  const address = wallet.getAddress();
  ui.clearScreen();
  ui.showHeader(currentWalletName, wallet.currentAccountIndex, config.networks[config.network].name, address);

  ui.showWarning('This will display sensitive information');
  ui.showWarning('Make sure no one is watching your screen');

  // Require password re-entry for security
  const password = await promptMasterPassword();

  try {
    const privateKey = wallet.getPrivateKey(password);
    const mnemonic = wallet.getMnemonic(password);

    ui.clearScreen();
    ui.showHeader(currentWalletName, wallet.currentAccountIndex, config.networks[config.network].name, address);

    console.log(chalk.red.bold('⚠  KEEP THIS INFORMATION SECRET AND SECURE!\n'));

    ui.showSeparator();
    console.log(chalk.gray('Wallet:       ') + chalk.white(currentWalletName || 'Unknown'));
    console.log(chalk.gray('Address:      ') + ui.formatAddress(address));
    console.log(chalk.gray('Private Key:  ') + ui.formatTxHash(privateKey));
    ui.showSeparator();

    console.log('');
    ui.showMnemonic(mnemonic);

    console.log(chalk.red.bold('⚠  SECURITY REMINDERS'));
    console.log(chalk.white('  • Never share your private key or secret phrase with anyone'));
    console.log(chalk.white('  • Anyone with these can access your funds'));
    console.log(chalk.white('  • Store them securely offline'));
    console.log(chalk.white('  • Clear your terminal history if needed\n'));

    const { whatNext } = await inquirer.prompt<{ whatNext: string }>([
      {
        type: 'list',
        name: 'whatNext',
        message: 'What would you like to do?',
        loop: false,
        choices: [
          ui.menuChoice('Back to Main Menu', '', 'back'),
          ui.menuChoice('Exit (Clear Screen)', '', 'exit')
        ]
      }
    ]);

    if (whatNext === 'exit') {
      ui.clearScreen();
      ui.showSuccess('Screen cleared. Goodbye!');
      process.exit(0);
    } else {
      await mainMenu(currentWalletName);
    }
  } catch (error) {
    const err = error as Error;
    ui.showError(`Error retrieving wallet secrets: ${err.message}`, [
      'Verify your password is correct',
      'Ensure the wallet is properly loaded'
    ]);
    await inquirer.prompt<{ continue: string }>([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);
    await mainMenu(currentWalletName);
  }
}

async function exportWallet(currentWalletName: string | null): Promise<void> {
  const address = wallet.getAddress();
  ui.clearScreen();
  ui.showHeader(currentWalletName, wallet.currentAccountIndex, config.networks[config.network].name, address);

  ui.showSection('Export Wallet');
  ui.showInfo('Create an encrypted backup of your wallet');
  console.log('');

  const { exportPath } = await inquirer.prompt<{ exportPath: string }>([
    {
      type: 'input',
      name: 'exportPath',
      message: 'Export file path:',
      default: `./backup-${currentWalletName}-${Date.now()}.json`,
      validate: (input) => {
        if (!input || input.trim().length === 0) {
          return 'Please enter a valid file path';
        }
        if (fs.existsSync(input)) {
          return 'File already exists. Choose a different path.';
        }
        return true;
      }
    }
  ]);

  try {
    if (!currentWalletName) {
      throw new Error('No wallet name specified');
    }
    wallet.exportWallet(currentWalletName, exportPath);
    ui.showSuccess(`Wallet exported successfully to: ${exportPath}`);
    ui.showWarning('Keep this backup file secure!');
    ui.showInfo('This file contains your encrypted wallet and can be imported later');
  } catch (error) {
    const err = error as Error;
    ui.showError(`Export failed: ${err.message}`, [
      'Check that you have write permissions for the destination',
      'Ensure the wallet is properly loaded'
    ]);
  }

  await inquirer.prompt<{ continue: string }>([{
    type: 'input',
    name: 'continue',
    message: 'Press Enter to continue...'
  }]);

  await mainMenu(currentWalletName);
}

async function manageTokens(currentWalletName: string | null): Promise<void> {
  const networkKey = config.network;
  const tokens = getTokensForNetwork(networkKey);

  ui.clearScreen();
  ui.showHeader(currentWalletName, wallet.currentAccountIndex, config.networks[networkKey].name, wallet.getAddress());

  ui.showSection('Manage Tokens');
  ui.showInfo(`Network: ${config.networks[networkKey].name}`);
  console.log('');

  tokens.forEach(token => {
    const source = (customTokens[networkKey] || []).some(t => t.address?.toLowerCase() === token.address?.toLowerCase()) ? 'custom' : 'built-in';
    const label = token.type === 'native' ? 'native' : `${token.address}`;
    console.log(`- ${token.symbol.padEnd(6)} ${chalk.gray(label)} ${chalk.gray(`(${source})`)}`);
  });

  console.log('');

  const choices = [
    ui.menuChoice('Add Custom Token', 'Provide ERC-20 address', 'add'),
    ui.menuChoice('Remove Custom Token', 'Delete a token you added', 'remove',)
  ];

  choices.push(ui.menuChoice('Back to Main Menu', '', 'back'));

  const { action } = await inquirer.prompt<{ action: string }>([
    {
      type: 'list',
      name: 'action',
      message: 'Select an action:',
      choices
    }
  ]);

  if (action === 'add') {
    await addCustomToken(networkKey);
    await manageTokens(currentWalletName);
    return;
  }

  if (action === 'remove') {
    await removeCustomToken(networkKey);
    await manageTokens(currentWalletName);
    return;
  }

  await mainMenu(currentWalletName);
}

async function addCustomToken(networkKey: string): Promise<void> {
  const { address } = await inquirer.prompt<{ address: string }>([
    {
      type: 'input',
      name: 'address',
      message: 'Token contract address:',
      validate: (input) => {
        if (!input || !input.startsWith('0x') || input.length !== 42) {
          return 'Enter a valid contract address (0x...)';
        }
        return true;
      }
    }
  ]);

  let checksummed: string;
  try {
    checksummed = ethers.getAddress(address);
  } catch (e) {
    ui.showError('Invalid address format', []);
    return;
  }

  let metadata: TokenMetadata | null = null;
  try {
    ui.showLoading('Fetching token metadata from chain...');
    metadata = await wallet.getTokenMetadata(checksummed);
    ui.showSuccess(`Detected token ${metadata.symbol} (${metadata.decimals} decimals)`);
  } catch (error) {
    const err = error as Error;
    ui.showWarning(`Auto-detect failed: ${err.message}`);
  }

  if (!metadata) {
    const manualMetadata = await inquirer.prompt<{
      symbol: string;
      decimals: string;
      name: string;
    }>([
      {
        type: 'input',
        name: 'symbol',
        message: 'Token symbol:',
        validate: (input) => input && input.trim().length > 0 ? true : 'Symbol is required'
      },
      {
        type: 'input',
        name: 'decimals',
        message: 'Token decimals:',
        validate: (input) => {
          const num = Number(input);
          if (Number.isInteger(num) && num >= 0 && num <= 36) {
            return true;
          }
          return 'Enter a whole number between 0 and 36';
        }
      },
      {
        type: 'input',
        name: 'name',
        message: 'Token name (optional):',
        default: ''
      }
    ]);
    metadata = {
      symbol: manualMetadata.symbol,
      decimals: Number(manualMetadata.decimals),
      name: manualMetadata.name
    };
  }

  const tokenToAdd: Token = {
    address: checksummed,
    symbol: metadata.symbol,
    decimals: metadata.decimals,
    name: metadata.name,
    type: 'erc20'
  };

  upsertCustomToken(networkKey, tokenToAdd);
  ui.showSuccess(`Added ${metadata.symbol} to ${config.networks[networkKey].name}`);
}

async function removeCustomToken(networkKey: string): Promise<void> {
  const custom = customTokens[networkKey] || [];
  if (custom.length === 0) {
    ui.showWarning('No custom tokens to remove for this network.');
    return;
  }

  const { address } = await inquirer.prompt<{ address: string }>([
    {
      type: 'list',
      name: 'address',
      message: 'Select a token to remove:',
      choices: custom.map(t => ({ name: `${t.symbol} - ${t.address}`, value: t.address }))
    }
  ]);

  deleteCustomToken(networkKey, address);
  ui.showSuccess('Token removed.');
}

async function manageAccounts(currentWalletName: string | null): Promise<void> {
  console.log('\n👤 Manage Accounts\n');

  if (!currentWalletName) {
    console.log('\n⚠️  No wallet name specified\n');
    await mainMenu(currentWalletName);
    return;
  }

  const savedAccounts = wallet.getWalletAccounts(currentWalletName);
  const accountChoices: Array<{ name: string; value: { action: string; index?: number } }> = [];

  // Get all account indices and sort them
  const accountIndices = Object.keys(savedAccounts).map(idx => parseInt(idx)).sort((a, b) => a - b);

  // Ensure Account 1 (index 0) always exists
  if (!accountIndices.includes(0)) {
    accountIndices.unshift(0);
  }

  // Show all accounts in sequence
  accountIndices.forEach(index => {
    let address: string;
    if (savedAccounts[index]) {
      address = savedAccounts[index].address;
    } else {
      // Derive the address for accounts that haven't been saved yet
      address = wallet.getAccountAddress(index);
    }

    const isCurrent = index === wallet.currentAccountIndex;
    accountChoices.push({
      name: `${isCurrent ? '• ' : '  '}Account ${index + 1} - ${address}`,
      value: { action: 'switch', index: index }
    });
  });

  accountChoices.push({ name: '➕ Create New Account', value: { action: 'create' } });
  accountChoices.push({ name: '🔙 Back to Main Menu', value: { action: 'back' } });

  const { selected } = await inquirer.prompt<{
    selected: { action: string; index?: number }
  }>([
    {
      type: 'list',
      name: 'selected',
      message: 'Select an account or action:',
      choices: accountChoices
    }
  ]);

  if (selected.action === 'back') {
    await mainMenu(currentWalletName);
  } else if (selected.action === 'create') {
    try {
      // Find the highest account index and create the next one
      const maxIndex = accountIndices.length > 0 ? Math.max(...accountIndices) : -1;
      const newIndex = maxIndex + 1;

      const newAccount = wallet.switchAccount(newIndex);
      console.log(`\n✅ Created Account ${newIndex + 1}`);
      console.log(`📍 Address: ${newAccount.address}\n`);

      wallet.saveWallet(currentWalletName);
      await mainMenu(currentWalletName);
    } catch (error) {
      const err = error as Error;
      console.log(`\n❌ Error creating account: ${err.message}\n`);
      await manageAccounts(currentWalletName);
    }
  } else if (selected.action === 'switch' && selected.index !== undefined) {
    if (selected.index !== wallet.currentAccountIndex) {
      const switchedAccount = wallet.switchAccount(selected.index);
      console.log(`\n✅ Switched to Account ${selected.index + 1}`);
      console.log(`📍 Address: ${switchedAccount.address}\n`);

      wallet.saveWallet(currentWalletName);
    }
    await mainMenu(currentWalletName);
  }
}

async function changeNetwork(): Promise<void> {
  console.log('\n⚙️  Change Network\n');

  const { network } = await inquirer.prompt<{ network: string }>([
    {
      type: 'list',
      name: 'network',
      message: 'Select network:',
      choices: Object.keys(config.networks).map(key => ({
        name: config.networks[key].name,
        value: key
      }))
    }
  ]);

  config.network = network;
  if (process.env.NODE_ENV !== 'test') {
    fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
  }

  try {
    await wallet.setNetwork(network);
    console.log(`\n✅ Network changed to ${config.networks[network].name}`);
  } catch (error) {
    const err = error as Error;
    ui.showError(`Failed to switch network: ${err.message}`);
  }

  await inquirer.prompt<{ continue: string }>([{
    type: 'input',
    name: 'continue',
    message: 'Press Enter to continue...'
  }]);

  if (process.env.NODE_ENV === 'test') {
    return;
  }

  // Return to appropriate menu based on wallet load state
  const loadedWallets = wallet.getAllWallets();
  if (currentWalletName && loadedWallets[currentWalletName]) {
    await mainMenu(currentWalletName);
  } else if (Object.keys(loadedWallets).length > 0) {
    await selectWalletMenu(loadedWallets);
  } else {
    await initialMenu();
  }
}

async function switchWallet(): Promise<void> {
  const existingWallets = wallet.getAllWallets();

  if (Object.keys(existingWallets).length > 0) {
    await selectWalletMenu(existingWallets);
  } else {
    console.log('\n⚠️  No other wallets found\n');
    await initialMenu();
  }
}

async function deleteCurrentWallet(currentWalletName: string | null): Promise<void> {
  if (!currentWalletName) {
    console.log('\n⚠️  No wallet name specified\n');
    await mainMenu(currentWalletName);
    return;
  }

  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to delete wallet "${currentWalletName}"? This cannot be undone!`,
      default: false
    }
  ]);

  if (confirm) {
    const success = wallet.deleteWallet(currentWalletName);
    if (success) {
      console.log(`\n✅ Wallet "${currentWalletName}" deleted successfully\n`);

      const existingWallets = wallet.getAllWallets();
      if (Object.keys(existingWallets).length > 0) {
        await selectWalletMenu(existingWallets);
      } else {
        console.log('No more wallets available.\n');
        await initialMenu();
      }
    } else {
      console.log('\n❌ Failed to delete wallet\n');
      await mainMenu(currentWalletName);
    }
  } else {
    console.log('\n❌ Deletion cancelled\n');
    await mainMenu(currentWalletName);
  }
}

// Run CLI only when not under test
if (process.env.NODE_ENV !== 'test') {
  main().catch(console.error);
}

// Exports for tests
export {
  main,
  wallet,
  config,
  checkBalance,
  sendCrypto,
  showReceiveAddress,
  changeNetwork,
  manageTokens,
  checkPortfolioAllNetworks
};
