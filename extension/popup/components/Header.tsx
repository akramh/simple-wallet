import React, { useState, useEffect } from 'react';

interface Props {
  network: string;
  networks: Record<string, any>;
  currentAddress: string;
  currentWalletName: string;
  currentAccountIndex: number;
  onNetworkChange: (network: string) => void;
  onAccountMenuClick: () => void;
  onOpenSettings?: () => void;
  onLock: () => void;
}

function Header({
  network,
  networks,
  currentAddress,
  currentWalletName,
  currentAccountIndex,
  onNetworkChange,
  onAccountMenuClick,
  onOpenSettings,
  onLock
}: Props) {
  const [showNetworkMenu, setShowNetworkMenu] = useState(false);

  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  const handleNetworkSelect = (networkKey: string) => {
    onNetworkChange(networkKey);
    setShowNetworkMenu(false);
  };

  return (
    <div className="header-new">
      <div className="header-top">
        <div className="logo">
          <span className="logo-icon">🔐</span>
          <span className="logo-text">Simple Wallet</span>
        </div>
        <div className="header-actions">
          {onOpenSettings && (
            <button className="icon-btn" onClick={onOpenSettings} title="Settings">
              ⚙️
            </button>
          )}
          <button className="lock-btn" onClick={onLock} title="Lock Wallet">
            🔒
          </button>
        </div>
      </div>

      <div className="header-controls">
        {/* Network Selector */}
        <div className="network-selector-new">
          <button
            className="network-button"
            onClick={() => setShowNetworkMenu(!showNetworkMenu)}
          >
            <span className="network-dot"></span>
            <span>{networks[network]?.name || network}</span>
            <span className="dropdown-arrow">{showNetworkMenu ? '▲' : '▼'}</span>
          </button>

          {showNetworkMenu && (
            <div className="network-dropdown">
              {Object.entries(networks).map(([key, net]: [string, any]) => (
                <div
                  key={key}
                  className={`network-option ${key === network ? 'active' : ''}`}
                  onClick={() => handleNetworkSelect(key)}
                >
                  <span className="network-dot"></span>
                  <span>{net.name}</span>
                  {key === network && <span className="check">✓</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Account Button */}
        <button className="account-button" onClick={onAccountMenuClick}>
          <div className="account-avatar">
            {currentAddress.substring(2, 4).toUpperCase()}
          </div>
          <div className="account-info">
            <div className="account-name">{currentWalletName || `Account ${currentAccountIndex + 1}`}</div>
            <div className="account-address">{formatAddress(currentAddress)}</div>
          </div>
          <span className="dropdown-arrow">▼</span>
        </button>
      </div>
    </div>
  );
}

export default Header;
