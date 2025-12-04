import React, { useState, useEffect } from 'react';
import SettingsView from './SettingsView';
import Header from './Header';
import AccountMenu from './AccountMenu';
import ReceiveView from './ReceiveView';
import ActivityView from './ActivityView';

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
}

interface TokenBalance {
  token: Token;
  balance: string;
  error?: string;
}

type View = 'assets' | 'activity' | 'receive' | 'send' | 'settings';

function MainWallet({ address, network, onLock, onStateChange }: Props) {
  const notifyStateChange = () => {
    if (onStateChange) {
      onStateChange();
    }
  };

  const [view, setView] = useState<View>('assets');
  const [portfolio, setPortfolio] = useState<TokenBalance[]>([]);
  const [networks, setNetworks] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [currentWalletName, setCurrentWalletName] = useState('default');
  const [currentAccountIndex, setCurrentAccountIndex] = useState(0);

  // Send form state
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');

  useEffect(() => {
    loadData();
  }, [network]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [portfolioResponse, networksResponse, accountsResponse] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_PORTFOLIO' }),
        chrome.runtime.sendMessage({ type: 'GET_NETWORKS' }),
        chrome.runtime.sendMessage({ type: 'GET_ACCOUNTS' })
      ]);

      if (portfolioResponse.portfolio) {
        setPortfolio(portfolioResponse.portfolio);
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
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
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
      setTimeout(() => {
        loadData();
      }, 300);
    } catch (error) {
      console.error('Failed to switch network:', error);
    }
  };

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(address);
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
          setView('portfolio');
          handleRefresh();
        }, 2000);
      }
    } catch (err: any) {
      setSendError(err.message || 'Failed to send transaction');
    } finally {
      setSendLoading(false);
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  const formatBalance = (balance: string | number) => {
    const num = typeof balance === 'string' ? parseFloat(balance) : balance;

    if (num === 0) return '0';

    // For very small amounts (less than 0.0001), show up to 8 decimals
    if (num < 0.0001) {
      return num.toFixed(8).replace(/\.?0+$/, '');
    }

    // For small amounts (less than 1), show up to 6 decimals
    if (num < 1) {
      return num.toFixed(6).replace(/\.?0+$/, '');
    }

    // For larger amounts, show up to 4 decimals
    return num.toFixed(4).replace(/\.?0+$/, '');
  };

  const nativeToken = portfolio.find(p => p.token.type === 'native');
  const nativeBalance = nativeToken ? parseFloat(nativeToken.balance) : 0;

  return (
    <div className="container">
      <Header
        network={network}
        networks={networks}
        currentAddress={address}
        currentWalletName={currentWalletName}
        currentAccountIndex={currentAccountIndex}
        onNetworkChange={handleNetworkChange}
        onAccountMenuClick={() => setShowAccountMenu(true)}
        onOpenSettings={() => setView('settings')}
        onLock={handleLock}
      />

      {showAccountMenu && (
        <AccountMenu
          currentAddress={address}
          currentWalletName={currentWalletName}
          onClose={() => setShowAccountMenu(false)}
          onAccountSwitch={() => {
            loadData();
            notifyStateChange();
            setShowAccountMenu(false);
          }}
          onWalletSwitch={() => {
            loadData();
            notifyStateChange();
            setShowAccountMenu(false);
          }}
          onStateChange={notifyStateChange}
        />
      )}

      {view !== 'settings' && (
        <div className="top-nav">
          <button
            className={`nav-item ${view === 'assets' ? 'active' : ''}`}
            onClick={() => setView('assets')}
          >
            <span className="nav-icon">💰</span>
            <span>Assets</span>
          </button>
          <button
            className={`nav-item ${view === 'receive' ? 'active' : ''}`}
            onClick={() => setView('receive')}
          >
            <span className="nav-icon">📥</span>
            <span>Receive</span>
          </button>
          <button
            className={`nav-item ${view === 'send' ? 'active' : ''}`}
            onClick={() => setView('send')}
          >
            <span className="nav-icon">📤</span>
            <span>Send</span>
          </button>
          <button
            className={`nav-item ${view === 'activity' ? 'active' : ''}`}
            onClick={() => setView('activity')}
          >
            <span className="nav-icon">📊</span>
            <span>Activity</span>
          </button>
        </div>
      )}

      <div className="content">
        {view === 'settings' ? (
          <SettingsView
            currentAddress={address}
            onAccountSwitch={() => loadData()}
            onWalletSwitch={() => loadData()}
            onStateChange={notifyStateChange}
            onClose={() => setView('assets')}
          />
        ) : view === 'assets' ? (
          <>
            {/* Main Balance */}
            <div className="wallet-card">
              <div className="balance-label">Total Balance</div>
              <div className="balance">
                <span className="balance-amount">{formatBalance(nativeBalance)}</span>
                <span className="balance-symbol">{nativeToken?.token.symbol || 'ETH'}</span>
              </div>
              <button
                className="btn btn-secondary"
                onClick={handleRefresh}
                disabled={refreshing}
                style={{ marginTop: '12px' }}
              >
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {/* Token List */}
            {loading ? (
              <div className="loading">Loading tokens...</div>
            ) : (
              <div className="token-list">
                {portfolio.map((item, index) => (
                  <div key={index} className="token-item">
                    <div className="token-info">
                      <div className="token-icon">
                        {item.token.symbol.substring(0, 1)}
                      </div>
                      <div className="token-details">
                        <h3>{item.token.symbol}</h3>
                        <p>{item.token.name}</p>
                      </div>
                    </div>
                    <div className="token-balance">
                      <div className="token-amount">
                        {item.error ? 'Error' : formatBalance(item.balance)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : view === 'activity' ? (
          <ActivityView
            currentAddress={address}
            network={network}
          />
        ) : view === 'receive' ? (
          <ReceiveView
            address={address}
            network={network}
            networks={networks}
          />
        ) : view === 'send' ? (
          /* Send Form */
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
                {portfolio.map((item, index) => (
                  <option key={index} value={item.token.symbol}>
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

            <button
              type="submit"
              className="btn btn-primary"
              disabled={sendLoading}
            >
              {sendLoading ? 'Sending...' : 'Send'}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export default MainWallet;
