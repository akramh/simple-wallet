/**
 * @file index.ts
 * @description Command-line interface (CLI) entry point for the Simple Crypto Wallet.
 * 
 * Provides an interactive terminal interface for managing Ethereum wallets,
 * accounts, tokens, and transactions. Uses inquirer for menu navigation
 * and chalk for styled output.
 * 
 * @responsibilities
 * - Interactive wallet creation and import workflows
 * - Multi-wallet and multi-account management
 * - Balance checking and transaction sending
 * - Token management (ERC-20)
 * - Network switching across EVM chains
 * - Secure mnemonic/private key display
 * - Wallet backup and restore
 * 
 * @dependencies
 * - inquirer: Interactive command-line prompts
 * - chalk: Terminal string styling
 * - qrcode-terminal: QR code generation for receive addresses
 * - ethers: Ethereum utilities
 * - Internal: Wallet, WalletAppService, FileStorage, ExplorerAPI
 * 
 * @security
 * - Master password required for wallet encryption
 * - Password cached in memory during session
 * - Mnemonic migration from plaintext to encrypted format
 * - Secret reveal requires password re-entry
 * 
 * @example
 * ```bash
 * # Run the CLI
 * npm run dev
 * 
 * # Or build and run
 * npm run build && npm start
 * ```
 */

import 'dotenv/config';
import { applyNetworkGuard } from './utils/network-guard.js';
import { installConsoleRedactor } from './utils/redact-logs.js';

// Apply security guard + console redactor immediately (before any module that
// might log network URLs). The redactor replaces occurrences of the Alchemy
// key (and legacy Helius key) with <redacted> in any console.* output.
installConsoleRedactor(process.env.ALCHEMY_API_KEY);
installConsoleRedactor(process.env.HELIUS_API_KEY);
applyNetworkGuard();

import inquirer from 'inquirer';
import { Wallet } from './wallet.js';
import fs from 'fs';
import qrcode from 'qrcode-terminal';
import { ethers } from 'ethers';
import chalk from 'chalk';
import { validatePasswordLength, hasExistingWallets, needsMigration, encryptMnemonic, validateMnemonic } from './crypto-utils.js';
import * as ui from './ui-helpers.js';
import { WalletAppService } from './app-service.js';
import { FileStorage } from './storage.js';
import { createProviderFactory } from './providers.js';
import { ExplorerAPI } from './explorer-api.js';
import { applyExplorerApiKeys } from './config-utils.js';
import {
  getTokenPrices,
  getNativeTokenPrice,
  getERC20TokenPrice,
  getBitcoinPrice,
  getSolanaPrice,
  getTokenPriceBySymbol,
  getTonPrice,
  isBitcoinNetworkKey,
  calculateTotalValue,
  calculateTransactionCosts,
  type TokenInfo
} from './price-service.js';
import type { Config, Token, TokenMetadata } from './types/index.js';
import { isBitcoinNetwork, isValidBitcoinAddress, satoshisToBtc } from './bitcoin/index.js';
import { isXRPNetwork, isValidXRPAddress, dropsToXrp, isValidDestinationTag } from './xrp/index.js';
import { getXRPPrice } from './price-service.js';
import { findTonTransaction, isTonNetwork, isValidTonAddress } from './ton/index.js';
import { getVisibleNetworkEntries } from './network-visibility.js';

// ============================================================================
// Configuration and Global State
// ============================================================================

/**
 * Load the base network definitions from the shipped config.json (never
 * written back). Merge any user-state from the gitignored config.local.json
 * (current network, testnet toggle). Then apply env-var substitution for
 * placeholders like `${ALCHEMY_API_KEY}`.
 */
const LOCAL_STATE_PATH = 'config.local.json';
const configData = JSON.parse(fs.readFileSync('config.json', 'utf8')) as Config & { network: string };
if (fs.existsSync(LOCAL_STATE_PATH)) {
  try {
    const localState = JSON.parse(fs.readFileSync(LOCAL_STATE_PATH, 'utf8')) as Partial<Config & { network: string }>;
    if (typeof localState.network === 'string') configData.network = localState.network;
    if (typeof (localState as any).showTestnets === 'boolean') (configData as any).showTestnets = (localState as any).showTestnets;
  } catch (err) {
    console.warn(`[config] failed to merge ${LOCAL_STATE_PATH}:`, (err as Error).message);
  }
}
const { config, globalApiKey } = applyExplorerApiKeys(configData);

/** File-based storage adapter for persistent wallet data */
const storage = new FileStorage();

/** Core wallet instance with HD derivation and signing */
const wallet = new Wallet(config, storage, createProviderFactory());

// Token registry paths
/** Built-in token list path */
const TOKEN_LIST_PATH = 'tokens.json';
/** User-added custom tokens path */
const CUSTOM_TOKENS_PATH = 'tokens-user.json';

/** High-level wallet service for token/network management */
const walletService = new WalletAppService(wallet, config, {
  tokenListPath: TOKEN_LIST_PATH,
  customTokenPath: CUSTOM_TOKENS_PATH,
  // CLI persists user-state to a separate gitignored file so the shipped
  // config.json never gets written back (which would leak the substituted
  // Alchemy key). Extension + mobile use sandboxed storage and aren't
  // affected; they can continue to use the default 'config.json' key.
  configPath: LOCAL_STATE_PATH,
  storage
});

/** Explorer API for fetching on-chain transaction history */
const explorerAPI = new ExplorerAPI();
explorerAPI.registerNetworks(config.networks, globalApiKey);

// ============================================================================
// Session State (In-Memory Only)
// ============================================================================

/** Cached master password for the current session */
let masterPassword: string | null = null;

/** Currently loaded wallet name */
let currentWalletName: string | null = null;

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main CLI entry point.
 * Initializes the wallet service, handles migration if needed,
 * and presents the appropriate menu based on wallet state.
 * 
 * @async
 */
async function main(): Promise<void> {
  ui.clearScreen();
  ui.showHeader(null, null, config.networks[config.network].name);

  await walletService.initialize();

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

// ============================================================================
// Password Management
// ============================================================================

/**
 * Prompts user to create a new master password with confirmation.
 * Enforces minimum 8 character length and matching confirmation.
 * Caches the password in memory for the session.
 * 
 * @returns The newly created master password
 */
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

/**
 * Prompts user to enter their existing master password.
 * Used for wallet decryption and secret reveal.
 * 
 * @returns The entered password (validated for minimum length)
 */
async function promptMasterPassword(): Promise<string> {
  while (true) {
    const { password } = await inquirer.prompt<{ password: string }>([
      {
        type: 'password',
        name: 'password',
        message: 'Enter master password:',
        mask: '*'
      }
    ]);

    if (!password || password.length < 8) {
      console.log('\n❌ Password must be at least 8 characters\n');
      continue;
    }

    return password;
  }
}

/**
 * Ensures a master password is available, prompting if not cached.
 * Used before operations that require the password.
 * 
 * @returns The cached or newly entered password
 */
async function ensureMasterPassword(): Promise<string> {
  if (!masterPassword) {
    masterPassword = await promptMasterPassword();
  }
  return masterPassword;
}

// ============================================================================
// Migration
// ============================================================================

/**
 * Migrates plaintext wallets to encrypted format.
 * Creates a backup of the original wallets.json before migration.
 * Requires setting up a new master password.
 * 
 * @async
 * @throws Exits process if user declines migration
 */
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

// ============================================================================
// Menu Functions
// ============================================================================

/**
 * Displays wallet selection menu for users with existing wallets.
 * Lists all saved wallets with their primary address and account count.
 * Handles wallet loading with password validation (3 attempts max).
 * 
 * @param existingWallets - Map of wallet names to wallet data
 */
async function selectWalletMenu(existingWallets: Record<string, any>): Promise<void> {
  ui.clearScreen();
  ui.showHeader();
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

/**
 * Displays initial menu for users without a loaded wallet.
 * Offers options to create, import, or restore a wallet.
 * 
 * @async
 */
async function initialMenu(): Promise<void> {
  const hasExistingWallets = Object.keys(wallet.getAllWallets()).length > 0;

  if (!hasExistingWallets) {
    ui.showBox(
      'Welcome',
      'No wallets found on this device.\n\nChoose how to get started:',
      'success'
    );
  }

  const choices: any[] = [
    ui.menuChoice('Create a new wallet', 'Generate a fresh 12-word phrase', 'create'),
    ui.menuChoice('Import from recovery phrase', 'Restore an existing wallet', 'import'),
    ui.menuChoice('Import from private key', 'Advanced', 'import_pk'),
  ];

  if (hasExistingWallets) {
    choices.push(
      new inquirer.Separator(''),
      ui.menuChoice('Back to Wallet Selection', '', 'back')
    );
  }

  choices.push(
    new inquirer.Separator(''),
    ui.menuChoice('Exit', '', 'exit')
  );

  const { action } = await inquirer.prompt<{ action: string }>([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices
    }
  ]);

  switch (action) {
    case 'create':
      await createWallet();
      break;
    case 'import':
      await importWallet();
      break;
    case 'import_pk':
      await importWalletFromPrivateKey();
      break;
    case 'back': {
      const existingWallets = wallet.getAllWallets();
      if (Object.keys(existingWallets).length > 0) {
        await selectWalletMenu(existingWallets);
      } else {
        await initialMenu();
      }
      break;
    }
    case 'exit':
      console.log('Goodbye!');
      process.exit(0);
  }
}

// ============================================================================
// Wallet Operations
// ============================================================================

/**
 * Creates a new HD wallet with a random mnemonic.
 * Displays the recovery phrase and prompts to save the wallet.
 * Sets up master password if this is the first wallet.
 * 
 * @async
 */
async function createWallet(): Promise<void> {
  ui.clearScreen();
  ui.showHeader();
  ui.showLoading('Creating new wallet...');

  try {
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
    if (walletData.mnemonic) {
      ui.showMnemonic(walletData.mnemonic);
    }

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
      ui.showSuccess(`Wallet saved as "${savedWalletName}"`);
      ui.showWarning('Keep this file secure and back up your mnemonic phrase!');
    }

    await mainMenu(savedWalletName);
  } catch (error) {
    const err = error as Error;
    ui.showError(`Failed to create wallet: ${err.message}`, [
      'Please try again',
      'If the problem persists, check your system for issues'
    ]);

    await inquirer.prompt<{ continue: string }>([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);

    await initialMenu();
  }
}

/**
 * Imports an existing wallet from a 12 or 24-word mnemonic phrase.
 * Validates the mnemonic format before import.
 * Sets up master password if this is the first wallet.
 *
 * @async
 */
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
      message: 'Enter your 12 or 24-word mnemonic phrase:',
      validate: (input) => {
        const words = input.trim().split(/\s+/);
        if (![12, 15, 18, 21, 24].includes(words.length)) {
          return 'Please enter a valid mnemonic (12, 15, 18, 21, or 24 words)';
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
      ui.showSuccess(`Wallet saved as "${savedWalletName}"`);
      ui.showWarning('Keep this file secure and back up your mnemonic phrase!');
    }

    await mainMenu(savedWalletName);
  } catch (error) {
    const err = error as Error;
    console.log('\n❌ Error:', err.message, '\n');
    await initialMenu();
  }
}

