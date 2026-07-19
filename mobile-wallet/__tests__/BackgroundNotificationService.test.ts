import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import { mobileStorage } from '../services/MobileStorageAdapter';

// -----------------------------------------------------------------------------
// Mocks Setup
// -----------------------------------------------------------------------------

// 1. Mock expo-task-manager
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(),
}));

// 2. Mock expo-background-fetch
jest.mock('expo-background-fetch', () => ({
  registerTaskAsync: jest.fn(),
  unregisterTaskAsync: jest.fn(),
  BackgroundFetchResult: {
    NoData: 1,
    NewData: 2,
    Failed: 3,
  },
}));

// 3. Mock expo-notifications
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));

// 4. Mock MobileStorageAdapter
jest.mock('../services/MobileStorageAdapter', () => ({
  mobileStorage: {
    initialize: jest.fn(),
    readJSON: jest.fn(),
    writeJSON: jest.fn(),
  },
}));

// 5. Mock Explorer API
// Note: The service uses require() dynamically, so we mock the module path.
jest.mock('@wallet/explorer-api', () => ({
  explorerAPI: {
    isSupported: jest.fn().mockReturnValue(true), // Default to true
    registerNetwork: jest.fn(),
    getAllTransactions: jest.fn(),
  },
}), { virtual: true });

// 6. Mock bundled-config
jest.mock('../config/bundled-config', () => ({
  getBundledConfig: () => ({
    networks: {
      sepolia: {
        chainId: 11155111,
        explorerApiUrl: 'https://api-sepolia.etherscan.io',
        explorerApiKey: 'test-key',
      },
      mainnet: {
        chainId: 1,
        explorerApiUrl: 'https://api.etherscan.io',
      }
    },
  }),
  getAlchemyApiKey: () => undefined,
  setRuntimeAlchemyKey: jest.fn(),
}));

