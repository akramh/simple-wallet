import React, { useState, useEffect } from 'react';

interface Props {
  address: string;
  network: string;
  onLock: () => void;
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

type View = 'portfolio' | 'send';

function MainWallet({ address, network, onLock }: Props) {
  const [view, setView] = useState<View>('portfolio');
  const [portfolio, setPortfolio] = useState<TokenBalance[]>([]);
  const [networks, setNetworks] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
      const [portfolioResponse, networksResponse] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_PORTFOLIO' }),
        chrome.runtime.sendMessage({ type: 'GET_NETWORKS' })
      ]);

      if (portfolioResponse.portfolio) {
        setPortfolio(portfolioResponse.portfolio);
      }
      if (networksResponse.networks) {
        setNetworks(networksResponse.networks);
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

  const handleNetworkChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newNetwork = e.target.value;
    try {
      await chrome.runtime.sendMessage({
        type: 'SWITCH_NETWORK',
        payload: { network: newNetwork }
      });
      window.location.reload();
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

  const nativeToken = portfolio.find(p => p.token.type === 'native');
  const nativeBalance = nativeToken ? parseFloat(nativeToken.balance) : 0;

  return (
    <div className="container">
      <div className="header">
        <h1>Simple Wallet</h1>
        <button onClick={handleLock}>Lock</button>
      </div>

      <div className="content">
        {/* Network Selector */}
        <div className="network-selector">
          <div className="form-group">
            <label>Network</label>
            <select value={network} onChange={handleNetworkChange}>
              {Object.entries(networks).map(([key, net]: [string, any]) => (
                <option key={key} value={key}>
                  {net.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Address Display */}
        <div className="wallet-card">
          <div className="balance-label">Address</div>
          <div className="address">
            {formatAddress(address)}
            <button className="copy-btn" onClick={handleCopyAddress}>
              Copy
            </button>
          </div>
        </div>

        {/* View Tabs */}
        <div className="tabs">
          <button
            className={`tab ${view === 'portfolio' ? 'active' : ''}`}
            onClick={() => setView('portfolio')}
          >
            Portfolio
          </button>
          <button
            className={`tab ${view === 'send' ? 'active' : ''}`}
            onClick={() => setView('send')}
          >
            Send
          </button>
        </div>

        {view === 'portfolio' ? (
          <>
            {/* Main Balance */}
            <div className="wallet-card">
              <div className="balance-label">Total Balance</div>
              <div className="balance">
                {nativeBalance.toFixed(4)} {nativeToken?.token.symbol || 'ETH'}
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
                        {item.error ? 'Error' : parseFloat(item.balance).toFixed(4)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
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
                    {item.token.symbol} ({parseFloat(item.balance).toFixed(4)})
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
        )}
      </div>
    </div>
  );
}

export default MainWallet;
