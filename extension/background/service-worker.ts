import '../../src/buffer-polyfill.js'; // Install Buffer polyfill
import { Wallet } from '../../src/wallet.js';
import { WalletAppService } from '../../src/app-service.js';
import { ChromeStorageAdapter } from '../../src/chrome-storage.js';
import { createProviderFactory } from '../../src/providers.js';
import { setCryptoAdapter } from '../../src/crypto-utils.js';
import { createWebCryptoAdapter } from '../../src/crypto-adapter.js';
import { TransactionHistoryManager, TransactionStatus, TransactionType } from '../../src/transaction-history.js';
import type { Config } from '../../src/types/index.js';

// Set up WebCrypto for browser environment
setCryptoAdapter(createWebCryptoAdapter());

// Wallet state
let walletService: WalletAppService | null = null;
let isUnlocked = false;
let currentWalletName = 'default'; // Track currently loaded wallet
let autoLockTimer: NodeJS.Timeout | null = null;
const AUTO_LOCK_TIMEOUT = 15 * 60 * 1000; // 15 minutes
let transactionHistory: TransactionHistoryManager | null = null;
let sessionPassword: string | null = null;

// Default configuration
const defaultConfig: Config & { network: string } = {
  network: 'sepolia',
  networks: {
    sepolia: {
      name: 'Sepolia Testnet',
      rpcUrl: 'https://rpc.sepolia.org',
      chainId: 11155111,
      nativeSymbol: 'ETH',
      nativeName: 'Sepolia Ether'
    },
    mainnet: {
      name: 'Ethereum Mainnet',
      rpcUrl: 'https://eth.llamarpc.com',
      chainId: 1,
      nativeSymbol: 'ETH',
      nativeName: 'Ether'
    },
    polygon: {
      name: 'Polygon',
      rpcUrl: 'https://polygon-rpc.com',
      chainId: 137,
      nativeSymbol: 'MATIC',
      nativeName: 'Polygon'
    },
    base: {
      name: 'Base',
      rpcUrl: 'https://mainnet.base.org',
      chainId: 8453,
      nativeSymbol: 'ETH',
      nativeName: 'Ether'
    }
  }
};

// Initialize wallet service
async function initializeWalletService(): Promise<void> {
  const storage = new ChromeStorageAdapter();
  await storage.initialize();

  // Load or use default config
  const config = storage.readJSON<Config & { network: string }>('config.json', defaultConfig);

  const wallet = new Wallet(config, storage, createProviderFactory());
  walletService = new WalletAppService(wallet, config, {
    storage,
    tokenListPath: 'tokens.json',
    customTokenPath: 'tokens-user.json',
    configPath: 'config.json'
  });

  await walletService.initialize();
}

// Auto-lock functionality
function resetAutoLockTimer(): void {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
  }

  autoLockTimer = setTimeout(() => {
    lockWallet();
  }, AUTO_LOCK_TIMEOUT);
}

