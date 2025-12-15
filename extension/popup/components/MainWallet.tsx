/**
 * MainWallet Component
 * 
 * The primary wallet interface displaying:
 * - Portfolio/asset balances
 * - Send/receive functionality
 * - Activity/transaction history
 * - Multi-view navigation (tokens, send, receive, activity, settings)
 */
import React, { useState, useEffect, useMemo } from 'react';
import SettingsView from './SettingsView';
import Header from './Header';
import AccountMenu from './AccountMenu';
import ReceiveView from './ReceiveView';
import ActivityView from './ActivityView';
import AddTokenModal from './AddTokenModal';
import SendTransactionView from './SendTransactionView';
import Identicon from './ui/Identicon';
import NetworkSelector from './ui/NetworkSelector';
import Skeleton from './ui/Skeleton';
import ethIcon from '../../assets/img/eth_logo.svg';
import { useToast } from '../context/ToastContext';
import bnbIcon from '../../assets/img/bnb.svg';
import solIcon from '../../assets/img/solana-logo.svg';
import avaxIcon from '../../assets/img/avax-token.svg';
import arbitrumIcon from '../../assets/img/arbitrum.svg';
import baseIcon from '../../assets/img/base.svg';
import lineaIcon from '../../assets/img/linea-logo-mainnet.svg';
import usdcIcon from '../../assets/img/icon-usdc.png';
import usdtIcon from '../../assets/img/usdt.svg';
import polIcon from '../../assets/img/pol-token.svg';
import bitcoinIcon from '../../assets/img/bitcoin-logo.svg';
import xrpIcon from '../../assets/img/xrp.svg';
import sendIcon from '../../assets/icons/send.svg';
import receiveIcon from '../../assets/icons/receive.svg';
import backIcon from '../../assets/icons/arrow-left.svg';
import { isValidBitcoinAddress } from '../../../src/bitcoin/index.js';
import { isValidXRPAddress, isXAddress, isValidDestinationTag } from '../../../src/xrp/index.js';

