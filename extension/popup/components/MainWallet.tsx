/**
 * MainWallet Component
 * 
 * The primary wallet interface displaying:
 * - Portfolio/asset balances
 * - Send/receive functionality
 * - Activity/transaction history
 * - Multi-view navigation (tokens, send, receive, activity, settings)
 */
import React, { useState, useEffect } from 'react';
import SettingsView from './SettingsView';
import Header from './Header';
import AccountMenu from './AccountMenu';
import ReceiveView from './ReceiveView';
import ActivityView from './ActivityView';
import AddTokenModal from './AddTokenModal';
import ethIcon from '../../assets/img/eth_logo.svg';
import bnbIcon from '../../assets/img/bnb.svg';
import solIcon from '../../assets/img/solana-logo.svg';
import avaxIcon from '../../assets/img/avax-token.svg';
import arbitrumIcon from '../../assets/img/arbitrum.svg';
import baseIcon from '../../assets/img/base.svg';
import lineaIcon from '../../assets/img/linea-logo-mainnet.svg';
import usdcIcon from '../../assets/img/icon-usdc.png';
import usdtIcon from '../../assets/img/usdt.svg';
import polIcon from '../../assets/img/pol-token.svg';
import sendIcon from '../../assets/icons/send.svg';
import receiveIcon from '../../assets/icons/receive.svg';
import backIcon from '../../assets/icons/arrow-left.svg';

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
  'pol-token.svg': polIcon
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
  matic: 'pol-token.svg'
};

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
}

type View = 'tokens' | 'activity' | 'receive' | 'send' | 'settings';

interface TokenWithBalance {
  token: Token;
  balance: string | null;
  lastUpdated: number | null;
  isLoading: boolean;
}

function MainWallet({ address, network, onLock, onStateChange }: Props) {
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

  // Send form state
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');

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
          error: item.error
        })));
      }
    };
    
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [network]);

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
      
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    // Trigger balance refresh and wait for broadcast
    await chrome.runtime.sendMessage({ type: 'REFRESH_BALANCES' });
    // Also reload the full token list in case tokens changed
    await loadTokensAndData();
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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendError('');
    setSendSuccess('');

    if (!selectedToken || !recipient || !amount) {
      setSendError('Please fill in all fields');
      return;
    }

    setSendLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SEND_TRANSACTION',
        payload: {
          token: selectedToken,
          toAddress: recipient,
          amount
        }
      });

      if (response.error) {
        setSendError(response.error);
      } else {
        setSendSuccess(`Transaction sent! Hash: ${response.result.hash.substring(0, 10)}...`);
        setRecipient('');
        setAmount('');
        notifyStateChange();
        setTimeout(() => {
          setView('tokens');
          handleRefresh();
        }, 2000);
      }
    } catch (err: any) {
      setSendError(err.message || 'Failed to send transaction');
    } finally {
      setSendLoading(false);
    }
  };

  const formatBalance = (balance: string | number) => {
    const num = typeof balance === 'string' ? parseFloat(balance) : balance;
    if (num === 0) return '0';
    if (num < 0.0001) return num.toFixed(8).replace(/\.?0+$/, '');
    if (num < 1) return num.toFixed(6).replace(/\.?0+$/, '');
    return num.toFixed(4).replace(/\.?0+$/, '');
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
                {address.substring(2, 4).toUpperCase()}
              </div>
              <div className="account-info">
                <div className="account-name">
                  {currentWalletName} : Account {currentAccountIndex + 1}
                </div>
                <div className="account-address">
                  {address.substring(0, 6)}...{address.substring(address.length - 4)}
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
                disabled={refreshing}
              >
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            <div className="balance-amount-display">$0.00</div>
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
            <div className="tokens-header">
              <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                <label style={{ marginBottom: 4 }}>Network</label>
                <select
                  value={network}
                  onChange={(e) => handleNetworkChange(e.target.value)}
                >
                  {Object.entries(networks).map(([key, net]: [string, any]) => (
                    <option key={key} value={key}>{net.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {loading ? (
              <div className="loading">Loading tokens...</div>
            ) : (
              <div className="token-list">
                {portfolio.map((item, index) => {
                  const iconSrc = getTokenIcon(item.token);
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
                        <div className="token-symbol">{item.token.symbol}</div>
                      </div>
                    </div>
                  );
                })}

                {/* Add Token Button */}
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
              </div>
            )}

            {/* Add Token Modal */}
            <AddTokenModal
              isOpen={showAddToken}
              onClose={() => setShowAddToken(false)}
              network={networks[network]?.name || network}
              onTokenAdded={handleRefresh}
            />
          </>
        ) : view === 'activity' ? (
          <ActivityView currentAddress={address} network={network} />
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
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="0x..."
                />
              </div>

              <div className="form-group">
                <label>Amount</label>
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                />
              </div>

              {sendError && <div className="error">{sendError}</div>}
              {sendSuccess && <div className="success">{sendSuccess}</div>}

              <button type="submit" className="btn btn-primary" disabled={sendLoading}>
                {sendLoading ? 'Sending...' : 'Send'}
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default MainWallet;
