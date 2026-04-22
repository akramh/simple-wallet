/**
 * @fileoverview Main wallet UI for the browser extension popup.
 *
 * Handles portfolio display, network selection, send/receive flows,
 * and activity history for the active account.
 *
 * @responsibilities
 * - Render account balances, activity, and send/receive screens
 * - Coordinate network selection and visibility preferences
 *
 * @security
 * - Delegates all sensitive operations to the background service worker
 */
import React, { useState, useEffect, useMemo } from 'react';
import SettingsView from './SettingsView';
import Header from './Header';
import AccountMenu from './AccountMenu';
import ReceiveView from './ReceiveView';
import ActivityView from './ActivityView';
import AddTokenModal from './AddTokenModal';
import AssetPickerModal, { type SendableAsset } from './AssetPickerModal';
import SendTransactionView from './SendTransactionView';
import TokenDetailsScreen from './TokenDetailsScreen';
import Identicon from './ui/Identicon';
import NetworkSelector from './ui/NetworkSelector';
import { ScreenHeader } from './ui';
import BalanceCard from './wallet/BalanceCard';
import TokenList from './wallet/TokenList';
import type { TokenRow } from './wallet/TokenList';
import PortfolioHero from './wallet/PortfolioHero';
import TokenRowSkeleton from './wallet/TokenRowSkeleton';
import EmptyPortfolio from './wallet/EmptyPortfolio';
import PortfolioErrorBanner from './wallet/PortfolioErrorBanner';
import SortModal from './wallet/SortModal';
import { useUnifiedPortfolio } from '../hooks/useUnifiedPortfolio';
import { useUserPreferences } from '../hooks/useUserPreferences';
import { getChainBadgeIcon } from '../utils/chainBadge';
import { sendMessageWithRetry } from '../utils/messaging';
import ethIcon from '../../assets/img/eth_logo.svg';
import { useToast } from '../context/ToastContext';
import bnbIcon from '../../assets/img/bnb.svg';
import solIcon from '../../assets/img/solana-logo.svg';
import avaxIcon from '../../assets/img/avax-token.svg';
import arbitrumIcon from '../../assets/img/arbitrum.svg';
import baseIcon from '../../assets/img/base.svg';
import lineaIcon from '../../assets/img/linea-logo-mainnet.svg';
import optimismIcon from '../../assets/img/optimism-logo.svg';
import usdcIcon from '../../assets/img/icon-usdc.png';
import usdtIcon from '../../assets/img/usdt.svg';
import usdtGoldIcon from '../../assets/img/usdt-gold.svg';
import polIcon from '../../assets/img/pol-token.svg';
import bitcoinIcon from '../../assets/img/bitcoin-logo.svg';
import xrpIcon from '../../assets/img/xrp.svg';
import tonIcon from '../../assets/img/ton_symbol.svg';
import raydiumIcon from '../../assets/img/raydium-ray-logo.svg';
import { isValidBitcoinAddress } from '../../../src/bitcoin/index.js';
import { isValidTonAddress } from '../../../src/ton/index.js';
import { isValidXRPAddress, isXAddress, isValidDestinationTag } from '../../../src/xrp/index.js';
import { getVisibleNetworkEntries } from '../../../src/network-visibility.js';
import type { Token } from '../../../src/types/token.js';
import { formatBalance, getTokenPriceKey } from '../utils/tokenFormat';

const ICON_ASSETS: Record<string, string> = {
  'eth_logo.svg': ethIcon,
  'bnb.svg': bnbIcon,
  'solana-logo.svg': solIcon,
  'avax-token.svg': avaxIcon,
  'arbitrum.svg': arbitrumIcon,
  'base.svg': baseIcon,
  'linea-logo-mainnet.svg': lineaIcon,
  'optimism-logo.svg': optimismIcon,
  'icon-usdc.png': usdcIcon,
  'usdt.svg': usdtIcon,
  'usdt-gold.svg': usdtGoldIcon,
  'pol-token.svg': polIcon,
  'xrp.svg': xrpIcon,
  'ton_symbol.svg': tonIcon,
  'raydium-ray-logo.svg': raydiumIcon,
  // Backwards-compatible aliases used by existing token lists/configs.
  'bitcoin-logo.svg': bitcoinIcon,
  'btc.svg': bitcoinIcon
};

const SYMBOL_ICON_FALLBACK: Record<string, string> = {
  eth: 'eth_logo.svg',
  weth: 'eth_logo.svg',
  bnb: 'bnb.svg',
  wbnb: 'bnb.svg',
  sol: 'solana-logo.svg',
  avax: 'avax-token.svg',
  wavax: 'avax-token.svg',
  arb: 'arbitrum.svg',
  base: 'base.svg',
  linea: 'linea-logo-mainnet.svg',
  usdc: 'icon-usdc.png',
  usdt: 'usdt.svg',
  xaut: 'usdt-gold.svg',
  ray: 'raydium-ray-logo.svg',
  pol: 'pol-token.svg',
  matic: 'pol-token.svg',
  btc: 'bitcoin-logo.svg',
  tbtc: 'bitcoin-logo.svg',
  xrp: 'xrp.svg',
  txrp: 'xrp.svg',
  ton: 'ton_symbol.svg',
  tton: 'ton_symbol.svg'
};

/**
 * Helper to check if network key is a Bitcoin network
 */
function isBitcoinNetwork(networkKey: string): boolean {
  return networkKey.startsWith('bitcoin-');
}

function isSolanaNetwork(networkKey: string): boolean {
  return networkKey.startsWith('solana-');
}

function isXrpNetwork(networkKey: string): boolean {
  return networkKey.startsWith('xrp-');
}

function isTonNetwork(networkKey: string): boolean {
  return networkKey.startsWith('ton-');
}