const ICON_ASSETS: Record<string, string> = {
  'eth_logo.svg': ethIcon,
  'bnb.svg': bnbIcon,
  'solana-logo.svg': solIcon,
  'avax-token.svg': avaxIcon,
  'arbitrum.svg': arbitrumIcon,
  'base.svg': baseIcon,
  'linea-logo-mainnet.svg': lineaIcon,
  'icon-usdc.png': usdcIcon,
  'usdt.svg': usdtIcon,
  'pol-token.svg': polIcon,
  'xrp.svg': xrpIcon,
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
  pol: 'pol-token.svg',
  matic: 'pol-token.svg',
  btc: 'bitcoin-logo.svg',
  tbtc: 'bitcoin-logo.svg',
  xrp: 'xrp.svg',
  txrp: 'xrp.svg'
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

function isEvmNetwork(networkKey: string): boolean {
  return !isBitcoinNetwork(networkKey) && !isSolanaNetwork(networkKey) && !isXrpNetwork(networkKey);
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
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

interface Props {
  address: string;
  network: string;
  onLock: () => void;
  onStateChange?: () => void;
}

interface Token {
  symbol: string;
  name: string;
  type: 'native' | 'erc20';
  address?: string;
  decimals: number;
   icon?: string;
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

type View = 'tokens' | 'activity' | 'receive' | 'send' | 'settings';

interface TokenWithBalance {
  token: Token;
  balance: string | null;
  lastUpdated: number | null;
  isLoading: boolean;
}

function MainWallet({ address, network, onLock, onStateChange }: Props) {
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
  const [currentWalletName, setCurrentWalletName] = useState('default');
  const [currentAccountIndex, setCurrentAccountIndex] = useState(0);

  // Price state
  const [totalBalance, setTotalBalance] = useState<string>('$0.00');
  const [tokenPrices, setTokenPrices] = useState<Record<string, number | null>>({});
  const [pricesLoading, setPricesLoading] = useState(false);

  // Send form state
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [sendError, setSendError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [gasEstimate, setGasEstimate] = useState<{ estimatedCostNative: string; nativeSymbol: string } | null>(null);
  const [gasEstimateLoading, setGasEstimateLoading] = useState(false);
  const [calculatingMax, setCalculatingMax] = useState(false);
  const [destinationTag, setDestinationTag] = useState<string>('');

  const networkOptions = useMemo(() => {
    return Object.entries(networks).map(([key, net]: [string, any]) => {
      let icon;
      if (key === 'base') icon = ICON_ASSETS['base.svg'];
      else if (key === 'arbitrum') icon = ICON_ASSETS['arbitrum.svg'];
      else if (key === 'linea') icon = ICON_ASSETS['linea-logo-mainnet.svg'];
      else if (key.startsWith('solana')) icon = ICON_ASSETS['solana-logo.svg'];
      else if (key.startsWith('bitcoin')) icon = ICON_ASSETS['bitcoin-logo.svg'];
      else if (key === 'bsc') icon = ICON_ASSETS['bnb.svg'];
      else if (key === 'avalanche') icon = ICON_ASSETS['avax-token.svg'];
      else if (key === 'polygon') icon = ICON_ASSETS['pol-token.svg'];
      
      if (!icon && net.nativeSymbol) {
         const file = SYMBOL_ICON_FALLBACK[net.nativeSymbol.toLowerCase()];
         if (file) icon = ICON_ASSETS[file];
      }
      return { value: key, label: net.name, icon };
    });
  }, [networks]);

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

  // Fetch gas estimate when token/recipient changes
  useEffect(() => {
    if (!selectedToken || !recipient || !isValidRecipientAddress(network, recipient)) {
      setGasEstimate(null);
      return;
    }
    // For Bitcoin, only estimate once amount is present (UTXO selection depends on amount).
    if (isBitcoinNetwork(network) && (!amount || amount.trim() === '')) {
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
          payload: { token: selectedToken, toAddress: recipient, amount: amount || '0' }
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
  }, [selectedToken, recipient, amount]);

  const loadTokensAndData = async () => {
    setLoading(true);
    try {
      // Load tokens instantly with cached balances, networks, and accounts in parallel
      const [tokensResponse, networksResponse, accountsResponse] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_TOKENS' }),
        chrome.runtime.sendMessage({ type: 'GET_NETWORKS' }),
        chrome.runtime.sendMessage({ type: 'GET_ACCOUNTS' })
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
        setCurrentWalletName(accountsResponse.currentWalletName);
      }
      if (accountsResponse.currentAccountIndex !== undefined) {
        setCurrentAccountIndex(accountsResponse.currentAccountIndex);
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
    // Trigger balance refresh and wait for broadcast
    await chrome.runtime.sendMessage({ type: 'REFRESH_BALANCES' });
    // Also reload the full token list in case tokens changed
    await loadTokensAndData();
    // Fetch updated prices
    await fetchTokenPrices();
    setRefreshing(false);
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
      notifyStateChange();
      // Load tokens immediately for new network
      loadTokensAndData();
    } catch (error) {
      console.error('Failed to switch network:', error);
    }
  };

  const handleMaxClick = async () => {
    if (!selectedToken) return;
    
    // Find the token's balance
    const tokenData = portfolio.find(p => p.token.symbol === selectedToken.symbol);
    if (!tokenData || !tokenData.balance) return;

    // If it's an ERC20/SPL token, just set the full balance (gas is paid in native)
    if (selectedToken.type !== 'native') {
      setAmount(tokenData.balance);
      return;
    }

    // For native tokens (ETH, SOL, BTC, XRP), we must subtract fees (and keep reserves where applicable).
    setCalculatingMax(true);
    try {
      // XRP: if we have availableBalance (already excludes reserve), use that as the starting point.
      const maxBaseBalance =
        isXrpNetwork(network) && selectedToken.type === 'native' && tokenData.availableBalance
          ? tokenData.availableBalance
          : tokenData.balance;

      // Use the recipient if valid, otherwise use own address (self-send) for estimation
      const estimateToAddress = (recipient && isValidRecipientAddress(network, recipient)) 
        ? recipient 
        : address;

      const response = await chrome.runtime.sendMessage({
        type: 'GET_GAS_ESTIMATE',
        payload: { 
          token: selectedToken, 
          toAddress: estimateToAddress, 
          amount: maxBaseBalance // Estimate for sending max
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
          
          setAmount(safeMax.toString());
        } else {
          setAmount('0');
        }
      } else {
        // Fallback if estimation fails, just set full balance
        setAmount(tokenData.balance);
      }
    } catch (err) {
      console.error('Failed to calculate max amount:', err);
      setAmount(tokenData.balance);
    } finally {
      setCalculatingMax(false);
    }
  };

  const getAmountUsdValue = (): string | null => {
    if (!selectedToken || !amount) return null;
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) return null;
    
    const priceKey = selectedToken.type === 'native' ? 'native' : selectedToken.address?.toLowerCase();
    if (!priceKey) return null;
    
    const price = tokenPrices[priceKey];
    if (price === null || price === undefined) return null;
    
    const value = amountNum * price;
    if (value < 0.01) return '<$0.01';
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

    // Validate address format
    if (!isValidRecipientAddress(network, recipient)) {
      setSendError(
        isBitcoinNetwork(network)
          ? 'Invalid Bitcoin address'
          : isSolanaNetwork(network)
            ? 'Invalid Solana address'
            : isXrpNetwork(network)
              ? (isXAddress(recipient) ? 'X-address not supported (use classic r... address)' : 'Invalid XRP address')
            : 'Invalid Ethereum address'
      );
      return;
    }

    // Validate destination tag if provided (XRP only)
    if (isXrpNetwork(network) && destinationTag.trim() !== '') {
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
    setDestinationTag('');
    setSelectedToken(null);
    setView('tokens');
    handleRefresh();
    notifyStateChange();
  };

  const handleSendClose = () => {
    setIsSending(false);
  };

  const formatBalance = (balance: string | number) => {
    const num = typeof balance === 'string' ? parseFloat(balance) : balance;
    if (num === 0) return '0';
    if (num < 0.0001) return num.toFixed(8).replace(/\.?0+$/, '');
    if (num < 1) return num.toFixed(6).replace(/\.?0+$/, '');
    return num.toFixed(4).replace(/\.?0+$/, '');
  };

  const getTokenUsdValue = (token: Token, balance: string): string | null => {
    const priceKey = token.type === 'native' ? 'native' : token.address?.toLowerCase();
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
        currentAddress={address}
        currentWalletName={currentWalletName}
        currentAccountIndex={currentAccountIndex}
        onAccountMenuClick={() => setShowAccountMenu(true)}
        onOpenSettings={() => setView('settings')}
        onLock={handleLock}
        showAccountButton={false}
      />

      {showAccountMenu && (
        <AccountMenu
          currentAddress={address}
          currentWalletName={currentWalletName}
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

      {/* Account selector and (for main tabs) balance + navigation */}
      {view !== 'settings' && view !== 'send' && view !== 'receive' && (
        <>
          <div className="account-row">
            <button
              className="account-button wide"
              onClick={() => setShowAccountMenu(true)}
            >
              <div className="account-avatar">
                {/* Bitcoin addresses start with bc1/tb1, Ethereum with 0x */}
                {isBitcoinNetwork(network)
                  ? address.substring(0, 2).toUpperCase()
                  : address.substring(2, 4).toUpperCase()}
              </div>
              <div className="account-info">
                <div className="account-name">
                  {currentWalletName} : Account {currentAccountIndex + 1}
                </div>
                <div 
                  className="account-address"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(address);
                    showToast('Address copied!');
                  }}
                  title="Click to copy"
                  style={{ cursor: 'pointer' }}
                >
                  {/* Bitcoin addresses are longer, show more characters */}
                  {isBitcoinNetwork(network)
                    ? `${address.substring(0, 8)}...${address.substring(address.length - 6)}`
                    : `${address.substring(0, 6)}...${address.substring(address.length - 4)}`}
                </div>
              </div>
              <span className="dropdown-arrow">▼</span>
            </button>
          </div>

          {/* Balance + Actions always above tabs */}
          <div className='balance-row'>
          <div className="balance-card">
            <div className="balance-header">
              <div className="balance-label">Total Balance</div>
              <button
                className="refresh-link"
                onClick={handleRefresh}
                disabled={refreshing || pricesLoading}
              >
                {refreshing || pricesLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            <div className="balance-amount-display">{totalBalance}</div>
            <div className="action-row">
              <button
                className="action-tile"
                onClick={() => setView('receive')}
              >
                <img src={receiveIcon} alt="Receive" className="action-icon" />
                <span>Receive</span>
              </button>
              <button
                className="action-tile"
                onClick={() => setView('send')}
              >
                <img src={sendIcon} alt="Send" className="action-icon" />
                <span>Send</span>
              </button>
            </div>
          </div>
          </div>

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
            {/* Tokens */}
            <div className="tokens-header" style={{ display: 'block', marginBottom: 12 }}>
              <NetworkSelector
                value={network}
                options={networkOptions}
                onChange={handleNetworkChange}
              />
            </div>

            {loading ? (
              <div className="token-list">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="token-item" style={{ pointerEvents: 'none' }}>
                    <div className="token-info">
                      <Skeleton width={34} height={34} borderRadius="50%" />
                      <div className="token-details">
                        <Skeleton width={40} height={14} style={{ marginBottom: 4 }} />
                        <Skeleton width={80} height={12} />
                      </div>
                    </div>
                    <div className="token-balance" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <Skeleton width={60} height={15} style={{ marginBottom: 4 }} />
                      <Skeleton width={40} height={12} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="token-list">
                {portfolio.map((item, index) => {
                  const iconSrc = getTokenIcon(item.token);
                  const usdValue = getTokenUsdValue(item.token, item.balance);
                  return (
                    <div key={index} className="token-item">
                      <div className="token-info">
                        {iconSrc ? (
                          <img src={iconSrc} alt={item.token.symbol} className="token-icon-img" />
                        ) : (
                          <div className="token-icon">
                            {item.token.symbol.substring(0, 1)}
                          </div>
                        )}
                        <div className="token-details">
                          <h3>{item.token.symbol}</h3>
                          <p>{item.token.name}</p>
                        </div>
                      </div>
                      <div className="token-balance">
                        <div className="token-amount">
                          {item.error ? 'Error' : formatBalance(item.balance)}
                        </div>
                        {usdValue && !item.error && (
                          <div className="token-usd-value">{usdValue}</div>
                        )}
                        {!usdValue && (
                          <div className="token-symbol">{item.token.symbol}</div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Add Token Button */}
                {isEvmNetwork(network) && (
                  <button
                    className="token-item add-token-btn"
                    onClick={() => setShowAddToken(true)}
                    style={{
                      justifyContent: 'center',
                      cursor: 'pointer',
                      border: '2px dashed var(--border)',
                      background: 'transparent'
                    }}
                  >
                    <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                      + Add Custom Token
                    </span>
                  </button>
                )}
              </div>
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
          </>
        ) : view === 'activity' ? (
          <ActivityView currentAddress={address} network={network} networks={networks} />
        ) : view === 'receive' ? (
          <div className="takeover">
            <button className="back-button" onClick={() => setView('tokens')}>
              <img src={backIcon} alt="Back" />
              <span>Back</span>
            </button>
            <ReceiveView address={address} network={network} networks={networks} />
          </div>
        ) : view === 'send' ? (
          <div className="takeover">
            {isSending && selectedToken ? (
              <SendTransactionView
                token={selectedToken}
                recipient={recipient}
                amount={amount}
                destinationTag={
                  isXrpNetwork(network) && destinationTag.trim() !== '' ? Number(destinationTag) : undefined
                }
                onClose={handleSendClose}
                onSuccess={handleSendComplete}
              />
            ) : (
              <>
                <button className="back-button" onClick={() => setView('tokens')}>
                  <img src={backIcon} alt="Back" />
                  <span>Back</span>
                </button>
                <form onSubmit={handleSend}>
                  <div className="form-group">
                    <label>Token</label>
                    <select
                      value={selectedToken?.symbol || ''}
                      onChange={(e) => {
                        const token = portfolio.find(p => p.token.symbol === e.target.value);
                        setSelectedToken(token?.token || null);
                      }}
                    >
                      <option value="">Select a token</option>
                      {portfolio.map((item) => (
                        <option key={item.token.symbol} value={item.token.symbol}>
                          {item.token.symbol} ({formatBalance(item.balance)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Recipient Address</label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input
                        type="text"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        placeholder={
                          isBitcoinNetwork(network)
                            ? (network === 'bitcoin-testnet' ? 'tb1...' : 'bc1...')
                            : isSolanaNetwork(network)
                              ? 'Base58 address...'
                              : isXrpNetwork(network)
                                ? 'r...'
                              : '0x...'
                        }
                        style={{ paddingRight: '40px', width: '100%' }}
                      />
                      {recipient && (
                        <div style={{ position: 'absolute', right: '10px', pointerEvents: 'none', display: 'flex' }}>
                          <Identicon address={recipient} size={24} />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* XRP destination tag (optional) */}
                  {isXrpNetwork(network) && selectedToken?.type === 'native' && (
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

                  <div className="form-group">
                    <div className="amount-label-row">
                      <label>Amount</label>
                      {selectedToken && (
                        <button
                          type="button"
                          className="max-btn"
                          onClick={handleMaxClick}
                          disabled={calculatingMax}
                        >
                          {calculatingMax ? '...' : 'Max'}
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.0"
                    />
                    {getAmountUsdValue() && (
                      <div className="amount-usd-value">≈ {getAmountUsdValue()}</div>
                    )}
                  </div>

                  {/* Network Fee Estimate Display */}
                  {selectedToken &&
                    recipient &&
                    isValidRecipientAddress(network, recipient) &&
                    (!isBitcoinNetwork(network) || (amount && amount.trim() !== '')) && (
                    <div className="gas-estimate-box">
                      <div className="gas-estimate-label">Estimated Network Fee</div>
                      <div className="gas-estimate-value">
                        {gasEstimateLoading ? (
                          <span className="gas-loading">Estimating...</span>
                        ) : gasEstimate ? (
                          <>
                            <span className="gas-amount">
                              ~{parseFloat(gasEstimate.estimatedCostNative).toFixed(isBitcoinNetwork(network) ? 8 : 6)} {gasEstimate.nativeSymbol}
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
                  {isXrpNetwork(network) && selectedToken?.type === 'native' && selectedToken && (
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
                    Send
                  </button>
                </form>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default MainWallet;