// Import the service AFTER mocks are set up.
// This triggers the top-level TaskManager.defineTask call.
import { BackgroundNotificationService } from '../services/BackgroundNotificationService';

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('BackgroundNotificationService', () => {
  const BACKGROUND_TX_TASK = 'BACKGROUND_TX_CHECK';
  let taskCallback: () => Promise<number>;

  // Get the task callback that was registered
  beforeAll(() => {
    // Expect defineTask to have been called once with our task name
    expect(TaskManager.defineTask).toHaveBeenCalledWith(
      BACKGROUND_TX_TASK,
      expect.any(Function)
    );
    // Capture the callback for testing
    taskCallback = (TaskManager.defineTask as jest.Mock).mock.calls.find(
      call => call[0] === BACKGROUND_TX_TASK
    )[1];
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock behavior
    (mobileStorage.readJSON as jest.Mock).mockImplementation((key, def) => def);
    // Default explorer API behavior
    const { explorerAPI } = require('@wallet/explorer-api');
    explorerAPI.getAllTransactions.mockResolvedValue([]);
    explorerAPI.isSupported.mockReturnValue(true);
  });

  describe('Task Execution', () => {
    it('should return NoData if no wallets are found', async () => {
      (mobileStorage.readJSON as jest.Mock).mockImplementation((key, def) => {
        if (key === 'wallets.json') return {};
        return def;
      });

      const result = await taskCallback();
      expect(result).toBe(BackgroundFetch.BackgroundFetchResult.NoData);
      expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it('should return NoData if no address is found', async () => {
       (mobileStorage.readJSON as jest.Mock).mockImplementation((key, def) => {
        if (key === 'wallets.json') return { 'Wallet 1': { address: '' } }; // Empty address
        return def;
      });

      const result = await taskCallback();
      expect(result).toBe(BackgroundFetch.BackgroundFetchResult.NoData);
    });
    
    it('should skip network registration if already supported', async () => {
      // Setup wallet
      (mobileStorage.readJSON as jest.Mock).mockImplementation((key, def) => {
        if (key === 'wallets.json') return { 'Wallet 1': { address: '0x123' } };
        if (key === 'config.json') return { network: 'sepolia' };
        return def;
      });

      const { explorerAPI } = require('@wallet/explorer-api');
      explorerAPI.isSupported.mockReturnValue(true); // Already supported

      await taskCallback();

      expect(explorerAPI.registerNetwork).not.toHaveBeenCalled();
    });

    it('should register network if not supported and config exists', async () => {
      // Setup wallet
      (mobileStorage.readJSON as jest.Mock).mockImplementation((key, def) => {
        if (key === 'wallets.json') return { 'Wallet 1': { address: '0x123' } };
        if (key === 'config.json') return { network: 'sepolia' };
        return def;
      });

      const { explorerAPI } = require('@wallet/explorer-api');
      explorerAPI.isSupported.mockReturnValue(false); // Not supported yet

      await taskCallback();

      expect(explorerAPI.registerNetwork).toHaveBeenCalledWith(
        'sepolia',
        'https://api-sepolia.etherscan.io',
        11155111,
        'test-key'
      );
    });

    it('should return NoData if no transactions found', async () => {
      (mobileStorage.readJSON as jest.Mock).mockImplementation((key, def) => {
        if (key === 'wallets.json') return { 'Wallet 1': { address: '0x123' } };
        if (key === 'config.json') return { network: 'sepolia' };
        return def;
      });

      const { explorerAPI } = require('@wallet/explorer-api');
      explorerAPI.getAllTransactions.mockResolvedValue([]);

      const result = await taskCallback();
      expect(result).toBe(BackgroundFetch.BackgroundFetchResult.NoData);
    });

    it('should return NoData if latest transaction matches stored hash', async () => {
      const mockTx = { hash: '0xabc', from: '0x123', value: '0.1', tokenSymbol: 'ETH' };
      
      (mobileStorage.readJSON as jest.Mock).mockImplementation((key, def) => {
        if (key === 'wallets.json') return { 'Wallet 1': { address: '0x123' } };
        if (key === 'last_notification_tx_hash') return '0xabc'; // Matches
        if (key === 'config.json') return { network: 'sepolia' };
        return def;
      });

      const { explorerAPI } = require('@wallet/explorer-api');
      explorerAPI.getAllTransactions.mockResolvedValue([mockTx]);

      const result = await taskCallback();
      expect(result).toBe(BackgroundFetch.BackgroundFetchResult.NoData);
      expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it('should return NewData and schedule notification if new transaction found', async () => {
      // Mock Wei value: 0.5 ETH = 500000000000000000 Wei
      const mockTx = { hash: '0xnew', from: '0xothers', value: '500000000000000000', tokenSymbol: 'ETH' };
      
      (mobileStorage.readJSON as jest.Mock).mockImplementation((key, def) => {
        if (key === 'wallets.json') return { 'Wallet 1': { address: '0x123' } };
        if (key === 'last_notification_tx_hash') return '0xold'; // Different
        if (key === 'config.json') return { network: 'sepolia' };
        return def;
      });

      const { explorerAPI } = require('@wallet/explorer-api');
      explorerAPI.getAllTransactions.mockResolvedValue([mockTx]);

      const result = await taskCallback();
      
      // Verify result
      expect(result).toBe(BackgroundFetch.BackgroundFetchResult.NewData);
      
      // Verify notification (should be formatted to 0.5)
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.objectContaining({
          title: 'Transaction Received',
          body: 'You received 0.5 ETH',
          data: { hash: '0xnew', network: 'sepolia' }
        })
      }));

      // Verify storage update happens AFTER notification
      // Note: In a real unit test with mocked async functions, strict ordering check 
      // is hard without spy execution order, but we can checks call counts.
      expect(mobileStorage.writeJSON).toHaveBeenCalledWith('last_notification_tx_hash', '0xnew');
    });

    it('should handle "Sent" notifications correctly', async () => {
      const myAddress = '0x123';
      // Mock Wei value: 0.1 ETH
      const mockTx = { hash: '0xnew', from: myAddress, value: '100000000000000000', tokenSymbol: 'ETH' };
      
      (mobileStorage.readJSON as jest.Mock).mockImplementation((key, def) => {
        if (key === 'wallets.json') return { 'Wallet 1': { address: myAddress } };
        if (key === 'last_notification_tx_hash') return null;
        if (key === 'config.json') return { network: 'sepolia' };
        return def;
      });

      const { explorerAPI } = require('@wallet/explorer-api');
      explorerAPI.getAllTransactions.mockResolvedValue([mockTx]);

      await taskCallback();
      
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.objectContaining({
          title: 'Transaction Sent',
          body: 'You sent 0.1 ETH',
        })
      }));
    });

    it('should support custom networks from config.json', async () => {
      // Custom network setup
      const customNetwork = 'my-custom-chain';
      (mobileStorage.readJSON as jest.Mock).mockImplementation((key, def) => {
        if (key === 'wallets.json') return { 'Wallet 1': { address: '0x123' } };
        if (key === 'config.json') return { 
          network: customNetwork,
          networks: {
             [customNetwork]: {
               chainId: 12345,
               explorerApiUrl: 'https://custom-explorer.com'
             }
          }
        };
        return def;
      });

      const { explorerAPI } = require('@wallet/explorer-api');
      explorerAPI.isSupported.mockReturnValue(false); 

      await taskCallback();

      // Should register the custom network
      expect(explorerAPI.registerNetwork).toHaveBeenCalledWith(
        customNetwork,
        'https://custom-explorer.com',
        12345,
        undefined
      );
    });
  });

  describe('Service Methods', () => {
    it('should register task if not already registered', async () => {
      (TaskManager.isTaskRegisteredAsync as jest.Mock).mockResolvedValue(false);
      
      await BackgroundNotificationService.register();
      
      expect(BackgroundFetch.registerTaskAsync).toHaveBeenCalledWith(
        BACKGROUND_TX_TASK,
        expect.objectContaining({
          minimumInterval: 15 * 60,
          stopOnTerminate: false,
          startOnBoot: true,
        })
      );
    });

    it('should not register task if already registered', async () => {
      (TaskManager.isTaskRegisteredAsync as jest.Mock).mockResolvedValue(true);
      
      await BackgroundNotificationService.register();
      
      expect(BackgroundFetch.registerTaskAsync).not.toHaveBeenCalled();
    });

    it('should unregister task', async () => {
      await BackgroundNotificationService.unregister();
      expect(BackgroundFetch.unregisterTaskAsync).toHaveBeenCalledWith(BACKGROUND_TX_TASK);
    });
  });
});