/**
 * Imports a wallet from a raw private key.
 * Prompts for chain type and the private key itself.
 * 
 * @async
 */
async function importWalletFromPrivateKey(): Promise<void> {
  console.log('\n📥 Import Private Key\n');

  // Check if first-time setup
  const isFirstWallet = !hasExistingWallets();

  // Get password (setup or use cached)
  let password: string;
  if (isFirstWallet) {
    password = await promptMasterPasswordSetup();
  } else {
    password = await ensureMasterPassword();
  }

  const { chainType } = await inquirer.prompt<{ chainType: string }>([
    {
      type: 'list',
      name: 'chainType',
      message: 'Select chain type:',
      choices: [
        { name: 'Ethereum / EVM', value: 'evm' },
        { name: 'Bitcoin', value: 'bitcoin' },
        { name: 'Solana', value: 'solana' },
        { name: 'XRP Ledger', value: 'xrp' },
        { name: 'TON', value: 'ton' }
      ]
    }
  ]);

  const { privateKey } = await inquirer.prompt<{ privateKey: string }>([
    {
      type: 'password',
      name: 'privateKey',
      message: 'Enter raw private key:',
      mask: '*'
    }
  ]);

  try {
    const walletData = walletService.importFromPrivateKey(
      privateKey.trim(),
      chainType as 'evm' | 'solana' | 'bitcoin' | 'xrp' | 'ton',
      password
    );

    console.log('\n✅ Private key imported successfully!');
    if (walletData.address && walletData.address !== 'Generated on demand') {
      console.log('📍 Address:', walletData.address, '\n');
    } else {
      console.log('📍 Wallet imported (address will be generated on use)\n');
    }

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
        default: chainType === 'evm' && walletData.address
          ? `PK_${walletData.address.substring(2, 8)}`
          : `PK_${chainType}_Wallet`,
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
      ui.showSuccess(`Wallet saved as "${savedWalletName}"`);
      ui.showWarning('Keep this file secure!');
    }

    await mainMenu(savedWalletName);
  } catch (error) {
    const err = error as Error;
    console.log('\n❌ Error:', err.message, '\n');
    await initialMenu();
  }
}

/**
 * Restores a wallet from an encrypted backup file.
 * Prompts for backup file path and decryption password.
 * Handles password synchronization with existing master password.
 * 
 * @async
 */
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

/**
 * Displays the main menu for a loaded wallet.
 * Provides access to all wallet operations: balance, send, receive,
 * accounts, tokens, secrets, export, and network switching.
 * 
 * @param walletName - Name of the currently loaded wallet (null if unsaved)
 */
async function mainMenu(walletName: string | null): Promise<void> {
  currentWalletName = walletName;
  const currentAddress = walletService.getAddress();
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
        ui.menuChoice('Balance', 'View balance on the active network', 'balance'),
        ui.menuChoice('Send', 'Transfer tokens to an address', 'send'),
        ui.menuChoice('Receive', 'Show address and QR', 'receive'),
        ui.menuChoice('Portfolio', 'View balances across chains', 'portfolio_all'),
        ui.menuChoice('History', 'Recent transactions', 'history'),
        new inquirer.Separator(ui.menuSeparator().line),
        ui.menuChoice('Switch Network', 'Change active blockchain', 'network'),
        ui.menuChoice('Switch Account', 'Select a different account', 'accounts'),
        new inquirer.Separator(ui.menuSeparator().line),
        ui.menuChoice('Settings', 'Preferences and security', 'settings'),
        ui.menuChoice('Exit', 'Close the wallet', 'exit')
      ]
    }
  ]);

  switch (action) {
    case 'send':
      await sendCrypto(currentWalletName);
      break;
    case 'receive':
      await showReceiveAddress(currentWalletName);
      break;
    case 'balance':
      await checkBalance(currentWalletName);
      break;
    case 'portfolio_all':
      await checkPortfolioAllNetworks(currentWalletName);
      break;
    case 'history':
      await viewTransactionHistory(currentWalletName);
      break;
    case 'network':
      await changeNetwork();
      break;
    case 'accounts':
      await manageAccounts(currentWalletName);
      break;
    case 'settings':
      await settingsMenu(currentWalletName);
      break;
    case 'exit':
      console.log('Goodbye!');
      process.exit(0);
  }
}

/**
 * Displays the settings submenu: token management, secret reveal,
 * wallet export, wallet switching, and deletion. Dispatches to the
 * same handlers previously reachable directly from the main menu.
 *
 * @param walletName - Name of the currently loaded wallet
 */
async function settingsMenu(walletName: string | null): Promise<void> {
  currentWalletName = walletName;
  const currentAddress = walletService.getAddress();
  const accountIndex = wallet.currentAccountIndex;

  ui.clearScreen();
  ui.showHeader(walletName, accountIndex, config.networks[config.network].name, currentAddress);

  const { action } = await inquirer.prompt<{ action: string }>([
    {
      type: 'list',
      name: 'action',
      message: 'Settings:',
      loop: false,
      pageSize: 25,
      choices: [
        ui.menuChoice('Manage Tokens', 'Add or remove ERC-20 tokens', 'tokens'),
        ui.menuChoice('Show Secrets', 'View private key & mnemonic', 'secrets'),
        ui.menuChoice('Export Wallet', 'Backup wallet to file', 'export'),
        ui.menuChoice('Switch Wallet', 'Load a different wallet', 'switch'),
        ui.menuChoice('Delete Wallet', 'Remove current wallet', 'delete'),
        new inquirer.Separator(ui.menuSeparator().line),
        ui.menuChoice('Back to Main Menu', '', 'back')
      ]
    }
  ]);

  switch (action) {
    case 'tokens':
      await manageTokens(currentWalletName);
      break;
    case 'secrets':
      await showWalletSecrets(currentWalletName);
      break;
    case 'export':
      await exportWallet(currentWalletName);
      break;
    case 'switch':
      await switchWallet();
      break;
    case 'delete':
      await deleteCurrentWallet(currentWalletName);
      break;
    case 'back':
      await mainMenu(currentWalletName);
      break;
  }
}

// ============================================================================
// Balance and Portfolio Functions
// ============================================================================

/**
 * Displays the current balance for all tokens on the active network.
 * Fetches balances from the blockchain via RPC and USD prices from CoinGecko.
 *
 * @param currentWalletName - Name of the current wallet for header display
 */
