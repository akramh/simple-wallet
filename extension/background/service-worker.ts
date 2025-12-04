import '../../src/buffer-polyfill.js'; // Install Buffer polyfill
import { Wallet } from '../../src/wallet.js';
import { WalletAppService } from '../../src/app-service.js';
import { ChromeStorageAdapter } from '../../src/chrome-storage.js';
import { createProviderFactory } from '../../src/providers.js';
import { setCryptoAdapter } from '../../src/crypto-utils.js';
import { createWebCryptoAdapter } from '../../src/crypto-adapter.js';
import type { Config } from '../../src/types/index.js';

// Set up WebCrypto for browser environment
setCryptoAdapter(createWebCryptoAdapter());

// Wallet state
let walletService: WalletAppService | null = null;
let isUnlocked = false;
let autoLockTimer: NodeJS.Timeout | null = null;
const AUTO_LOCK_TIMEOUT = 15 * 60 * 1000; // 15 minutes

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
        address: isUnlocked ? walletService!.getAddress() : null
      };

    case 'CREATE_WALLET':
      const newWallet = walletService!.createWallet(payload.password);
      walletService!.saveWallet(payload.name || 'default');
      isUnlocked = true;
      resetAutoLockTimer();
      return {
        success: true,
        address: newWallet.address,
        mnemonic: newWallet.mnemonic
      };

    case 'IMPORT_WALLET':
      const importedWallet = walletService!.importWallet(
        payload.mnemonic,
        payload.password,
        payload.accountIndex || 0
      );
      walletService!.saveWallet(payload.name || 'default');
      isUnlocked = true;
      resetAutoLockTimer();
      return {
        success: true,
        address: importedWallet.address
      };

    case 'UNLOCK_WALLET':
      const loaded = walletService!.loadWallet(payload.name || 'default', payload.password);
      if (!loaded) {
        throw new Error('Invalid password or wallet not found');
      }
      isUnlocked = true;
      resetAutoLockTimer();
      return {
        success: true,
        address: loaded.address
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
      const result = await walletService!.sendToken(
        payload.token,
        payload.toAddress,
        payload.amount
      );
      return { result };

    case 'SWITCH_NETWORK':
      await walletService!.setNetwork(payload.network);
      return { success: true, network: payload.network };

    case 'GET_NETWORKS':
      return { networks: walletService!.config.networks };

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
      const accounts = walletService!.getWalletAccounts('default');
      return { accounts };

    case 'CREATE_ACCOUNT':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const currentAccounts = walletService!.getWalletAccounts('default');
      const nextIndex = Object.keys(currentAccounts).length;
      const newAccount = walletService!.switchAccount(nextIndex);
      walletService!.saveWallet('default');
      return { success: true, address: newAccount.address, index: newAccount.accountIndex };

    case 'SWITCH_ACCOUNT':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const switchedAccount = walletService!.switchAccount(payload.index);
      return { success: true, address: switchedAccount.address, index: switchedAccount.accountIndex };

    case 'GET_ALL_WALLETS':
      if (!isUnlocked) throw new Error('Wallet is locked');
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

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('Simple Crypto Wallet extension installed');
  initializeWalletService();
});

// Initialize on startup
initializeWalletService();

console.log('Simple Crypto Wallet background service worker loaded');
