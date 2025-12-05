/**
 * MainWallet Component
 * 
 * The primary wallet interface displaying:
 * - Portfolio/asset balances
 * - Send/receive functionality
 * - Activity/transaction history
 * - Multi-view navigation (assets, send, receive, activity, settings)
 */
import React, { useState, useEffect } from 'react';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Input';
import { Card } from './ui/Card';
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
          setView('assets');
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

  const nativeToken = portfolio.find(p => p.token.type === 'native');
  const nativeBalance = nativeToken ? parseFloat(nativeToken.balance) : 0;

  return (
    <div className="flex flex-col h-full bg-white">
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
          }}
          onWalletSwitch={() => {
            loadData();
            notifyStateChange();
            setShowAccountMenu(false);
          }}
          onStateChange={notifyStateChange}
        />
      )}

      {/* Navigation Tabs */}
      {view !== 'settings' && (
        <div className="flex bg-white border-b border-border px-3 py-2 gap-2">
          {['assets', 'receive', 'send', 'activity'].map((tab) => (
            <button
              key={tab}
              className={`flex-1 py-3 px-3 rounded-wallet-sm text-sm font-semibold transition-all capitalize
                ${view === tab 
                  ? 'bg-primary text-white' 
                  : 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
                }`}
              onClick={() => setView(tab as View)}
            >
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 p-5 overflow-y-auto">
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
            {/* Main Balance Card */}
            <Card className="mb-5 p-5">
              <div className="text-sm uppercase tracking-wide text-text-secondary mb-3">Total Balance</div>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-3xl font-bold text-text-primary">{formatBalance(nativeBalance)}</span>
                <span className="text-lg font-semibold text-text-secondary">{nativeToken?.token.symbol || 'ETH'}</span>
              </div>
              <Button 
                variant="secondary" 
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </Button>
            </Card>

            {/* Token List */}
            {loading ? (
              <div className="flex items-center justify-center py-16 text-text-secondary text-base">
                Loading tokens...
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {portfolio.map((item, index) => (
                  <div 
                    key={index} 
                    className="flex items-center justify-between p-4 bg-surface-secondary rounded-wallet"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center font-semibold text-base">
                        {item.token.symbol.substring(0, 1)}
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-text-primary leading-snug">{item.token.symbol}</h3>
                        <p className="text-sm text-text-secondary mt-1 leading-snug">{item.token.name}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold text-text-primary">
                        {item.error ? 'Error' : formatBalance(item.balance)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : view === 'activity' ? (
          <ActivityView currentAddress={address} network={network} />
        ) : view === 'receive' ? (
          <ReceiveView address={address} network={network} networks={networks} />
        ) : view === 'send' ? (
          <form onSubmit={handleSend} className="space-y-5">
            <Select
              label="Token"
              value={selectedToken?.symbol || ''}
              onChange={(e) => {
                const token = portfolio.find(p => p.token.symbol === e.target.value);
                setSelectedToken(token?.token || null);
              }}
              options={[
                { value: '', label: 'Select a token' },
                ...portfolio.map((item) => ({
                  value: item.token.symbol,
                  label: `${item.token.symbol} (${formatBalance(item.balance)})`
                }))
              ]}
            />

            <Input
              label="Recipient Address"
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
            />

            <Input
              label="Amount"
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
            />

            {sendError && (
              <p className="text-sm text-danger p-3 bg-danger-light rounded-wallet-sm">{sendError}</p>
            )}
            {sendSuccess && (
              <p className="text-sm text-success p-3 bg-success-light rounded-wallet-sm">{sendSuccess}</p>
            )}

            <Button type="submit" fullWidth loading={sendLoading}>
              {sendLoading ? 'Sending...' : 'Send'}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export default MainWallet;
