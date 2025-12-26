/**
 * @fileoverview Service for handling background transaction checks and notifications.
 *
 * This service runs in the background (via expo-background-fetch) to check for new
 * transactions without requiring the user to open the app or unlock the wallet.
 *
 * It uses a "read-only" approach:
 * 1. Reads public address from storage (no password needed)
 * 2. Fetches public transaction history via ExplorerAPI
 * 3. Compares with last known hash
 * 4. Triggers local notification if new tx found
 */

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { mobileStorage } from './MobileStorageAdapter';
import { getBundledConfig } from '../config/bundled-config';

const BACKGROUND_TX_TASK = 'BACKGROUND_TX_CHECK';
const LAST_TX_HASH_KEY = 'last_notification_tx_hash';

// Define the task in global scope
TaskManager.defineTask(BACKGROUND_TX_TASK, async () => {
  try {
    console.log('[BackgroundService] Starting background check...');
    
    // 1. Initialize storage to read persisted data
    await mobileStorage.initialize();

    // 2. Get active wallet address
    // We read raw wallets.json because we don't have the password to unlock the full Wallet class
    const wallets = mobileStorage.readJSON<Record<string, any>>('wallets.json', {});
    const walletNames = Object.keys(wallets);
    if (walletNames.length === 0) {
      console.log('[BackgroundService] No wallets found, skipping.');
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Use the last active wallet or the first one
    const lastWalletName = mobileStorage.readJSON<string>('last_wallet_name', walletNames[0]);
    const walletData = wallets[lastWalletName] || wallets[walletNames[0]];
    
    // Get address (default to account 0)
    // Note: This logic assumes EVM for now. 
    // TODO: robust multi-chain address resolution without Wallet class
    const address = walletData.accounts?.[0]?.address || walletData.address;
    
    if (!address) {
      console.log('[BackgroundService] No address found, skipping.');
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // 3. Get current network
    const storageConfig = mobileStorage.readJSON<{ network: string }>('config.json', { network: 'sepolia' });
    const network = storageConfig.network;

    console.log(`[BackgroundService] Checking ${network} for ${address.slice(0, 6)}...`);

    // 4. Configure Explorer API
    const { explorerAPI } = require('@wallet/explorer-api');
    const bundledConfig = getBundledConfig();
    const networkConfig = bundledConfig.networks[network];

    // Register network if needed (critical fix for "No explorer configured")
    if (networkConfig?.explorerApiUrl && networkConfig?.chainId) {
      // Check if already supported to avoid duplicate registration warnings if explorerAPI state persists
      if (!explorerAPI.isSupported(network)) {
        explorerAPI.registerNetwork(
          network,
          networkConfig.explorerApiUrl,
          networkConfig.chainId,
          networkConfig.explorerApiKey
        );
      }
    } else {
      console.log(`[BackgroundService] Network ${network} missing explorer config, skipping.`);
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // 5. Fetch latest transactions
    console.log('[BackgroundService] Fetching transactions via ExplorerAPI...');
    const txs = await explorerAPI.getAllTransactions(address, network, 1, 1);
    
    console.log(`[BackgroundService] Found ${txs?.length || 0} transactions.`);
    
    if (!txs || txs.length === 0) {
      console.log('[BackgroundService] No transactions found.');
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const latestTx = txs[0];
    const latestHash = latestTx.hash;

    // 6. Compare with last known hash
    const lastHash = mobileStorage.readJSON<string | null>(LAST_TX_HASH_KEY, null);
    
    console.log(`[BackgroundService] Latest Hash: ${latestHash.slice(0, 10)}...`);
    console.log(`[BackgroundService] Stored Hash: ${lastHash ? lastHash.slice(0, 10) + '...' : 'null'}`);

    if (lastHash !== latestHash) {
      console.log('[BackgroundService] New transaction detected! Triggering notification.');
      
      // Update storage
      mobileStorage.writeJSON(LAST_TX_HASH_KEY, latestHash);

      // 7. Schedule Notification
      const fromAddr = latestTx.from || '';
      const type = fromAddr.toLowerCase() === address.toLowerCase() ? 'Sent' : 'Received';
      const symbol = latestTx.tokenSymbol || 'ETH';
      
      // Format amount with max 6 decimals to prevent overflow
      let formattedAmount = '0';
      try {
        const val = parseFloat(latestTx.value || '0');
        formattedAmount = Number.isFinite(val) ? val.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '0';
      } catch (e) {
        formattedAmount = latestTx.value || '0';
      }
      
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `Transaction ${type}`,
          body: `You ${type.toLowerCase()} ${formattedAmount} ${symbol}`,
          data: { hash: latestHash, network },
        },
        trigger: null, // show immediately
      });
      console.log('[BackgroundService] Notification scheduled.');

      return BackgroundFetch.BackgroundFetchResult.NewData;
    } else {
      console.log('[BackgroundService] Hash matches stored hash. No new transaction.');
    }

    return BackgroundFetch.BackgroundFetchResult.NoData;

  } catch (error) {
    console.error('[BackgroundService] Task failed:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export class BackgroundNotificationService {
  /**
   * Register the background fetch task.
   * Should be called when the app starts.
   */
  static async register() {
    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TX_TASK);
      if (isRegistered) {
        console.log('[BackgroundService] Task already registered');
        return;
      }

      console.log('[BackgroundService] Registering task...');
      await BackgroundFetch.registerTaskAsync(BACKGROUND_TX_TASK, {
        minimumInterval: 15 * 60, // 15 minutes
        stopOnTerminate: false,   // Continue after app kill (Android only)
        startOnBoot: true,        // Restart on boot (Android only)
      });
      console.log('[BackgroundService] Task registered successfully');
    } catch (err) {
      console.error('[BackgroundService] Register failed:', err);
    }
  }

  /**
   * Unregister the task (e.g. on logout)
   */
  static async unregister() {
    try {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_TX_TASK);
    } catch (err) {
      console.error('[BackgroundService] Unregister failed:', err);
    }
  }
  
  /**
   * Request notification permissions
   */
  static async requestPermissions() {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    return finalStatus === 'granted';
  }
}