function lockWallet(): void {
  isUnlocked = false;
  sessionPassword = null;
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }

  // Notify popup that wallet is locked
  chrome.runtime.sendMessage({ type: 'WALLET_LOCKED' }).catch(() => {
    // Ignore errors if popup is not open
  });
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(error => {
    sendResponse({ error: error.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message: any, sender: chrome.runtime.MessageSender): Promise<any> {
  const { type, payload } = message;

  // Initialize if needed
  if (!walletService) {
    await initializeWalletService();
  }

  switch (type) {
    case 'GET_STATE':
      return {
        isUnlocked,
        hasWallet: walletService!.getAllWallets() && Object.keys(walletService!.getAllWallets()).length > 0,
        network: walletService!.config.network,
        address: isUnlocked ? walletService!.getAddress() : null,
        currentWalletName: isUnlocked ? currentWalletName : null
      };

    case 'CREATE_WALLET':
      const walletName = payload.name || 'default';
      const createPassword = payload.password ?? sessionPassword;
      if (!createPassword) {
        throw new Error('Master password required');
      }
      sessionPassword = createPassword;
      const newWallet = walletService!.createWallet(createPassword);
      walletService!.saveWallet(walletName);
      currentWalletName = walletName;
      isUnlocked = true;

      // Initialize transaction history for this wallet
      const createStorage = await ChromeStorageAdapter.create();
      transactionHistory = new TransactionHistoryManager(createStorage, currentWalletName);

      resetAutoLockTimer();
      return {
        success: true,
        address: newWallet.address,
        mnemonic: newWallet.mnemonic
      };

    case 'IMPORT_WALLET':
      const importWalletName = payload.name || 'default';
      const importPassword = payload.password ?? sessionPassword;
      if (!importPassword) {
        throw new Error('Master password required');
      }
      sessionPassword = importPassword;
      const importedWallet = walletService!.importWallet(
        payload.mnemonic,
        importPassword,
        payload.accountIndex || 0
      );
      walletService!.saveWallet(importWalletName);
      currentWalletName = importWalletName;
      isUnlocked = true;

      // Initialize transaction history for this wallet
      const importStorage = await ChromeStorageAdapter.create();
      transactionHistory = new TransactionHistoryManager(importStorage, currentWalletName);

      resetAutoLockTimer();
      return {
        success: true,
        address: importedWallet.address
      };

    case 'UNLOCK_WALLET':
      const unlockWalletName = payload.name || 'default';
      const unlockPassword = payload.password ?? sessionPassword;
      const loaded = walletService!.loadWallet(unlockWalletName, unlockPassword);
      if (!loaded) {
        throw new Error('Invalid password or wallet not found');
      }
      sessionPassword = unlockPassword || null;
      currentWalletName = unlockWalletName;
      isUnlocked = true;

      // Initialize transaction history for this wallet
      const storage = await ChromeStorageAdapter.create();
      transactionHistory = new TransactionHistoryManager(storage, currentWalletName);

      resetAutoLockTimer();
      return {
        success: true,
        address: loaded.address,
        walletName: currentWalletName
      };

    case 'LOCK_WALLET':
      lockWallet();
      return { success: true };

    case 'GET_BALANCE':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const balance = await walletService!.getBalance();
      return { balance };

    case 'GET_PORTFOLIO':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const portfolio = await walletService!.getPortfolioForNetwork(walletService!.config.network);
      return { portfolio };

    case 'SEND_TRANSACTION':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();

      const fromAddress = walletService!.getAddress();
      const network = walletService!.config.network;

      try {
        const result = await walletService!.sendToken(
          payload.token,
          payload.toAddress,
          payload.amount
        );

        // Track transaction in history
        if (transactionHistory && result.hash) {
          transactionHistory.addTransaction({
            hash: result.hash,
            from: fromAddress,
            to: payload.toAddress,
            value: payload.amount,
            network: network,
            status: TransactionStatus.PENDING,
            type: TransactionType.SEND,
            timestamp: Date.now(),
            tokenSymbol: payload.token.symbol,
            tokenAddress: payload.token.address
          });

          // Start monitoring for confirmation
          monitorTransaction(result.hash, network);
        }

        return { result };
      } catch (error: any) {
        // If transaction was submitted but failed, still track it
        if (error.transactionHash) {
          transactionHistory?.addTransaction({
            hash: error.transactionHash,
            from: fromAddress,
            to: payload.toAddress,
            value: payload.amount,
            network: network,
            status: TransactionStatus.FAILED,
            type: TransactionType.SEND,
            timestamp: Date.now(),
            tokenSymbol: payload.token.symbol,
            tokenAddress: payload.token.address,
            error: error.message
          });
        }
        throw error;
      }

    case 'SWITCH_NETWORK':
      await walletService!.setNetwork(payload.network);
      return { success: true, network: payload.network };

    case 'GET_NETWORKS':
      return { networks: walletService!.config.networks };

    case 'GET_TRANSACTION_HISTORY':
      if (!isUnlocked) throw new Error('Wallet is locked');
      const transactions = transactionHistory?.getAllTransactions() || [];
      return { transactions };

    case 'GET_TRANSACTIONS_BY_NETWORK':
      if (!isUnlocked) throw new Error('Wallet is locked');
      const networkTxs = transactionHistory?.getTransactionsByNetwork(payload.network) || [];
      return { transactions: networkTxs };

    case 'ADD_CUSTOM_TOKEN':
      walletService!.addCustomToken(walletService!.config.network, payload.token);
      return { success: true };

    case 'GET_TOKENS':
      const tokens = walletService!.getTokensForNetwork(payload.network || walletService!.config.network);
      return { tokens };

    case 'GET_ADDRESS':
      if (!isUnlocked) throw new Error('Wallet is locked');
      return { address: walletService!.getAddress() };

    case 'GET_ACCOUNTS':
      if (!isUnlocked) throw new Error('Wallet is locked');
      const accounts = walletService!.getWalletAccounts(currentWalletName);
      const currentAccountIndex = walletService!.getCurrentAccountIndex();
      return { accounts, currentWalletName, currentAccountIndex };

    case 'CREATE_ACCOUNT':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const currentAccounts = walletService!.getWalletAccounts(currentWalletName);
      const nextIndex = Object.keys(currentAccounts).length;
      const newAccount = walletService!.switchAccount(nextIndex);
      walletService!.saveWallet(currentWalletName);
      return { success: true, address: newAccount.address, index: newAccount.accountIndex };

    case 'SWITCH_ACCOUNT':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const switchedAccount = walletService!.switchAccount(payload.index);
      walletService!.saveWallet(currentWalletName); // Save the wallet with new active account
      return { success: true, address: switchedAccount.address, index: switchedAccount.accountIndex };

    case 'GET_ALL_WALLETS':
      // Allow getting wallet list even when locked (needed for unlock screen)
      const allWallets = walletService!.getAllWallets();
      return { wallets: allWallets };

    case 'DELETE_WALLET':
      if (!isUnlocked) throw new Error('Wallet is locked');
      const deleted = walletService!.deleteWallet(payload.name);
      return { success: deleted };

    // dApp provider methods
    case 'ETH_ACCOUNTS':
      if (!isUnlocked) return { accounts: [] };
      resetAutoLockTimer();
      return { accounts: [walletService!.getAddress()] };

    case 'ETH_REQUEST_ACCOUNTS':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      // TODO: Show connection approval popup
      return { accounts: [walletService!.getAddress()] };

    case 'ETH_CHAIN_ID':
      const networkConfig = walletService!.config.networks[walletService!.config.network];
      return { chainId: '0x' + networkConfig.chainId.toString(16) };

    case 'ETH_SEND_TRANSACTION':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      // TODO: Show transaction approval popup
      // For now, this is a placeholder
      throw new Error('Transaction approval UI not implemented yet');

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

// Monitor transaction for confirmation
async function monitorTransaction(txHash: string, network: string) {
  if (!walletService || !transactionHistory) return;

  const maxAttempts = 60; // Monitor for up to 5 minutes (60 * 5 seconds)
  let attempts = 0;

  const checkTransaction = async () => {
    try {
      const provider = walletService!.wallet?.provider;
      if (!provider) return;

      const receipt = await provider.getTransactionReceipt(txHash);

      if (receipt) {
        // Transaction confirmed
        const status = receipt.status === 1 ? TransactionStatus.CONFIRMED : TransactionStatus.FAILED;

        transactionHistory!.updateTransactionStatus(
          txHash,
          status,
          receipt.blockNumber,
          receipt.status === 0 ? 'Transaction reverted' : undefined
        );

        console.log(`Transaction ${txHash} ${status}`);
      } else if (attempts < maxAttempts) {
        // Still pending, check again in 5 seconds
        attempts++;
        setTimeout(checkTransaction, 5000);
      }
    } catch (error) {
      console.error('Error monitoring transaction:', error);
      // Retry on error
      if (attempts < maxAttempts) {
        attempts++;
        setTimeout(checkTransaction, 5000);
      }
    }
  };

  // Start monitoring
  setTimeout(checkTransaction, 5000);
}

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('Simple Crypto Wallet extension installed');
  initializeWalletService();
});

// Initialize on startup
initializeWalletService();

console.log('Simple Crypto Wallet background service worker loaded');