function isEvmNetwork(networkKey: string): boolean {
  return !isBitcoinNetwork(networkKey) && !isSolanaNetwork(networkKey) && !isXrpNetwork(networkKey) && !isTonNetwork(networkKey);
}

/**
 * Map of private key types to compatible network type checks.
 */
const CHAIN_TYPE_COMPATIBILITY: Record<string, (networkKey: string) => boolean> = {
  evm: isEvmNetwork,
  bitcoin: isBitcoinNetwork,
  solana: isSolanaNetwork,
  xrp: isXrpNetwork,
  ton: isTonNetwork
};

/**
 * Check if a network should be disabled for the current wallet.
 * Networks are disabled when using a private key import that only supports specific chains.
 */
function isNetworkDisabled(
  networkKey: string,
  importType?: 'mnemonic' | 'privateKey' | null,
  privateKeyType?: 'evm' | 'bitcoin' | 'solana' | 'xrp' | 'ton' | null
): boolean {
  // Mnemonic-based wallets support all networks
  if (!importType || importType !== 'privateKey' || !privateKeyType) {
    return false;
  }
  
  // Check if network is compatible with the private key type
  const isCompatible = CHAIN_TYPE_COMPATIBILITY[privateKeyType];
  return isCompatible ? !isCompatible(networkKey) : false;
}