async function checkBalance(currentWalletName: string | null): Promise<void> {
  // Use walletService.getAddress() which handles both EVM and Bitcoin
  const address = walletService.getAddress();
  ui.clearScreen();
  ui.showHeader(currentWalletName, wallet.currentAccountIndex, config.networks[config.network].name, address);

  try {
    ui.showLoading('Fetching balance from blockchain...');
    console.log('');

    // Use walletService which handles both EVM and Bitcoin networks
    const portfolio = await walletService.getPortfolioForNetwork(config.network);

    // Fetch USD prices based on network type
    ui.showLoading('Fetching USD prices...');
    let prices: Map<string, number | null>;

    const currentNetConfig = config.networks[config.network];
    const isSolana = currentNetConfig?.type === 'solana';

    if (isBitcoinNetwork(config.network)) {
      // Bitcoin network - get Bitcoin price
      const btcPrice = await getBitcoinPrice(config.network);
      prices = new Map([['native', btcPrice]]);
    } else if (isSolana) {
      // Solana network - get SOL price + SPL token prices by symbol
      const solPrice = await getSolanaPrice(config.network);
      prices = new Map([['native', solPrice]]);

      const splTokens = portfolio
        .map((entry) => entry.token)
        .filter((token) => token.type === 'spl' && token.address);

      for (const token of splTokens) {
        const tokenPrice = await getTokenPriceBySymbol(token.symbol);
        prices.set(token.address.toLowerCase(), tokenPrice);
      }
    } else if (isXRPNetwork(config.network)) {
      // XRP network - get XRP price
      const xrpPrice = await getXRPPrice(config.network);
      prices = new Map([['native', xrpPrice]]);
    } else if (isTonNetwork(config.network)) {
      // TON network - get TON price
      const tonPrice = await getTonPrice(config.network);
      prices = new Map([['native', tonPrice]]);
    } else {
      // EVM network - get token prices
      const chainId = currentNetConfig && 'chainId' in currentNetConfig ? currentNetConfig.chainId : 1;
      const tokens = walletService.getTokensForNetwork(config.network);
      const tokenInfos: TokenInfo[] = tokens.map(t => ({
        type: t.type as 'native' | 'erc20',
        symbol: t.symbol,
        address: t.address,
        decimals: t.decimals
      }));
      prices = await getTokenPrices(chainId, tokenInfos);
    }

    console.log('');
    ui.showSuccess('Balances retrieved successfully!');
    ui.showSection('Portfolio');
    ui.showSeparator();

    let totalUsd = 0;

    portfolio.forEach(({ token, balance, error }) => {
      const label = `${token.symbol}${token.type === 'native' ? ' (native)' : ''}`.padEnd(18);
      if (error) {
        console.log(`${label} ${chalk.red('Error')} ${chalk.gray(`(${error})`)}`);
      } else {
        // Get price for this token
        const priceKey = token.type === 'native' ? 'native' : token.address?.toLowerCase();
        const price = priceKey ? prices.get(priceKey) : null;
        const balanceNum = parseFloat(balance);
        const usdValue = price !== null && price !== undefined && !isNaN(balanceNum)
          ? balanceNum * price
          : null;

        if (usdValue !== null) {
          totalUsd += usdValue;
        }

        console.log(ui.formatBalanceWithUsd(balance, token.symbol, usdValue, token.type === 'native'));
      }
    });

    ui.showSeparator();

    // Show total portfolio value
    if (totalUsd > 0) {
      ui.showPortfolioTotal(totalUsd);
    }

  } catch (error) {
    const err = error as Error;
    let apiHint = 'Verify the network RPC endpoint in config.json';
    if (isBitcoinNetwork(config.network)) {
      apiHint = 'Verify the Mempool.space API is accessible';
    } else if (isXRPNetwork(config.network)) {
      apiHint = 'Verify the XRP Ledger WebSocket is accessible';
    } else if (isTonNetwork(config.network)) {
      apiHint = 'Verify the Toncenter RPC endpoint is accessible';
    }
    ui.showError(
      err.message,
      [
        'Check your internet connection',
        apiHint,
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

/**
 * Displays portfolio balances across all configured networks.
 * Temporarily switches network context to fetch each network's balances.
 * Fetches USD prices for each network's tokens.
 * Restores original network after completion.
 *
 * @param currentWalletName - Name of the current wallet for header display
 */
async function checkPortfolioAllNetworks(currentWalletName: string | null): Promise<void> {
  const originalNetwork = config.network;
  const address = walletService.getAddress();
  ui.clearScreen();
  ui.showHeader(currentWalletName, wallet.currentAccountIndex, 'All Networks', address);

  ui.showLoading('Fetching balances and prices across all networks...');
  console.log('');

  const networks = Object.keys(config.networks);
  const results: Array<{
    network: string;
    success: boolean;
    portfolio?: Array<{ token: Token; balance: string; error?: string }>;
    prices?: Map<string, number | null>;
    error?: string;
  }> = [];

  for (const net of networks) {
    try {
      // Swap provider context per network to reuse the same wallet/account.
      await walletService.setNetwork(net, { persist: false });

      // Use walletService which handles both EVM and Bitcoin
      const portfolio = await walletService.getPortfolioForNetwork(net);

      // Fetch prices based on network type
      let prices: Map<string, number | null>;
      try {
        if (isBitcoinNetwork(net)) {
          // Bitcoin network - get Bitcoin price
          const btcPrice = await getBitcoinPrice(net);
          prices = new Map([['native', btcPrice]]);
        } else if (config.networks[net]?.type === 'solana') {
          const solPrice = await getSolanaPrice(net);
          prices = new Map([['native', solPrice]]);
        } else if (isXRPNetwork(net)) {
          // XRP network - get XRP price
          const xrpPrice = await getXRPPrice(net);
          prices = new Map([['native', xrpPrice]]);
        } else if (isTonNetwork(net)) {
          // TON network - get TON price
          const tonPrice = await getTonPrice(net);
          prices = new Map([['native', tonPrice]]);
        } else {
          // EVM network - get token prices
          const netConfig = config.networks[net];
          const chainId = 'chainId' in netConfig ? netConfig.chainId : 1;
          const tokens = walletService.getTokensForNetwork(net);
          const tokenInfos: TokenInfo[] = tokens.map(t => ({
            type: t.type as 'native' | 'erc20',
            symbol: t.symbol,
            address: t.address,
            decimals: t.decimals
          }));
          prices = await getTokenPrices(chainId, tokenInfos);
        }
      } catch {
        prices = new Map();
      }

      results.push({ network: net, success: true, portfolio, prices });
    } catch (error) {
      const err = error as Error;
      results.push({ network: net, success: false, error: err.message });
    }
  }

  // restore original network context
  await walletService.setNetwork(originalNetwork, { persist: false });

  let grandTotalUsd = 0;

  results.forEach(({ network, success, portfolio, prices, error }) => {
    ui.showSection(config.networks[network]?.name || network);
    if (!success) {
      ui.showWarning(`Failed: ${error}`);
      console.log('');
      return;
    }
    ui.showSeparator();

    let networkTotalUsd = 0;

    portfolio?.forEach(({ token, balance, error: tokenError }) => {
      if (tokenError) {
        const label = `${token.symbol}${token.type === 'native' ? ' (native)' : ''}`.padEnd(18);
        console.log(`${label} ${chalk.red('Error')} ${chalk.gray(`(${tokenError})`)}`);
      } else {
        // Get price for this token
        const priceKey = token.type === 'native' ? 'native' : token.address?.toLowerCase();
        const price = priceKey && prices ? prices.get(priceKey) : null;
        const balanceNum = parseFloat(balance);
        const usdValue = price !== null && price !== undefined && !isNaN(balanceNum)
          ? balanceNum * price
          : null;

        if (usdValue !== null) {
          networkTotalUsd += usdValue;
        }

        console.log(ui.formatBalanceWithUsd(balance, token.symbol, usdValue, token.type === 'native'));
      }
    });

    if (networkTotalUsd > 0) {
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.white('Network Total: ') + ui.formatUsdPrice(networkTotalUsd));
      grandTotalUsd += networkTotalUsd;
    }

    ui.showSeparator();
    console.log('');
  });

  // Show grand total across all networks
  if (grandTotalUsd > 0) {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.white.bold('Grand Total (All Networks): ') + ui.formatUsdPrice(grandTotalUsd));
    console.log(chalk.cyan('═'.repeat(60)));
  }

  await inquirer.prompt<{ continue: string }>([{
    type: 'input',
    name: 'continue',
    message: 'Press Enter to continue...'
  }]);

  await mainMenu(currentWalletName);
}

// ============================================================================
// Transaction Functions
// ============================================================================

/**
 * Displays recent transaction history from block explorer.
 * Shows up to 15 recent transactions with status, amount, and direction.
 * Requires explorer API to be configured for the current network.
 * 
 * @param currentWalletName - Name of the current wallet for header display
 */
async function viewTransactionHistory(currentWalletName: string | null): Promise<void> {
  const address = walletService.getAddress();
  ui.clearScreen();
  ui.showHeader(currentWalletName, wallet.currentAccountIndex, config.networks[config.network].name, address);

  ui.showSection('Transaction History');

  // Bitcoin history via Mempool.space
  if (isBitcoinNetwork(config.network)) {
    ui.showLoading('Fetching transactions from Mempool...');
    try {
      const txs = await walletService.getBitcoinTransactionHistory(15);
      console.log('');

      if (txs.length === 0) {
        ui.showInfo('No transactions found for this address.');
      } else {
        ui.showSuccess(`Found ${txs.length} recent transactions`);
        console.log('');
        ui.showSeparator();

        const symbol = config.networks[config.network].nativeSymbol || 'BTC';
        for (const tx of txs) {
          const isSent = tx.type === 'send';
          const direction = isSent ? chalk.red('↑ SENT') : chalk.green('↓ RECEIVED');
          const otherAddress = isSent ? tx.to : tx.from;
          const shortAddr = otherAddress ? `${otherAddress.slice(0, 10)}...${otherAddress.slice(-8)}` : 'Unknown';

          const btcValue = satoshisToBtc(parseInt(tx.value, 10) || 0);
          const valueStr = `${parseFloat(btcValue).toFixed(8)} ${symbol}`;

          const date = new Date(tx.timestamp);
          const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          const statusIcon = tx.status === 'confirmed' ? '✓' : '○';
          const statusColor = tx.status === 'confirmed' ? chalk.green : chalk.yellow;

          console.log(`${statusColor(statusIcon)} ${direction}  ${chalk.white(valueStr.padEnd(20))} ${chalk.gray(dateStr)}`);
          console.log(`  ${chalk.gray(isSent ? 'To:' : 'From:')} ${chalk.cyan(shortAddr)}`);
          console.log(`  ${chalk.gray('Txid:')} ${chalk.gray(tx.hash.slice(0, 18))}...`);
          console.log('');
        }

        ui.showSeparator();
        const addrUrl = walletService.getBitcoinAddressUrl(address);
        if (addrUrl) {
          console.log(chalk.gray(`View all: ${addrUrl}`));
          console.log('');
        }
      }
    } catch (error) {
      const err = error as Error;
      ui.showError('Failed to fetch transactions', [err.message]);
    }

    await inquirer.prompt<{ continue: string }>([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);

    await mainMenu(currentWalletName);
    return;
  }

  // Solana history via RPC
  if (config.networks[config.network]?.type === 'solana') {
    ui.showLoading('Fetching transactions from Solana RPC...');
    try {
      const txs = await walletService.getSolanaTransactionHistory(15);
      console.log('');

      if (txs.length === 0) {
        ui.showInfo('No transactions found for this address.');
      } else {
        ui.showSuccess(`Found ${txs.length} recent transactions`);
        console.log('');
        ui.showSeparator();

        const nativeSymbol = config.networks[config.network].nativeSymbol || 'SOL';
        for (const tx of txs) {
          const isSent = tx.type === 'send';
          const direction = isSent ? chalk.red('↑ SENT') : tx.type === 'receive' ? chalk.green('↓ RECEIVED') : chalk.gray('• OTHER');
          const otherAddress = isSent ? tx.to : tx.from;
          const shortAddr = otherAddress ? `${otherAddress.slice(0, 10)}...${otherAddress.slice(-8)}` : 'Unknown';

          const tokenSymbol = tx.tokenSymbol || nativeSymbol;
          const rawValue = tx.valueToken ?? tx.valueSol;
          const valueStr = tokenSymbol === nativeSymbol
            ? `${parseFloat(rawValue).toFixed(9)} ${tokenSymbol}`
            : `${rawValue} ${tokenSymbol}`;

          const date = new Date(tx.timestamp);
          const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          const statusIcon = tx.status === 'confirmed' ? '✓' : tx.status === 'failed' ? '✗' : '○';
          const statusColor = tx.status === 'confirmed' ? chalk.green : tx.status === 'failed' ? chalk.red : chalk.yellow;

          console.log(`${statusColor(statusIcon)} ${direction}  ${chalk.white(valueStr.padEnd(20))} ${chalk.gray(dateStr)}`);
          if (tx.type !== 'contract_interaction') {
            console.log(`  ${chalk.gray(isSent ? 'To:' : 'From:')} ${chalk.cyan(shortAddr)}`);
          }
          console.log(`  ${chalk.gray('Sig:')} ${chalk.gray(tx.signature.slice(0, 18))}...`);
          if (tx.feeLamports > 0) {
            console.log(`  ${chalk.gray('Fee:')} ${chalk.gray(`${tx.feeSol} ${nativeSymbol}`)}`);
          }
          console.log('');
        }

        ui.showSeparator();
      }
    } catch (error) {
      const err = error as Error;
      ui.showError('Failed to fetch transactions', [err.message]);
    }

    await inquirer.prompt<{ continue: string }>([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);

    await mainMenu(currentWalletName);
    return;
  }

  // TON history via Toncenter
  if (isTonNetwork(config.network)) {
    ui.showLoading('Fetching transactions from Toncenter...');
    try {
      const txs = await walletService.getTonTransactionHistory(15);
      console.log('');

      if (txs.length === 0) {
        ui.showInfo('No transactions found for this address.');
      } else {
        ui.showSuccess(`Found ${txs.length} recent transactions`);
        console.log('');
        ui.showSeparator();

        const symbol = config.networks[config.network].nativeSymbol || 'TON';
        for (const tx of txs) {
          const isSent = tx.type === 'send';
          const direction = isSent ? chalk.red('↑ SENT') : tx.type === 'receive' ? chalk.green('↓ RECEIVED') : chalk.gray('• OTHER');
          const otherAddress = isSent ? tx.to : tx.from;
          const shortAddr = otherAddress ? `${otherAddress.slice(0, 10)}...${otherAddress.slice(-8)}` : 'Unknown';

          const tonValue = tx.valueTon;
          const valueStr = `${parseFloat(tonValue).toFixed(9)} ${symbol}`;

          const date = new Date(tx.timestamp);
          const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          const statusIcon = tx.status === 'confirmed' ? '✓' : tx.status === 'failed' ? '✗' : '○';
          const statusColor = tx.status === 'confirmed' ? chalk.green : tx.status === 'failed' ? chalk.red : chalk.yellow;

          console.log(`${statusColor(statusIcon)} ${direction}  ${chalk.white(valueStr.padEnd(20))} ${chalk.gray(dateStr)}`);
          console.log(`  ${chalk.gray(isSent ? 'To:' : 'From:')} ${chalk.cyan(shortAddr)}`);
          console.log(`  ${chalk.gray('Hash:')} ${chalk.gray(tx.hash.slice(0, 18))}...`);
          if (tx.comment) {
            console.log(`  ${chalk.gray('Comment:')} ${chalk.gray(tx.comment)}`);
          }
          console.log('');
        }

        ui.showSeparator();
        const addrUrl = walletService.getTonAddressUrl(address);
        if (addrUrl) {
          console.log(chalk.gray(`View all: ${addrUrl}`));
          console.log('');
        }
      }
    } catch (error) {
      const err = error as Error;
      ui.showError('Failed to fetch transactions', [err.message]);
    }

    await inquirer.prompt<{ continue: string }>([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);

    await mainMenu(currentWalletName);
    return;
  }

  // XRP history via XRP Ledger
  if (isXRPNetwork(config.network)) {
    ui.showLoading('Fetching transactions from XRP Ledger...');
    try {
      const txs = await walletService.getXRPTransactionHistory(15);
      console.log('');

      if (txs.length === 0) {
        ui.showInfo('No transactions found for this address.');
      } else {
        ui.showSuccess(`Found ${txs.length} recent transactions`);
        console.log('');
        ui.showSeparator();

        const symbol = config.networks[config.network].nativeSymbol || 'XRP';
        for (const tx of txs) {
          const isSent = tx.type === 'send';
          const direction = isSent ? chalk.red('↑ SENT') : tx.type === 'receive' ? chalk.green('↓ RECEIVED') : chalk.gray('• OTHER');
          const otherAddress = isSent ? tx.to : tx.from;
          const shortAddr = otherAddress ? `${otherAddress.slice(0, 10)}...${otherAddress.slice(-8)}` : 'Unknown';

          const xrpValue = tx.valueXrp;
          const valueStr = `${parseFloat(xrpValue).toFixed(6)} ${symbol}`;

          const date = new Date(tx.timestamp);
          const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          const statusIcon = tx.status === 'confirmed' ? '✓' : tx.status === 'failed' ? '✗' : '○';
          const statusColor = tx.status === 'confirmed' ? chalk.green : tx.status === 'failed' ? chalk.red : chalk.yellow;

          console.log(`${statusColor(statusIcon)} ${direction}  ${chalk.white(valueStr.padEnd(20))} ${chalk.gray(dateStr)}`);
          console.log(`  ${chalk.gray(isSent ? 'To:' : 'From:')} ${chalk.cyan(shortAddr)}`);
          console.log(`  ${chalk.gray('Hash:')} ${chalk.gray(tx.hash.slice(0, 18))}...`);
          if (tx.destinationTag !== undefined) {
            console.log(`  ${chalk.gray('Dest Tag:')} ${chalk.yellow(tx.destinationTag.toString())}`);
          }
          console.log(`  ${chalk.gray('Fee:')} ${chalk.gray(`${tx.feeXrp} ${symbol}`)}`);
          console.log('');
        }

        ui.showSeparator();
        const addrUrl = walletService.getXRPAddressUrl(address);
        if (addrUrl) {
          console.log(chalk.gray(`View all: ${addrUrl}`));
          console.log('');
        }
      }
    } catch (error) {
      const err = error as Error;
      ui.showError('Failed to fetch transactions', [err.message]);
    }

    await inquirer.prompt<{ continue: string }>([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);

    await mainMenu(currentWalletName);
    return;
  }

  if (!explorerAPI.isSupported(config.network)) {
    ui.showWarning(`Explorer API not configured for ${config.networks[config.network].name}`);
    console.log(chalk.gray('Ensure explorerApiUrl is set in config.json and set EXPLORER_API_KEY (or EXPLORER_API_KEY_<NETWORK>) in .env.'));
    console.log('');

    await inquirer.prompt<{ continue: string }>([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);

    await mainMenu(currentWalletName);
    return;
  }

  ui.showLoading('Fetching transactions from block explorer...');

  try {
    const transactions = await explorerAPI.getAllTransactions(address, config.network, 1, 15);
    console.log('');

    if (transactions.length === 0) {
      ui.showInfo('No transactions found for this address.');
    } else {
      ui.showSuccess(`Found ${transactions.length} recent transactions`);
      console.log('');
      ui.showSeparator();

      for (const tx of transactions) {
        const isSent = tx.from.toLowerCase() === address.toLowerCase();
        const direction = isSent ? chalk.red('↑ SENT') : chalk.green('↓ RECEIVED');
        const otherAddress = isSent ? tx.to : tx.from;
        const shortAddr = otherAddress ? `${otherAddress.slice(0, 8)}...${otherAddress.slice(-6)}` : 'Contract Creation';

        // Format value
        let valueStr: string;
        if (tx.tokenSymbol) {
          const decimals = tx.tokenDecimals || 18;
          const value = parseFloat(tx.value) / Math.pow(10, decimals);
          valueStr = `${value.toFixed(4)} ${tx.tokenSymbol}`;
        } else {
          const ethValue = parseFloat(tx.value) / 1e18;
          valueStr = `${ethValue.toFixed(6)} ETH`;
        }

        // Format date (timestamp is already in ms)
        const date = new Date(tx.timestamp);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Status indicator
        const statusIcon = tx.status === 'confirmed' ? '✓' : tx.status === 'failed' ? '✗' : '○';
        const statusColor = tx.status === 'confirmed' ? chalk.green : tx.status === 'failed' ? chalk.red : chalk.yellow;

        console.log(`${statusColor(statusIcon)} ${direction}  ${chalk.white(valueStr.padEnd(20))} ${chalk.gray(dateStr)}`);
        console.log(`  ${chalk.gray(isSent ? 'To:' : 'From:')} ${chalk.cyan(shortAddr)}`);
        console.log(`  ${chalk.gray('Hash:')} ${chalk.gray(tx.hash.slice(0, 18))}...`);
        console.log('');
      }

      ui.showSeparator();

      // Show block explorer link
      const explorerUrl = config.networks[config.network].blockExplorer;
      if (explorerUrl) {
        console.log(chalk.gray(`View all: ${explorerUrl}/address/${address}`));
        console.log('');
      }
    }
  } catch (error) {
    const err = error as Error;
    ui.showError('Failed to fetch transactions', [err.message]);
  }

  await inquirer.prompt<{ continue: string }>([{
    type: 'input',
    name: 'continue',
    message: 'Press Enter to continue...'
  }]);

  await mainMenu(currentWalletName);
}

/**
 * Handles sending crypto (native or ERC-20 tokens).
 * Prompts for token selection, recipient, and amount with validation.
 * Shows gas estimation and USD costs before confirmation.
 * Shows transaction receipt with block explorer link on success.
 *
 * @param currentWalletName - Name of the current wallet for header display
 */
async function sendCrypto(currentWalletName: string | null): Promise<void> {
  const address = walletService.getAddress();
  ui.clearScreen();
  ui.showHeader(currentWalletName, wallet.currentAccountIndex, config.networks[config.network].name, address);

  // Bitcoin send flow (Native SegWit / P2WPKH)
  if (isBitcoinNetwork(config.network)) {
    ui.showSection('Send BTC');
    ui.showInfo('Native SegWit (bech32) addresses only');
    console.log('');

    const btcNetwork = config.network === 'bitcoin-mainnet' ? 'mainnet' : 'testnet';
    const nativeSymbol = config.networks[config.network].nativeSymbol || (btcNetwork === 'testnet' ? 'tBTC' : 'BTC');

    const answers = await inquirer.prompt<{
      toAddress?: string;
      amount?: string;
    }>([
      {
        type: 'input',
        name: 'toAddress',
        message: `Recipient address (${btcNetwork === 'testnet' ? 'tb1...' : 'bc1...'}), or leave empty to cancel:`,
        validate: (input) => {
          if (!input || input.trim() === '') return true;
          if (!isValidBitcoinAddress(input.trim(), btcNetwork)) {
            return 'Please enter a valid Bitcoin bech32 address';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'amount',
        message: `Amount (in ${nativeSymbol}):`,
        when: (a) => !!a.toAddress && a.toAddress.trim() !== '',
        validate: (input) => {
          if (!input || input.trim() === '') return true;
          if (!/^\d+(\.\d+)?$/.test(input.trim())) return 'Enter a valid numeric amount';
          const num = parseFloat(input);
          if (isNaN(num) || num <= 0) return 'Amount must be greater than 0';
          if (input.includes('.') && input.split('.')[1].length > 8) return 'Bitcoin supports up to 8 decimals';
          return true;
        }
      }
    ]);

    if (!answers.toAddress || answers.toAddress.trim() === '' || !answers.amount || answers.amount.trim() === '') {
      ui.showWarning('Transaction cancelled');
      await mainMenu(currentWalletName);
      return;
    }

    ui.showLoading('Estimating network fee...');
    const btcToken = walletService.getNativeToken(config.network);
    const gasEstimate = await walletService.getGasEstimate(btcToken, answers.toAddress.trim(), answers.amount.trim());

    let btcPrice: number | null = null;
    try {
      btcPrice = await getBitcoinPrice(config.network);
    } catch {
      btcPrice = null;
    }

    const { amountUsd, gasCostUsd, totalUsd } = calculateTransactionCosts(
      answers.amount.trim(),
      btcPrice,
      gasEstimate.estimatedCostNative,
      btcPrice
    );

    ui.clearScreen();
    ui.showHeader(currentWalletName, wallet.currentAccountIndex, config.networks[config.network].name, address);

    ui.showTransactionConfirmation({
      tokenSymbol: nativeSymbol,
      amount: answers.amount.trim(),
      recipient: answers.toAddress.trim(),
      networkName: config.networks[config.network].name || config.network,
      amountUsd,
      gasCostNative: gasEstimate.estimatedCostNative,
      nativeSymbol: gasEstimate.nativeSymbol,
      gasCostUsd,
      totalUsd,
      gasEstimateFailed: !!gasEstimate.error
    });

    if (!gasEstimate.error) {
      console.log(chalk.gray('Fee rate:            ') + chalk.white(`${gasEstimate.gasPrice} sat/vB`));
      console.log(chalk.gray('Estimated size:      ') + chalk.white(`${gasEstimate.gasLimit} vB`));
      console.log('');
    }

    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Confirm & Send?',
        default: false
      }
    ]);

    if (!confirm) {
      ui.showWarning('Transaction cancelled');
      await mainMenu(currentWalletName);
      return;
    }

    ui.showLoading('Broadcasting transaction...');
    const password = await ensureMasterPassword();
    const result = await walletService.sendBitcoinTransaction(answers.toAddress.trim(), answers.amount.trim(), password);

    ui.showSuccess('Transaction broadcasted (pending confirmation)');
    console.log('');
    console.log(chalk.gray('Txid: ') + chalk.magenta(result.hash));
    console.log(chalk.gray('Fee:  ') + chalk.white(`${result.feeBtc} ${nativeSymbol}`));

    const txUrl = walletService.getBitcoinTransactionUrl(result.hash);
    if (txUrl) {
      console.log(chalk.gray('View: ') + chalk.cyan(txUrl));
    }
    console.log('');

    await inquirer.prompt<{ continue: string }>([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);

    await mainMenu(currentWalletName);
    return;
  }

  // Solana send flow
  if (config.networks[config.network]?.type === 'solana') {
    const solNetConfig = config.networks[config.network];
    const nativeSymbol = solNetConfig.nativeSymbol || 'SOL';

    const solTokens = walletService.getTokensForNetwork(config.network)
      .filter((token) => token.type === 'native' || token.type === 'spl');
    const selectedToken = solTokens.length > 1
      ? (await inquirer.prompt<{ token: Token }>([
        {
          type: 'list',
          name: 'token',
          message: 'Select a token to send:',
          choices: solTokens.map((token) => ({
            name: `${token.symbol} ${token.name ? `- ${token.name}` : ''}`.trim(),
            value: token
          }))
        }
      ])).token
      : solTokens[0];

    const tokenSymbol = selectedToken?.symbol || nativeSymbol;
    const tokenDecimals = selectedToken?.decimals ?? 9;

    ui.showSection(`Send ${tokenSymbol}`);
    ui.showInfo('Press Ctrl+C to cancel at any time');
    console.log('');

    const answers = await inquirer.prompt<{
      toAddress?: string;
      amount?: string;
    }>([
      {
        type: 'input',
        name: 'toAddress',
        message: 'Recipient Solana address (or leave empty to cancel):',
        validate: (input) => {
          if (!input || input.trim() === '') return true;
          // Basic Solana base58 validation
          if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.trim())) {
            return 'Please enter a valid Solana address (base58)';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'amount',
        message: `Amount (in ${tokenSymbol}):`,
        when: (a) => !!a.toAddress && a.toAddress.trim() !== '',
        validate: (input) => {
          if (!input || input.trim() === '') return true;
          if (!/^\d+(\.\d+)?$/.test(input.trim())) return 'Enter a valid numeric amount';
          const num = parseFloat(input);
          if (isNaN(num) || num <= 0) return 'Amount must be greater than 0';
          if (input.includes('.') && input.split('.')[1].length > tokenDecimals) {
            return `${tokenSymbol} supports up to ${tokenDecimals} decimals`;
          }
          return true;
        }
      }
    ]);

    if (!answers.toAddress || answers.toAddress.trim() === '' || !answers.amount || answers.amount.trim() === '') {
      ui.showWarning('Transaction cancelled');
      await mainMenu(currentWalletName);
      return;
    }

    ui.showLoading('Estimating network fee...');
    const gasEstimate = await walletService.getGasEstimate(
      selectedToken,
      answers.toAddress.trim(),
      answers.amount.trim()
    );

    let solPrice: number | null = null;
    try {
      solPrice = await getSolanaPrice();
    } catch {
      solPrice = null;
    }

    const tokenPrice = selectedToken?.type === 'native' ? solPrice : null;
    const { amountUsd, gasCostUsd, totalUsd } = calculateTransactionCosts(
      answers.amount.trim(),
      tokenPrice,
      gasEstimate.estimatedCostNative,
      solPrice
    );

    ui.clearScreen();
    ui.showHeader(currentWalletName, wallet.currentAccountIndex, solNetConfig.name || config.network, address);

    ui.showTransactionConfirmation({
      tokenSymbol,
      amount: answers.amount.trim(),
      recipient: answers.toAddress.trim(),
      networkName: solNetConfig.name || config.network,
      amountUsd,
      gasCostNative: gasEstimate.estimatedCostNative,
      nativeSymbol: gasEstimate.nativeSymbol,
      gasCostUsd,
      totalUsd,
      gasEstimateFailed: !!gasEstimate.error
    });

    if (!gasEstimate.error) {
      console.log(chalk.gray('Fee:                 ') + chalk.white(`${gasEstimate.estimatedCostNative} ${nativeSymbol}`));
      console.log('');
    }

    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Confirm & Send?',
        default: false
      }
    ]);

    if (!confirm) {
      ui.showWarning('Transaction cancelled');
      await mainMenu(currentWalletName);
      return;
    }

    ui.showLoading('Broadcasting transaction...');
    const password = await ensureMasterPassword();
    const result = selectedToken?.type === 'spl'
      ? await walletService.sendSolanaTokenTransaction(selectedToken, answers.toAddress.trim(), answers.amount.trim(), password)
      : await walletService.sendSolanaTransaction(answers.toAddress.trim(), answers.amount.trim(), password);

    ui.showSuccess('Transaction broadcasted (pending confirmation)');
    console.log('');
    console.log(chalk.gray('Signature: ') + chalk.magenta(result.signature));
    console.log(chalk.gray('Fee:       ') + chalk.white(`${result.feeSol} ${nativeSymbol}`));

    const txUrl = `${solNetConfig.blockExplorer}/tx/${result.signature}${config.network === 'solana-devnet' ? '?cluster=devnet' : ''}`;
    console.log(chalk.gray('View:      ') + chalk.cyan(txUrl));
    console.log('');

    await inquirer.prompt<{ continue: string }>([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);

    await mainMenu(currentWalletName);
    return;
  }

  // TON send flow
  if (isTonNetwork(config.network)) {
    const tonNetConfig = config.networks[config.network];
    const nativeSymbol = tonNetConfig.nativeSymbol || 'TON';

    ui.showSection('Send TON');
    ui.showInfo('Press Ctrl+C to cancel at any time');
    console.log('');

    const answers = await inquirer.prompt<{
      toAddress?: string;
      amount?: string;
      comment?: string;
    }>([
      {
        type: 'input',
        name: 'toAddress',
        message: 'Recipient TON address (or leave empty to cancel):',
        validate: (input) => {
          if (!input || input.trim() === '') return true;
          if (!isValidTonAddress(input.trim())) {
            return 'Please enter a valid TON address (EQ... or UQ...)';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'amount',
        message: `Amount (in ${nativeSymbol}):`,
        when: (a) => !!a.toAddress && a.toAddress.trim() !== '',
        validate: (input) => {
          if (!input || input.trim() === '') return true;
          if (!/^\d+(\.\d+)?$/.test(input.trim())) return 'Enter a valid numeric amount';
          const num = parseFloat(input);
          if (isNaN(num) || num <= 0) return 'Amount must be greater than 0';
          if (input.includes('.') && input.split('.')[1].length > 9) return 'TON supports up to 9 decimals';
          return true;
        }
      },
      {
        type: 'input',
        name: 'comment',
        message: 'Comment (optional):',
        when: (a) => !!a.toAddress && a.toAddress.trim() !== '' && !!a.amount && a.amount.trim() !== '',
      }
    ]);

    if (!answers.toAddress || answers.toAddress.trim() === '' || !answers.amount || answers.amount.trim() === '') {
      ui.showWarning('Transaction cancelled');
      await mainMenu(currentWalletName);
      return;
    }

    ui.showLoading('Estimating network fee...');
    const tonToken = walletService.getNativeToken(config.network);
    const gasEstimate = await walletService.getGasEstimate(tonToken, answers.toAddress.trim(), answers.amount.trim());

    let tonPrice: number | null = null;
    try {
      tonPrice = await getTonPrice(config.network);
    } catch {
      tonPrice = null;
    }

    const { amountUsd, gasCostUsd, totalUsd } = calculateTransactionCosts(
      answers.amount.trim(),
      tonPrice,
      gasEstimate.estimatedCostNative,
      tonPrice
    );

    let currentBalance: string | null = null;
    try {
      currentBalance = await walletService.getBalance();
    } catch (error) {
      console.warn('[TON] Failed to read balance:', error);
    }

    ui.clearScreen();
    ui.showHeader(currentWalletName, wallet.currentAccountIndex, tonNetConfig.name || config.network, address);

    ui.showTransactionConfirmation({
      balance: currentBalance,
      balanceSymbol: nativeSymbol,
      tokenSymbol: nativeSymbol,
      amount: answers.amount.trim(),
      recipient: answers.toAddress.trim(),
      networkName: tonNetConfig.name || config.network,
      amountUsd,
      gasCostNative: gasEstimate.estimatedCostNative,
      nativeSymbol: gasEstimate.nativeSymbol,
      gasCostUsd,
      totalUsd,
      gasEstimateFailed: !!gasEstimate.error
    });

    if (answers.comment) {
      console.log(chalk.gray('Comment:             ') + chalk.gray(answers.comment));
      console.log('');
    }

    if (!gasEstimate.error) {
      console.log(chalk.gray('Fee:                 ') + chalk.white(`${gasEstimate.estimatedCostNative} ${nativeSymbol}`));
      console.log('');
    }

    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Confirm & Send?',
        default: false
      }
    ]);

    if (!confirm) {
      ui.showWarning('Transaction cancelled');
      await mainMenu(currentWalletName);
      return;
    }

    ui.showLoading('Broadcasting transaction to TON...');
    const password = await ensureMasterPassword();
    const result = await walletService.sendTonTransaction(
      answers.toAddress.trim(),
      answers.amount.trim(),
      password,
      answers.comment?.trim() || undefined
    );

    ui.showSuccess('Transaction broadcasted (pending confirmation)');
    console.log('');
    if (result.hash) {
      console.log(chalk.gray('Hash: ') + chalk.magenta(result.hash));
      const txUrl = walletService.getTonTransactionUrl(result.hash);
      if (txUrl) {
        console.log(chalk.gray('View: ') + chalk.cyan(txUrl));
      }
    } else {
      console.log(chalk.gray('Hash: ') + chalk.gray('Unavailable (Toncenter response)'));

      const scheduleTonHashRefresh = () => {
        const maxAttempts = 6;
        let attempts = 0;

        const poll = async () => {
          attempts += 1;
          try {
            const txs = await walletService.getTonTransactionHistory(10);
            const match = findTonTransaction(txs, {
              toAddress: answers.toAddress!.trim(),
              amountTon: answers.amount!.trim(),
              type: 'send'
            });
            if (match?.hash) {
              console.log(chalk.gray('Hash: ') + chalk.magenta(match.hash));
              const txUrl = walletService.getTonTransactionUrl(match.hash);
              if (txUrl) {
                console.log(chalk.gray('View: ') + chalk.cyan(txUrl));
              }
              console.log('');
              return;
            }
          } catch (error) {
            console.warn('[TON] Failed to refresh transaction hash:', error);
          }

          if (attempts < maxAttempts) {
            setTimeout(poll, 2000);
          }
        };

        setTimeout(poll, 2000);
      };

      scheduleTonHashRefresh();
    }
    console.log('');

    await inquirer.prompt<{ continue: string }>([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);

    await mainMenu(currentWalletName);
    return;
  }

  // XRP send flow
  if (isXRPNetwork(config.network)) {
    const xrpNetConfig = config.networks[config.network];
    const nativeSymbol = xrpNetConfig.nativeSymbol || 'XRP';

    ui.showSection('Send XRP');
    ui.showInfo('Press Ctrl+C to cancel at any time');
    console.log('');

    const answers = await inquirer.prompt<{
      toAddress?: string;
      amount?: string;
      destinationTag?: string;
    }>([
      {
        type: 'input',
        name: 'toAddress',
        message: 'Recipient XRP address (or leave empty to cancel):',
        validate: (input) => {
          if (!input || input.trim() === '') return true;
          if (!isValidXRPAddress(input.trim())) {
            return 'Please enter a valid XRP address (r... or X...)';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'amount',
        message: `Amount (in ${nativeSymbol}):`,
        when: (a) => !!a.toAddress && a.toAddress.trim() !== '',
        validate: (input) => {
          if (!input || input.trim() === '') return true;
          if (!/^\d+(\.\d+)?$/.test(input.trim())) return 'Enter a valid numeric amount';
          const num = parseFloat(input);
          if (isNaN(num) || num <= 0) return 'Amount must be greater than 0';
          if (input.includes('.') && input.split('.')[1].length > 6) return 'XRP supports up to 6 decimals';
          return true;
        }
      },
      {
        type: 'input',
        name: 'destinationTag',
        message: 'Destination tag (optional, for exchanges):',
        when: (a) => !!a.toAddress && a.toAddress.trim() !== '' && !!a.amount && a.amount.trim() !== '',
        validate: (input) => {
          if (!input || input.trim() === '') return true;
          if (!isValidDestinationTag(input.trim())) {
            return 'Destination tag must be a non-negative integer (0 to 4294967295)';
          }
          return true;
        }
      }
    ]);

    if (!answers.toAddress || answers.toAddress.trim() === '' || !answers.amount || answers.amount.trim() === '') {
      ui.showWarning('Transaction cancelled');
      await mainMenu(currentWalletName);
      return;
    }

    const destTag = answers.destinationTag?.trim();
    const destTagNum = destTag ? parseInt(destTag, 10) : undefined;

    // Preflight: reserve/spendable validation before confirmation + password prompt
    let xrpPreflight: Awaited<ReturnType<typeof walletService.estimateXRPTransaction>> | null = null;
    try {
      ui.showLoading('Checking XRP reserves and spendable balance...');
      xrpPreflight = await walletService.estimateXRPTransaction(
        answers.toAddress.trim(),
        answers.amount.trim(),
        destTagNum
      );
    } catch (error) {
      const err = error as Error;
      ui.showError('XRP send preflight failed', [err.message]);
      await inquirer.prompt<{ continue: string }>([{
        type: 'input',
        name: 'continue',
        message: 'Press Enter to continue...'
      }]);
      await mainMenu(currentWalletName);
      return;
    }

    ui.showLoading('Estimating network fee...');
    const xrpToken = walletService.getNativeToken(config.network);
    const gasEstimate = await walletService.getGasEstimate(xrpToken, answers.toAddress.trim(), answers.amount.trim());

    let xrpPrice: number | null = null;
    try {
      xrpPrice = await getXRPPrice(config.network);
    } catch {
      xrpPrice = null;
    }

    const { amountUsd, gasCostUsd, totalUsd } = calculateTransactionCosts(
      answers.amount.trim(),
      xrpPrice,
      gasEstimate.estimatedCostNative,
      xrpPrice
    );

    ui.clearScreen();
    ui.showHeader(currentWalletName, wallet.currentAccountIndex, xrpNetConfig.name || config.network, address);

    ui.showTransactionConfirmation({
      tokenSymbol: nativeSymbol,
      amount: answers.amount.trim(),
      recipient: answers.toAddress.trim(),
      networkName: xrpNetConfig.name || config.network,
      amountUsd,
      gasCostNative: gasEstimate.estimatedCostNative,
      nativeSymbol: gasEstimate.nativeSymbol,
      gasCostUsd,
      totalUsd,
      gasEstimateFailed: !!gasEstimate.error
    });

    // Show destination tag if provided
    if (destTag) {
      console.log(chalk.gray('Destination Tag:     ') + chalk.yellow(destTag));
      console.log('');
    }

    // Reserve/spendable warnings (XRP-specific)
    if (xrpPreflight) {
      console.log(chalk.gray('Spendable Balance:   ') + chalk.white(`${xrpPreflight.sender.availableXrp} ${nativeSymbol}`));
      console.log(chalk.gray('Reserved (min):      ') + chalk.gray(`${xrpPreflight.sender.reservedXrp} ${nativeSymbol}`));
      if (!xrpPreflight.sender.isActivated) {
        console.log(chalk.yellow('Warning: Your XRP account is not activated on-ledger yet.'));
      }
      console.log('');
    }

    if (!gasEstimate.error) {
      console.log(chalk.gray('Fee:                 ') + chalk.white(`${gasEstimate.estimatedCostNative} ${nativeSymbol}`));
      console.log('');
    }

    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Confirm & Send?',
        default: false
      }
    ]);

    if (!confirm) {
      ui.showWarning('Transaction cancelled');
      await mainMenu(currentWalletName);
      return;
    }

    ui.showLoading('Broadcasting transaction to XRP Ledger...');
    const password = await ensureMasterPassword();
    const result = await walletService.sendXRPTransaction(answers.toAddress.trim(), answers.amount.trim(), password, destTagNum);

    ui.showSuccess('Transaction broadcasted (pending validation)');
    console.log('');
    console.log(chalk.gray('Hash: ') + chalk.magenta(result.hash));
    console.log(chalk.gray('Fee:  ') + chalk.white(`${result.feeXrp} ${nativeSymbol}`));

    const txUrl = walletService.getXRPTransactionUrl(result.hash);
    if (txUrl) {
      console.log(chalk.gray('View: ') + chalk.cyan(txUrl));
    }
    console.log('');

    await inquirer.prompt<{ continue: string }>([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);

    await mainMenu(currentWalletName);
    return;
  }

  ui.showSection('Send Transaction');
  ui.showInfo('Press Ctrl+C to cancel at any time');
  console.log('');

  const tokens = walletService.getTokensForNetwork(config.network);
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

  const selectedToken = walletService.findTokenBySymbol(config.network, tokenSymbol);
  if (!selectedToken) {
    ui.showError('Token not found', []);
    await mainMenu(currentWalletName);
    return;
  }

  const answers = await inquirer.prompt<{
    toAddress?: string;
    amount?: string;
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
    }
  ]);

  // Check if user cancelled
  if (!answers.toAddress || answers.toAddress.trim() === '' ||
    !answers.amount || answers.amount.trim() === '') {
    ui.showWarning('Transaction cancelled');
    await mainMenu(currentWalletName);
    return;
  }

  // Fetch gas estimate and prices for confirmation screen
  ui.showLoading('Estimating transaction costs...');

  // TypeScript guard: Bitcoin networks return early above, so this is an EVM network
  const networkConfig = config.networks[config.network];
  const chainId = 'chainId' in networkConfig ? networkConfig.chainId : 1;
  const networkName = networkConfig.name || config.network;

  // Get gas estimate (we've already validated toAddress and amount are non-empty)
  const gasEstimate = await walletService.getGasEstimate(selectedToken, answers.toAddress!, answers.amount!);

  // Fetch token prices
  let tokenPrice: number | null = null;
  let nativePrice: number | null = null;

  try {
    nativePrice = await getNativeTokenPrice(chainId);
    if (selectedToken.type === 'native') {
      tokenPrice = nativePrice;
    } else if (selectedToken.address) {
      tokenPrice = await getERC20TokenPrice(chainId, selectedToken.address);
    }
  } catch {
    // Prices are optional - continue without them
  }

  // Calculate USD values using shared function
  const { amountUsd, gasCostUsd, totalUsd } = calculateTransactionCosts(
    answers.amount!,
    tokenPrice,
    gasEstimate.estimatedCostNative,
    nativePrice
  );

  // Display transaction confirmation screen
  ui.clearScreen();
  ui.showHeader(currentWalletName, wallet.currentAccountIndex, networkName, address);

  ui.showTransactionConfirmation({
    tokenSymbol: selectedToken.symbol,
    amount: answers.amount!,
    recipient: answers.toAddress!,
    networkName,
    amountUsd,
    gasCostNative: gasEstimate.estimatedCostNative,
    nativeSymbol: gasEstimate.nativeSymbol,
    gasCostUsd,
    totalUsd,
    gasEstimateFailed: !!gasEstimate.error
  });

  // Ask for final confirmation
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Confirm and send transaction?',
      default: false
    }
  ]);

  if (!confirm) {
    ui.showWarning('Transaction cancelled');
    await mainMenu(currentWalletName);
    return;
  }

  try {
    ui.showLoading('Sending transaction to the network...');
    const receipt = await walletService.sendToken(selectedToken, answers.toAddress, answers.amount);

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

/**
 * Displays the wallet's receive address with QR code.
 * Shows supported tokens for the current network.
 * 
 * @param currentWalletName - Name of the current wallet for header display
 */
async function showReceiveAddress(currentWalletName: string | null): Promise<void> {
  // Use walletService.getAddress() which handles both EVM and Bitcoin
  const address = walletService.getAddress();
  ui.clearScreen();
  ui.showHeader(currentWalletName, wallet.currentAccountIndex, config.networks[config.network].name, address);

  ui.showSection('Receive Crypto');

  // Show appropriate message based on network type
  if (isBitcoinNetwork(config.network)) {
    const symbol = config.networks[config.network].nativeSymbol;
    ui.showInfo(`Share this address to receive: ${symbol}`);
    console.log('');
    console.log(chalk.gray('  This is a Native SegWit (bech32) address'));
  } else {
    const tokens = walletService.getTokensForNetwork(config.network);
    const tokenSymbols = tokens.map(t => t.symbol).join(', ');
    ui.showInfo(`Share this address to receive: ${tokenSymbols}`);
  }
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

// ============================================================================
// Security Functions
// ============================================================================

/**
 * Reveals wallet secrets (private key and mnemonic).
 * Requires password re-entry for security even if password is cached.
 * Displays prominent security warnings about protecting the information.
 * 
 * @param currentWalletName - Name of the current wallet for header display
 */
async function showWalletSecrets(currentWalletName: string | null): Promise<void> {
  const address = walletService.getAddress();
  ui.clearScreen();
  ui.showHeader(currentWalletName, wallet.currentAccountIndex, config.networks[config.network].name, address);

  ui.showWarning('This will display sensitive information');
  ui.showWarning('Make sure no one is watching your screen');

  // Require password re-entry for security
  const password = await promptMasterPassword();

  try {
    const privateKey = wallet.getPrivateKey(password);
    let mnemonic: string | null = null;

    if (wallet.importType === 'mnemonic') {
      mnemonic = wallet.getMnemonic(password);
    }

    ui.clearScreen();
    ui.showHeader(currentWalletName, wallet.currentAccountIndex, config.networks[config.network].name, address);

    console.log(chalk.red.bold('⚠  KEEP THIS INFORMATION SECRET AND SECURE!\n'));

    ui.showSeparator();
    console.log(chalk.gray('Wallet:       ') + chalk.white(currentWalletName || 'Unknown'));
    console.log(chalk.gray('Address:      ') + ui.formatAddress(address));
    console.log(chalk.gray('Private Key:  ') + ui.formatTxHash(privateKey));
    ui.showSeparator();

    if (mnemonic) {
      console.log('');
      ui.showMnemonic(mnemonic);
    } else {
      console.log('');
      ui.showInfo('This wallet was imported from a private key. No mnemonic available.');
      console.log('');
    }

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

/**
 * Exports the current wallet to an encrypted backup file.
 * Prompts for destination path with default timestamped filename.
 * 
 * @param currentWalletName - Name of the wallet to export
 */
async function exportWallet(currentWalletName: string | null): Promise<void> {
  const address = walletService.getAddress();
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

// ============================================================================
// Token Management
// ============================================================================

/**
 * Token management menu for the current network.
 * Displays all tokens (built-in and custom) with options to add/remove.
 * 
 * @param currentWalletName - Name of the current wallet for header display
 */
async function manageTokens(currentWalletName: string | null): Promise<void> {
  const networkKey = config.network;
  const tokens = walletService.getTokensForNetwork(networkKey);

  ui.clearScreen();
  ui.showHeader(currentWalletName, wallet.currentAccountIndex, config.networks[networkKey].name, walletService.getAddress());

  ui.showSection('Manage Tokens');
  ui.showInfo(`Network: ${config.networks[networkKey].name}`);
  console.log('');

  const customTokensForNetwork = walletService.getCustomTokens(networkKey);
  tokens.forEach(token => {
    const source = customTokensForNetwork.some(t => t.address?.toLowerCase() === token.address?.toLowerCase()) ? 'custom' : 'built-in';
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

/**
 * Adds a custom ERC-20 token to the current network.
 * Attempts to auto-detect token metadata from the contract.
 * Falls back to manual entry if auto-detection fails.
 * 
 * @param networkKey - Network identifier to add the token to
 */
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
    metadata = await walletService.getTokenMetadata(checksummed);
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

  walletService.addCustomToken(networkKey, tokenToAdd);
  ui.showSuccess(`Added ${metadata.symbol} to ${config.networks[networkKey].name}`);
}

/**
 * Removes a user-added custom token from the current network.
 * Only allows removing custom tokens, not built-in tokens.
 * 
 * @param networkKey - Network identifier to remove the token from
 */
async function removeCustomToken(networkKey: string): Promise<void> {
  const custom = walletService.getCustomTokens(networkKey);
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

  walletService.removeCustomToken(networkKey, address);
  ui.showSuccess('Token removed.');
}

// ============================================================================
// Account Management
// ============================================================================

/**
 * Account management menu for the current wallet.
 * Shows all derived accounts with options to switch or create new ones.
 * Uses HD derivation path m/44'/60'/0'/0/index for each account.
 * 
 * @param currentWalletName - Name of the current wallet
 */
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

// ============================================================================
// Network Management
// ============================================================================

/**
 * Network switching menu.
 * Lists all configured networks and allows switching between them.
 * Optionally persists the change to config.json.
 */
async function changeNetwork(): Promise<void> {
  console.log('\n⚙️  Change Network\n');

  let showTestnets = config.showTestnets ?? false;

  while (true) {
    const visibleNetworks = getVisibleNetworkEntries(config.networks, {
      showTestnets,
      currentNetwork: config.network
    });
    const toggleLabel = showTestnets ? 'Hide Test Networks' : 'Show Test Networks';

    const { network } = await inquirer.prompt<{ network: string }>([
      {
        type: 'list',
        name: 'network',
        message: 'Select network:',
        choices: [
          ...visibleNetworks.map(([key, net]) => ({
            name: net.name,
            value: key
          })),
          new inquirer.Separator(''),
          { name: toggleLabel, value: '__toggle_testnets__' }
        ]
      }
    ]);

    if (network === '__toggle_testnets__') {
      showTestnets = !showTestnets;
      config.showTestnets = showTestnets;
      if (process.env.NODE_ENV !== 'test') {
        // Persist only user-state to the gitignored local file; never rewrite
        // the shipped config.json (which would embed the substituted
        // ${ALCHEMY_API_KEY} as a literal key).
        const existing = storage.readJSON<Record<string, unknown>>(LOCAL_STATE_PATH, {});
        storage.writeJSON(LOCAL_STATE_PATH, { ...existing, showTestnets });
      }
      console.log(`\n✅ Test networks ${showTestnets ? 'shown' : 'hidden'}\n`);
      continue;
    }

    try {
      await walletService.setNetwork(network, { persist: process.env.NODE_ENV !== 'test' });
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

    return;
  }
}

/**
 * Switches to a different saved wallet.
 * Opens the wallet selection menu.
 */
async function switchWallet(): Promise<void> {
  const existingWallets = wallet.getAllWallets();

  if (Object.keys(existingWallets).length > 0) {
    await selectWalletMenu(existingWallets);
  } else {
    console.log('\n⚠️  No other wallets found\n');
    await initialMenu();
  }
}

/**
 * Deletes the currently loaded wallet.
 * Requires user confirmation before deletion.
 * Cannot be undone - wallet data is permanently removed.
 * 
 * @param currentWalletName - Name of the wallet to delete
 */
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

// ============================================================================
// CLI Execution
// ============================================================================

/**
 * Run CLI only when not in test environment.
 * Tests import individual functions for isolated testing.
 */
if (process.env.NODE_ENV !== 'test') {
  main().catch(console.error);
}

// ============================================================================
// Test Exports
// ============================================================================

/**
 * Exported functions and instances for testing.
 * Allows tests to call individual menu functions and access wallet state.
 */
export {
  main,
  wallet,
  walletService,
  config,
  checkBalance,
  sendCrypto,
  showReceiveAddress,
  changeNetwork,
  manageTokens,
  checkPortfolioAllNetworks
};