function isValidRecipientAddress(networkKey: string, address: string): boolean {
  if (isBitcoinNetwork(networkKey)) {
    const btcNetwork = networkKey === 'bitcoin-mainnet' ? 'mainnet' : 'testnet';
    return isValidBitcoinAddress(address, btcNetwork);
  }
  if (isSolanaNetwork(networkKey)) {
    // Basic Solana base58 public key validation (length/range).
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }
  if (isXrpNetwork(networkKey)) {
    // Only classic addresses are supported for now (r...). X-addresses are detected for better UX.
    if (isXAddress(address)) return false;
    return isValidXRPAddress(address);
  }
  if (isTonNetwork(networkKey)) {
    return isValidTonAddress(address);
  }
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

interface Props {
  address: string;
  network: string;
  /**
   * Active wallet identity propagated from App-level state so the unified
   * portfolio hook and the account header update in lock-step with `network`
   * and `address`. When the service worker fires WALLET_CONTEXT_CHANGED, all
   * three flip together in a single App `setState` and re-render — avoiding
   * the transient mismatch between new walletName and old network that caused
   * the visible flash on wallet switch/import.
   */
  walletName?: string | null;
  importType?: 'mnemonic' | 'privateKey' | null;
  privateKeyType?: 'evm' | 'bitcoin' | 'solana' | 'xrp' | 'ton' | null;
  onLock: () => void;
  onStateChange?: () => void;
}

interface TokenBalance {
  token: Token;
  balance: string;
  error?: string;
  // XRP portfolio fields (optional)
  availableBalance?: string;
  reservedBalance?: string;
  isActivated?: boolean;
}

type View = 'tokens' | 'activity' | 'receive' | 'send' | 'settings' | 'tokenDetails';

interface TokenWithBalance {
  token: Token;
  balance: string | null;
  lastUpdated: number | null;
  isLoading: boolean;
}

/**
 * Main wallet container for the extension popup.
 *
 * @param props - Component props
 * @returns Main wallet UI
 */
function MainWallet({ address, network, walletName, importType, privateKeyType, onLock, onStateChange }: Props) {
  const { showToast } = useToast();
  const notifyStateChange = () => {
    if (onStateChange) {
      onStateChange();
    }
  };

  const [view, setView] = useState<View>('tokens');
  const [portfolio, setPortfolio] = useState<TokenBalance[]>([]);
  const [networks, setNetworks] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showAddToken, setShowAddToken] = useState(false);
  // Fallback for when the prop isn't yet populated (first render before the
  // SW responds). Once the prop lands it takes precedence via `activeWalletName`.
  const [localWalletName, setLocalWalletName] = useState('default');
  const activeWalletName = walletName ?? localWalletName;
  const [currentAccountIndex, setCurrentAccountIndex] = useState(0);
  const [showTestnets, setShowTestnets] = useState(false);

  // Price state
  const [totalBalance, setTotalBalance] = useState<string>('$0.00');
  const [tokenPrices, setTokenPrices] = useState<Record<string, number | null>>({});
  const [pricesLoading, setPricesLoading] = useState(false);

  // Send form state
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  /**
   * Fully-qualified send target: token + the network it lives on. Drives
   * validation, gas estimate, and the SEND_TRANSACTION payload so the user
   * can send on any chain without first switching the global active network.
   * Null until the user opens the asset picker and makes a choice.
   */
  const [selectedAsset, setSelectedAsset] = useState<SendableAsset | null>(null);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [selectedTokenDetails, setSelectedTokenDetails] = useState<{ token: Token; icon: string | null; networkKey?: string } | null>(null);

  /**
   * `unified` = all-networks aggregated view; any other string = a specific
   * `networkKey` the user narrowed to. Defaults to unified so first-run users
   * see the cross-chain hero rather than a single-network slice.
   */
  const [viewScope, setViewScope] = useState<'unified' | string>('unified');

  /** Sort modal open/close. */
  const [showSortModal, setShowSortModal] = useState(false);

  /** `navigator.onLine` mirror for the offline banner. */
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== 'undefined' && navigator.onLine === false
  );

  /** Persisted preferences: sort order, hide-zero toggle, privacy mode. */
  const { prefs, update: updatePrefs } = useUserPreferences();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [amountMode, setAmountMode] = useState<'token' | 'usd'>('token');
  const [sendError, setSendError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [gasEstimate, setGasEstimate] = useState<{ estimatedCostNative: string; nativeSymbol: string } | null>(null);
  const [gasEstimateLoading, setGasEstimateLoading] = useState(false);
  const [calculatingMax, setCalculatingMax] = useState(false);
  const [destinationTag, setDestinationTag] = useState<string>('');
  const [comment, setComment] = useState<string>('');

  const networkOptions = useMemo(() => {
    const visibleNetworks = getVisibleNetworkEntries(networks, {
      showTestnets,
      currentNetwork: network
    });
    return visibleNetworks.map(([key, net]: [string, any]) => {
      let icon;
      if (key === 'base') icon = ICON_ASSETS['base.svg'];
      else if (key === 'arbitrum') icon = ICON_ASSETS['arbitrum.svg'];
      else if (key === 'optimism') icon = ICON_ASSETS['optimism-logo.svg'];
      else if (key === 'linea') icon = ICON_ASSETS['linea-logo-mainnet.svg'];
      else if (key.startsWith('solana')) icon = ICON_ASSETS['solana-logo.svg'];
      else if (key.startsWith('bitcoin')) icon = ICON_ASSETS['bitcoin-logo.svg'];
      else if (key.startsWith('ton')) icon = ICON_ASSETS['ton_symbol.svg'];
      else if (key === 'bsc') icon = ICON_ASSETS['bnb.svg'];
      else if (key === 'avalanche') icon = ICON_ASSETS['avax-token.svg'];
      else if (key === 'polygon') icon = ICON_ASSETS['pol-token.svg'];
      
      if (!icon && net.nativeSymbol) {
         const file = SYMBOL_ICON_FALLBACK[net.nativeSymbol.toLowerCase()];
         if (file) icon = ICON_ASSETS[file];
      }
      
      const disabled = isNetworkDisabled(key, importType, privateKeyType);
      return { value: key, label: net.name, icon, disabled };
    });
  }, [networks, network, showTestnets, importType, privateKeyType]);

  // ============================================================================
  // Unified cross-chain portfolio
  // ============================================================================

  /**
   * Unified snapshot driver — suspends when the user has scoped to a single chain.
   *
   * `showTestnets` is threaded through as a snapshot option (not read from
   * service-worker config at snapshot build time) so the hook's
   * `optionsKey`-driven refetch machinery kicks in the moment the user
   * toggles the switch. Without this, flipping "show test networks" would
   * update the dropdown but leave the cached snapshot — and its total —
   * stale until the next scheduled refresh ran.
   */
  const unified = useUnifiedPortfolio(
    viewScope === 'unified',
    {
      sort: prefs.tokenSort,
      showZeroBalances: !prefs.hideZeroBalances,
      showTestnets,
    },
    activeWalletName,
  );

  /** Convert raw snapshot rows into the dumb-component shape `TokenList` expects. */
  const unifiedRows: TokenRow[] = useMemo(() => {
    if (!unified.snapshot) return [];
    return unified.snapshot.rows.map((r) => ({
      rowKey: r.rowKey,
      token: r.token,
      balance: r.balance,
      error: r.error,
      chainBadgeIcon: getChainBadgeIcon(r.networkKey),
      chainBadgeLabel: r.networkLabel,
      secondaryLabel: `${r.token.symbol} · ${r.networkLabel}`,
      networkKey: r.networkKey,
      stale: r.stale,
      usdFormatted: r.usdFormatted,
    }));
  }, [unified.snapshot]);

  /** "All Networks" option prepended to the network selector when a mnemonic wallet can span chains. */
  const scopeOptions = useMemo(() => {
    const hasMultipleUsable = networkOptions.filter(o => !o.disabled).length > 1;
    if (!hasMultipleUsable) return networkOptions;
    return [
      { value: '__unified__', label: 'All Networks', icon: undefined, disabled: false },
      ...networkOptions,
    ];
  }, [networkOptions]);

  const scopeSelectorValue = viewScope === 'unified' ? '__unified__' : network;

  /**
   * Route a scope-selector change:
   *   - `__unified__` → switch to the cross-chain view (no SWITCH_NETWORK — keeps
   *     the wallet's current network intact so Send retains a sensible default).
   *   - any networkKey → narrow to that chain and SWITCH_NETWORK so legacy
   *     single-chain paths (send, activity) operate on it.
   */
  const handleScopeChange = (value: string) => {
    if (value === '__unified__') {
      setViewScope('unified');
      return;
    }
    setViewScope(value);
    handleNetworkChange(value);
  };

  // Activity doesn't exist in the unified view — if the user was looking at it
  // and then switched scope to "All Networks", bounce back to the tokens tab
  // so they don't land on a hidden view.
  useEffect(() => {
    if (viewScope === 'unified' && view === 'activity') {
      setView('tokens');
    }
  }, [viewScope, view]);

  // Track online/offline so the unified view can surface a banner when the
  // user drops connectivity. Cached rows keep rendering regardless.
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load tokens immediately, then trigger async balance refresh
  useEffect(() => {
    loadTokensAndData();
    
    // Listen for balance updates from background
    const handleMessage = (message: any) => {
      if (message.type === 'BALANCES_UPDATED' && message.network === network) {
        // Update portfolio with new balances
        setPortfolio(message.balances.map((item: any) => ({
          token: item.token,
          balance: item.balance || '0',
          error: item.error,
          availableBalance: item.availableBalance,
          reservedBalance: item.reservedBalance,
          isActivated: item.isActivated
        })));
      }
    };
    
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [network]);

  // Which network the Send form is currently operating on. Falls back to the
  // globally-active network until the user picks a cross-chain asset.
  const sendNetworkKey = selectedAsset?.networkKey ?? network;

  // When the user lands on the Send view without an asset picked, pop the
  // picker open immediately — selecting chain + token is required to route
  // the transaction to the right RPC.
  useEffect(() => {
    if (view === 'send' && !selectedAsset && !isSending) {
      setShowAssetPicker(true);
    }
  }, [view, selectedAsset, isSending]);

  // Fetch gas estimate when token/recipient/target-network changes
  useEffect(() => {
    if (!selectedToken || !recipient || !isValidRecipientAddress(sendNetworkKey, recipient)) {
      setGasEstimate(null);
      return;
    }
    // For Bitcoin, only estimate once amount is present (UTXO selection depends on amount).
    if (isBitcoinNetwork(sendNetworkKey) && (!amount || amount.trim() === '')) {
      setGasEstimate(null);
      return;
    }

    let cancelled = false;
    const fetchGasEstimate = async () => {
      setGasEstimateLoading(true);
      try {
        // Add client-side timeout as backup
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), 8000)
        );
        const responsePromise = chrome.runtime.sendMessage({
          type: 'GET_GAS_ESTIMATE',
          payload: {
            token: selectedToken,
            toAddress: recipient,
            amount: amount || '0',
            networkKey: sendNetworkKey,
          }
        });

        const response = await Promise.race([responsePromise, timeoutPromise]);
        if (!cancelled && response && !response.error) {
          setGasEstimate(response);
        }
      } catch (err) {
        console.warn('Failed to fetch gas estimate:', err);
      } finally {
        if (!cancelled) {
          setGasEstimateLoading(false);
        }
      }
    };

    // Debounce the fetch
    const timer = setTimeout(fetchGasEstimate, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectedToken, recipient, amount, sendNetworkKey]);

  const loadTokensAndData = async () => {
    setLoading(true);
    try {
      // Load tokens instantly with cached balances, networks, and accounts in parallel
      const [tokensResponse, networksResponse, accountsResponse, showTestnetsResponse] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_TOKENS' }),
        chrome.runtime.sendMessage({ type: 'GET_NETWORKS' }),
        chrome.runtime.sendMessage({ type: 'GET_ACCOUNTS' }),
        chrome.runtime.sendMessage({ type: 'GET_SHOW_TESTNETS' })
      ]);

      // Set tokens with cached balances immediately
      if (tokensResponse.tokens) {
        setPortfolio(tokensResponse.tokens.map((item: TokenWithBalance) => ({
          token: item.token,
          balance: item.balance || '0',
          error: undefined
        })));
      }
      if (networksResponse.networks) {
        setNetworks(networksResponse.networks);
      }
      if (accountsResponse.currentWalletName) {
        setLocalWalletName(accountsResponse.currentWalletName);
      }
      if (accountsResponse.currentAccountIndex !== undefined) {
        setCurrentAccountIndex(accountsResponse.currentAccountIndex);
      }
      if (showTestnetsResponse && typeof showTestnetsResponse.showTestnets === 'boolean') {
        setShowTestnets(showTestnetsResponse.showTestnets);
      }
      
      // Trigger async balance refresh (non-blocking)
      chrome.runtime.sendMessage({ type: 'REFRESH_BALANCES' }).catch(() => {});
      
      // Fetch prices after a short delay to let balances update
      setTimeout(() => fetchTokenPrices(), 1000);
      
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTestnets = async (enabled: boolean) => {
    setShowTestnets(enabled);
    try {
      await chrome.runtime.sendMessage({
        type: 'SET_SHOW_TESTNETS',
        payload: { showTestnets: enabled }
      });
    } catch (error) {
      console.warn('Failed to update testnet visibility:', error);
    }
  };

  const fetchTokenPrices = async () => {
    setPricesLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_TOKEN_PRICES' });
      if (response && !response.error) {
        setTotalBalance(response.formattedTotal || '$0.00');
        setTokenPrices(response.prices || {});
      }
    } catch (error) {
      console.warn('Failed to fetch prices:', error);
    } finally {
      setPricesLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Ask background to refresh balances (now awaited server-side to avoid MV3 worker suspend).
      await chrome.runtime.sendMessage({ type: 'REFRESH_BALANCES' });

      // Re-read cached balances immediately (in case BALANCES_UPDATED is delayed/missed).
      const tokensResponse = await chrome.runtime.sendMessage({ type: 'GET_TOKENS' });
      if (tokensResponse?.tokens) {
        setPortfolio(tokensResponse.tokens.map((item: TokenWithBalance) => ({
          token: item.token,
          balance: item.balance || '0',
          error: undefined
        })));
      }

      // Fetch updated prices (uses cached balances)
      await fetchTokenPrices();
    } catch (error) {
      console.warn('Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleLock = async () => {
    await chrome.runtime.sendMessage({ type: 'LOCK_WALLET' });
    onLock();
  };

  const handleNetworkChange = async (newNetwork: string) => {
    try {
      await chrome.runtime.sendMessage({
        type: 'SWITCH_NETWORK',
        payload: { network: newNetwork }
      });
      setTokenPrices({});
      setTotalBalance('$0.00');
      notifyStateChange();
      // Load tokens immediately for new network
      loadTokensAndData();
    } catch (error) {
      console.error('Failed to switch network:', error);
    }
  };

  const getSelectedTokenPrice = () => {
    if (!selectedToken) return null;
    const priceKey = getTokenPriceKey(selectedToken);
    if (!priceKey) return null;
    const price = tokenPrices[priceKey];
    return price ?? null;
  };

  const setAmountWithMode = (tokenAmount: string) => {
    setAmount(tokenAmount);
    if (amountMode === 'usd') {
      const price = getSelectedTokenPrice();
      if (!price || !Number.isFinite(price)) {
        setAmountInput('');
        return;
      }
      const usdValue = parseFloat(tokenAmount) * price;
      setAmountInput(Number.isFinite(usdValue) ? usdValue.toFixed(2) : '');
      return;
    }
    setAmountInput(tokenAmount);
  };

  const handleAmountInputChange = (value: string) => {
    const sanitized = value.replace(/[^0-9.]/g, '');
    setAmountInput(sanitized);

    if (!selectedToken) {
      setAmount('');
      return;
    }

    if (amountMode === 'token') {
      setAmount(sanitized);
      return;
    }

    const price = getSelectedTokenPrice();
    if (!price || !Number.isFinite(price)) {
      setAmount('');
      return;
    }

    const usdAmount = parseFloat(sanitized);
    if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
      setAmount('');
      return;
    }

    const tokenAmount = usdAmount / price;
    const decimals = selectedToken.decimals ?? 6;
    setAmount(tokenAmount.toFixed(Math.min(6, decimals)));
  };

  const handleToggleAmountMode = (mode: 'token' | 'usd') => {
    if (amountMode === mode) return;
    setAmountMode(mode);
    if (!selectedToken) return;

    const price = getSelectedTokenPrice();
    if (mode === 'usd') {
      if (!price || !Number.isFinite(price) || !amount) {
        setAmountInput('');
        return;
      }
      const usdValue = parseFloat(amount) * price;
      setAmountInput(Number.isFinite(usdValue) ? usdValue.toFixed(2) : '');
      return;
    }

    setAmountInput(amount);
  };

  const handleMaxClick = async () => {
    if (!selectedToken) return;

    // Prefer the balance from the cross-chain picked asset (which already
    // carries the right network). Fall back to the active-network portfolio
    // for the legacy same-network path.
    const tokenData =
      (selectedAsset && { balance: selectedAsset.balance, availableBalance: undefined as string | undefined }) ||
      portfolio.find(p => p.token.symbol === selectedToken.symbol);
    if (!tokenData || !tokenData.balance) return;

    // If it's an ERC20/SPL token, just set the full balance (gas is paid in native)
    if (selectedToken.type !== 'native') {
      setAmountWithMode(tokenData.balance);
      return;
    }

    // For native tokens (ETH, SOL, BTC, XRP), we must subtract fees (and keep reserves where applicable).
    setCalculatingMax(true);
    try {
      // XRP: if we have availableBalance (already excludes reserve), use that as the starting point.
      const maxBaseBalance =
        isXrpNetwork(sendNetworkKey) && selectedToken.type === 'native' && (tokenData as any).availableBalance
          ? (tokenData as any).availableBalance
          : tokenData.balance;

      // Use the recipient if valid, otherwise use own address (self-send) for estimation
      const estimateToAddress = (recipient && isValidRecipientAddress(sendNetworkKey, recipient))
        ? recipient
        : address;

      const response = await chrome.runtime.sendMessage({
        type: 'GET_GAS_ESTIMATE',
        payload: {
          token: selectedToken,
          toAddress: estimateToAddress,
          amount: maxBaseBalance, // Estimate for sending max
          networkKey: sendNetworkKey,
        }
      });

      if (response && response.estimatedCostNative) {
        const balanceNum = parseFloat(maxBaseBalance);
        const feeNum = parseFloat(response.estimatedCostNative);
        
        // Subtract fee from balance
        const maxAmount = balanceNum - feeNum;
        
        if (maxAmount > 0) {
          // Truncate decimals to avoid precision issues
          // Use a safe floor logic to avoid rounding up which could cause insufficient funds
          const decimals = selectedToken.decimals || 18;
          const factor = Math.pow(10, decimals);
          const safeMax = Math.floor(maxAmount * factor) / factor;
          
          setAmountWithMode(safeMax.toString());
        } else {
          setAmountWithMode('0');
        }
      } else {
        // Fallback if estimation fails, just set full balance
        setAmountWithMode(tokenData.balance);
      }
    } catch (err) {
      console.error('Failed to calculate max amount:', err);
      setAmountWithMode(tokenData.balance);
    } finally {
      setCalculatingMax(false);
    }
  };

  const getAmountUsdValue = (): string | null => {
    if (!selectedToken || !amount) return null;
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) return null;
    
    const priceKey = getTokenPriceKey(selectedToken);
    if (!priceKey) return null;
    
    const price = tokenPrices[priceKey];
    if (price === null || price === undefined) return null;
    
    const value = amountNum * price;
    if (value < 0.01) return '<$0.01';
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getTokenEquivalentValue = (): string | null => {
    if (!selectedToken || !amount) return null;
    if (amountMode !== 'usd') return null;
    const tokenAmount = parseFloat(amount);
    if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) return null;
    return `${formatBalance(tokenAmount)} ${selectedToken.symbol}`;
  };

  const getGasUsdValue = (): string | null => {
    if (!gasEstimate) return null;
    const gasCost = parseFloat(gasEstimate.estimatedCostNative);
    if (isNaN(gasCost)) return null;
    
    const nativePrice = tokenPrices['native'];
    if (nativePrice === null || nativePrice === undefined) return null;
    
    const value = gasCost * nativePrice;
    if (value < 0.01) return '<$0.01';
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    setSendError('');

    if (!selectedToken || !recipient || !amount) {
      setSendError('Please fill in all fields');
      return;
    }

    if (amountMode === 'usd' && !getSelectedTokenPrice()) {
      setSendError('USD amount requires a price feed');
      return;
    }

    // Validate address format against the SELECTED asset's network, not the
    // globally-active one — the two can differ when the user picks an asset
    // on a non-active chain.
    if (!isValidRecipientAddress(sendNetworkKey, recipient)) {
      setSendError(
        isBitcoinNetwork(sendNetworkKey)
          ? 'Invalid Bitcoin address'
          : isSolanaNetwork(sendNetworkKey)
            ? 'Invalid Solana address'
            : isXrpNetwork(sendNetworkKey)
              ? (isXAddress(recipient) ? 'X-address not supported (use classic r... address)' : 'Invalid XRP address')
              : isTonNetwork(sendNetworkKey)
                ? 'Invalid TON address'
                : 'Invalid Ethereum address'
      );
      return;
    }

    // Validate destination tag if provided (XRP only)
    if (isXrpNetwork(sendNetworkKey) && destinationTag.trim() !== '') {
      if (!isValidDestinationTag(destinationTag)) {
        setSendError('Invalid destination tag (must be a uint32: 0 to 4294967295)');
        return;
      }
    }

    // Validate amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setSendError('Invalid amount');
      return;
    }

    // Show the confirmation/send view
    setIsSending(true);
  };

  const handleSendComplete = () => {
    setIsSending(false);
    setRecipient('');
    setAmount('');
    setAmountInput('');
    setAmountMode('token');
    setDestinationTag('');
    setComment('');
    setSelectedToken(null);
    setSelectedAsset(null);
    setView('tokens');
    handleRefresh();
    notifyStateChange();
  };

  const handleSendClose = () => {
    setIsSending(false);
  };

  const getTokenUsdValue = (token: Token, balance: string): string | null => {
    const priceKey = getTokenPriceKey(token);
    if (!priceKey) return null;
    
    const price = tokenPrices[priceKey];
    if (price === null || price === undefined) return null;
    
    const balanceNum = parseFloat(balance);
    if (isNaN(balanceNum) || balanceNum === 0) return '$0.00';
    
    const value = balanceNum * price;
    if (value < 0.01) return '<$0.01';
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getTokenIcon = (token: Token) => {
    const iconName = token.icon || SYMBOL_ICON_FALLBACK[token.symbol.toLowerCase()];
    if (iconName && ICON_ASSETS[iconName]) {
      return ICON_ASSETS[iconName];
    }
    return null;
  };

  return (
    <div className="container">
      <Header
        network={network}
        currentAddress={address}
        currentWalletName={activeWalletName}
        currentAccountIndex={currentAccountIndex}
        onAccountMenuClick={() => setShowAccountMenu(true)}
        onOpenSettings={() => setView('settings')}
        onLock={handleLock}
      />

      {showAccountMenu && (
        <AccountMenu
          currentAddress={address}
          currentWalletName={activeWalletName}
          currentAccountIndex={currentAccountIndex}
          onClose={() => setShowAccountMenu(false)}
          onAccountSwitch={() => {
            loadTokensAndData();
            notifyStateChange();
          }}
          onWalletSwitch={() => {
            loadTokensAndData();
            notifyStateChange();
            setShowAccountMenu(false);
          }}
          onStateChange={notifyStateChange}
        />
      )}

      {/* Balance + tabs block (account chip lives in Header, unified source). */}
      {view !== 'settings' && view !== 'send' && view !== 'receive' && view !== 'tokenDetails' && (
        <>
          {/* Balance + Actions always above tabs.
           *  Unified view: aggregate USD hero powered by the cross-chain snapshot.
           *  Per-network view: the legacy single-chain total. */}
          {viewScope === 'unified' ? (
            <PortfolioHero
              totalFormatted={unified.snapshot?.totalUsdFormatted ?? null}
              updatedAt={unified.snapshot?.updatedAt ?? null}
              refreshing={unified.refreshing}
              privacyMode={prefs.privacyMode}
              onRefresh={unified.refresh}
              onTogglePrivacy={() => updatePrefs({ privacyMode: !prefs.privacyMode })}
              onSend={() => setView('send')}
              onReceive={() => setView('receive')}
            />
          ) : (
            <BalanceCard
              totalBalance={totalBalance}
              refreshing={refreshing}
              pricesLoading={pricesLoading}
              onRefresh={handleRefresh}
              onSend={() => setView('send')}
              onReceive={() => setView('receive')}
            />
          )}

          {/* Activity tab is hidden in the unified view: a single mixed-chain
           *  feed is confusing and the per-token activity on TokenDetailsScreen
           *  already covers the "what just happened to my USDC on Base?" case.
           *  The tab returns when the user narrows to a specific chain. */}
          {viewScope !== 'unified' && (
            <div className="top-nav">
              {['tokens', 'activity'].map((tab) => (
                <button
                  key={tab}
                  className={`nav-item ${view === tab ? 'active' : ''}`}
                  onClick={() => setView(tab as View)}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Content Area */}
      <div className="content">
      {view === 'settings' ? (
          <SettingsView
            currentAddress={address}
            onAccountSwitch={() => loadTokensAndData()}
            onWalletSwitch={() => loadTokensAndData()}
            onStateChange={notifyStateChange}
            onClose={() => setView('tokens')}
          />
        ) : view === 'tokens' ? (
          <>
            {/* Scope selector ("All Networks" + per-chain options). */}
            <div className="tokens-header" style={{ display: 'block', marginBottom: 12 }}>
              <NetworkSelector
                value={scopeSelectorValue}
                options={scopeOptions}
                onChange={handleScopeChange}
                showTestnets={showTestnets}
                onToggleShowTestnets={handleToggleTestnets}
              />
            </div>

            {viewScope === 'unified' ? (
              unified.loading && unifiedRows.length === 0 ? (
                <TokenRowSkeleton count={6} />
              ) : (
                <>
                  <PortfolioErrorBanner
                    offline={isOffline}
                    error={unified.error}
                    onRetry={unified.refresh}
                  />
                  <div className="unified-controls" role="toolbar" aria-label="Token list controls">
                    <label className="unified-controls__toggle">
                      <input
                        type="checkbox"
                        checked={prefs.hideZeroBalances}
                        onChange={(e) => updatePrefs({ hideZeroBalances: e.target.checked })}
                      />
                      <span>Hide zero balances</span>
                    </label>
                    <button
                      type="button"
                      className="unified-controls__sort"
                      onClick={() => setShowSortModal(true)}
                      aria-label="Sort tokens"
                    >
                      Sort: {prefs.tokenSort === 'fiat' ? 'USD' : prefs.tokenSort === 'alpha' ? 'A–Z' : 'Chain'}
                    </button>
                  </div>
                  {unifiedRows.length === 0 ? (
                    <EmptyPortfolio onReceive={() => setView('receive')} />
                  ) : (
                    <TokenList
                      items={unifiedRows}
                      loading={false}
                      getIcon={getTokenIcon}
                      getUsdValue={() => null}
                      privacyMode={prefs.privacyMode}
                      onSelect={(token, iconSrc, rowNetworkKey) => {
                        setSelectedTokenDetails({ token, icon: iconSrc, networkKey: rowNetworkKey });
                        if (rowNetworkKey && rowNetworkKey !== network) {
                          // Route Send / details to the tapped row's chain.
                          sendMessageWithRetry({ type: 'SWITCH_NETWORK', payload: { network: rowNetworkKey } })
                            .catch(() => { /* silent; user will see error on send if needed */ });
                        }
                        setView('tokenDetails');
                      }}
                      showAddToken={false}
                      onAddToken={() => setShowAddToken(true)}
                    />
                  )}
                </>
              )
            ) : (
              <TokenList
                items={portfolio}
                loading={loading}
                getIcon={getTokenIcon}
                getUsdValue={getTokenUsdValue}
                onSelect={(token, iconSrc) => {
                  setSelectedTokenDetails({ token, icon: iconSrc, networkKey: network });
                  setView('tokenDetails');
                }}
                showAddToken={isEvmNetwork(network)}
                onAddToken={() => setShowAddToken(true)}
              />
            )}

            {/* Add Token Modal */}
            {isEvmNetwork(network) && (
              <AddTokenModal
                isOpen={showAddToken}
                onClose={() => setShowAddToken(false)}
                network={networks[network]?.name || network}
                onTokenAdded={handleRefresh}
              />
            )}
            <SortModal
              isOpen={showSortModal}
              onClose={() => setShowSortModal(false)}
              value={prefs.tokenSort}
              onChange={(next) => updatePrefs({ tokenSort: next })}
            />
          </>
        ) : view === 'activity' ? (
          <ActivityView currentAddress={address} network={network} networks={networks} />
        ) : view === 'receive' ? (
          <div className="takeover">
            <ScreenHeader
              title={`Receive ${networks[network]?.nativeSymbol || ''}`.trim()}
              onBack={() => setView('tokens')}
            />
            <ReceiveView
              address={address}
              network={network}
              networks={networks}
              importType={importType}
              privateKeyType={privateKeyType}
            />
          </div>
        ) : view === 'send' ? (
          <div className="takeover">
            {isSending && selectedToken ? (
              <SendTransactionView
                token={selectedToken}
                recipient={recipient}
                amount={amount}
                destinationTag={isXrpNetwork(sendNetworkKey) && destinationTag.trim() !== '' ? Number(destinationTag) : undefined}
                comment={isTonNetwork(sendNetworkKey) ? comment : undefined}
                networkKey={sendNetworkKey}
                onClose={handleSendClose}
                onSuccess={handleSendComplete}
              />
            ) : (
              <>
                <ScreenHeader title="Send" onBack={() => setView('tokens')} />
                <form onSubmit={handleSend}>
                  <div className="form-group">
                    <label>Asset</label>
                    <button
                      type="button"
                      className="asset-picker-chip"
                      onClick={() => setShowAssetPicker(true)}
                    >
                      {selectedAsset ? (
                        <>
                          <span className="asset-picker-chip__badge" aria-hidden>
                            {(() => {
                              const badge = selectedAsset.chainBadgeIcon || getChainBadgeIcon(selectedAsset.networkKey);
                              return badge ? <img src={badge} alt="" /> : null;
                            })()}
                          </span>
                          <span className="asset-picker-chip__main">
                            <span className="asset-picker-chip__symbol">{selectedAsset.token.symbol}</span>
                            <span className="asset-picker-chip__network">{selectedAsset.networkLabel}</span>
                          </span>
                          <span className="asset-picker-chip__balance">
                            {formatBalance(selectedAsset.balance)}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="asset-picker-chip__placeholder">Select an asset…</span>
                          <span className="asset-picker-chip__caret" aria-hidden>▾</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="form-group">
                    <label>Recipient Address</label>
                    <div className="recipient-row">
                      <div className="recipient-input">
                        <input
                          type="text"
                          value={recipient}
                          onChange={(e) => setRecipient(e.target.value)}
                          placeholder={
                            isBitcoinNetwork(sendNetworkKey)
                              ? (sendNetworkKey === 'bitcoin-testnet' ? 'tb1...' : 'bc1...')
                              : isSolanaNetwork(sendNetworkKey)
                                ? 'Base58 address...'
                                : isXrpNetwork(sendNetworkKey)
                                  ? 'r...'
                                  : isTonNetwork(sendNetworkKey)
                                    ? 'EQ... or UQ...'
                                    : '0x...'
                          }
                          style={{ paddingRight: '40px', width: '100%' }}
                        />
                        {recipient && (
                          <div className="recipient-identicon">
                            <Identicon address={recipient} size={24} />
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="recipient-action"
                        onClick={async () => {
                          try {
                            const clip = await navigator.clipboard.readText();
                            if (clip) setRecipient(clip.trim());
                          } catch {
                            showToast('Clipboard access denied');
                          }
                        }}
                      >
                        Paste
                      </button>
                    </div>
                  </div>

                  {/* XRP destination tag (optional) */}
                  {isXrpNetwork(sendNetworkKey) && selectedToken?.type === 'native' && (
                    <div className="form-group">
                      <label>Destination Tag (optional)</label>
                      <input
                        type="text"
                        value={destinationTag}
                        onChange={(e) => setDestinationTag(e.target.value)}
                        placeholder="e.g. 12345"
                        inputMode="numeric"
                      />
                      <div className="form-hint" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        Required for some exchange deposits. Leave blank if not provided by the recipient.
                      </div>
                    </div>
                  )}

                  {isTonNetwork(sendNetworkKey) && selectedToken?.type === 'native' && (
                    <div className="form-group">
                      <label>Comment (optional)</label>
                      <input
                        type="text"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Optional message"
                      />
                      <div className="form-hint" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        Included as a plain text payload in the TON transfer.
                      </div>
                    </div>
                  )}

                  <div className="form-group">
                    <div className="amount-label-row">
                      <label>Amount</label>
                      <div className="amount-actions">
                        {selectedToken && (
                          <>
                            <button
                              type="button"
                              className="max-btn"
                              onClick={handleMaxClick}
                              disabled={calculatingMax}
                            >
                              {calculatingMax ? '...' : 'Max'}
                            </button>
                            <button
                              type="button"
                              className="max-btn"
                              onClick={() => {
                                setAmount('');
                                setAmountInput('');
                              }}
                            >
                              Clear
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="amount-toggle">
                      <button
                        type="button"
                        className={`amount-toggle-btn ${amountMode === 'token' ? 'active' : ''}`}
                        onClick={() => handleToggleAmountMode('token')}
                      >
                        {selectedToken ? selectedToken.symbol : 'Token'}
                      </button>
                      <button
                        type="button"
                        className={`amount-toggle-btn ${amountMode === 'usd' ? 'active' : ''}`}
                        onClick={() => handleToggleAmountMode('usd')}
                        disabled={!getSelectedTokenPrice()}
                      >
                        USD
                      </button>
                    </div>
                    <input
                      type="text"
                      value={amountInput}
                      onChange={(e) => handleAmountInputChange(e.target.value)}
                      placeholder={amountMode === 'usd' ? '$0.00' : '0.0'}
                    />
                    {amountMode === 'token' && getAmountUsdValue() && (
                      <div className="amount-usd-value">≈ {getAmountUsdValue()}</div>
                    )}
                    {amountMode === 'usd' && getTokenEquivalentValue() && (
                      <div className="amount-usd-value">≈ {getTokenEquivalentValue()}</div>
                    )}
                  </div>

                  {/* Network Fee Estimate Display */}
                  {selectedToken &&
                    recipient &&
                    isValidRecipientAddress(sendNetworkKey, recipient) &&
                    (!isBitcoinNetwork(sendNetworkKey) || (amount && amount.trim() !== '')) && (
                    <div className="gas-estimate-box">
                      <div className="gas-estimate-label">Estimated network fee</div>
                      <div className="gas-estimate-value">
                        {gasEstimateLoading ? (
                          <span className="gas-loading">Estimating...</span>
                        ) : gasEstimate ? (
                          <>
                            <span className="gas-amount">
                              ~{parseFloat(gasEstimate.estimatedCostNative).toFixed(
                                isBitcoinNetwork(sendNetworkKey)
                                  ? 8
                                  : (isSolanaNetwork(sendNetworkKey) || isTonNetwork(sendNetworkKey))
                                    ? 9
                                    : 6
                              )} {gasEstimate.nativeSymbol}
                            </span>
                            {getGasUsdValue() && (
                              <span className="gas-usd">≈ {getGasUsdValue()}</span>
                            )}
                          </>
                        ) : (
                          <span className="gas-loading">--</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Reserve hint for XRP (available vs reserved) */}
                  {isXrpNetwork(sendNetworkKey) && selectedToken?.type === 'native' && selectedToken && (
                    (() => {
                      const tokenData = portfolio.find(p => p.token.symbol === selectedToken.symbol);
                      if (!tokenData) return null;
                      if (tokenData.isActivated === false) {
                        return (
                          <div className="gas-estimate-box" style={{ borderColor: 'var(--warning)' }}>
                            <div className="gas-estimate-label">XRP Account Not Activated</div>
                            <div className="gas-estimate-value" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                              <span className="gas-loading">
                                You may need to receive enough XRP to meet the network reserve before the account can be used.
                              </span>
                            </div>
                          </div>
                        );
                      }
                      if (tokenData.availableBalance && tokenData.reservedBalance) {
                        return (
                          <div className="gas-estimate-box">
                            <div className="gas-estimate-label">Spendable Balance</div>
                            <div className="gas-estimate-value" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                              <span className="gas-amount">{tokenData.availableBalance} {selectedToken.symbol}</span>
                              <span className="gas-usd">Reserve: {tokenData.reservedBalance} {selectedToken.symbol}</span>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()
                  )}

                  {sendError && <div className="error">{sendError}</div>}

                  <button type="submit" className="btn btn-primary">
                    Review
                  </button>
                </form>
              </>
            )}
            <AssetPickerModal
              isOpen={showAssetPicker}
              onClose={() => setShowAssetPicker(false)}
              restrictToChain={
                importType === 'privateKey' && privateKeyType ? privateKeyType : undefined
              }
              selectedRowKey={
                selectedAsset
                  ? `${selectedAsset.networkKey}:${selectedAsset.token.type === 'native' ? 'native' : (selectedAsset.token.address || selectedAsset.token.symbol).toLowerCase()}`
                  : undefined
              }
              onSelect={(asset) => {
                setSelectedAsset(asset);
                setSelectedToken(asset.token);
                // Fresh pick ⇒ blank out amount/recipient state that could be
                // invalid on the new chain. Recipient is left intact only when
                // the previous selection was on the same network.
                setAmount('');
                setAmountInput('');
                setAmountMode('token');
                setDestinationTag('');
                setComment('');
                if (
                  !recipient ||
                  !isValidRecipientAddress(asset.networkKey, recipient)
                ) {
                  setRecipient('');
                }
              }}
            />
          </div>
        ) : view === 'tokenDetails' && selectedTokenDetails ? (
          <TokenDetailsScreen
            token={selectedTokenDetails.token}
            tokenIcon={selectedTokenDetails.icon}
            network={selectedTokenDetails.networkKey ?? network}
            address={address}
            networks={networks}
            tokenPrices={tokenPrices}
            onBack={() => setView('tokens')}
          />
        ) : null}
      </div>
    </div>
  );
}

export default MainWallet;
