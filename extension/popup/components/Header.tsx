/**
 * Header Component
 * 
 * Displays the main navigation header with:
 * - App logo and branding
 * - Network selector dropdown
 * - Account/wallet selector button (shows wallet:account format)
 * - Settings and lock buttons
 */
import React, { useState } from 'react';

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
    <div className="bg-white border-b border-border px-4 py-4">
      {/* Top row: Logo + Actions */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔐</span>
          <span className="text-lg font-bold text-text-primary">Simple Wallet</span>
        </div>
        <div className="flex items-center gap-3">
          {onOpenSettings && (
            <button 
              className="p-2 rounded-wallet-sm border border-border text-lg hover:bg-surface-secondary hover:border-primary transition-colors"
              onClick={onOpenSettings} 
              title="Settings"
            >
              ⚙️
            </button>
          )}
          <button 
            className="p-2 rounded-wallet-sm text-xl hover:bg-surface-secondary transition-colors"
            onClick={onLock} 
            title="Lock Wallet"
          >
            🔒
          </button>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex flex-col gap-4">
        {/* Network Selector */}
        <div className="relative">
          <button
            className="w-full flex items-center gap-2.5 px-4 py-2.5 bg-surface-secondary border border-border rounded-full text-sm font-semibold text-text-primary hover:bg-surface-tertiary hover:border-primary transition-all"
            onClick={() => setShowNetworkMenu(!showNetworkMenu)}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-success"></span>
            <span>{networks[network]?.name || network}</span>
            <span className="ml-auto text-xs text-text-secondary">{showNetworkMenu ? '▲' : '▼'}</span>
          </button>

          {showNetworkMenu && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-border rounded-wallet-sm shadow-wallet z-50 max-h-[280px] overflow-y-auto">
              {Object.entries(networks).map(([key, net]: [string, any]) => (
                <div
                  key={key}
                  className={`px-4 py-3 cursor-pointer flex items-center gap-2.5 text-sm transition-colors hover:bg-surface-secondary
                    ${key === network ? 'bg-primary-100 text-primary font-semibold' : ''}`}
                  onClick={() => handleNetworkSelect(key)}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-success"></span>
                  <span>{net.name}</span>
                  {key === network && <span className="ml-auto">✓</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Account Button */}
        <button 
          className="w-full flex items-center gap-3 px-4 py-3 bg-surface-secondary border border-border rounded-wallet-sm hover:bg-surface-tertiary hover:border-primary transition-all"
          onClick={onAccountMenuClick}
        >
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-sm font-bold shrink-0">
            {currentAddress.substring(2, 4).toUpperCase()}
          </div>
          <div className="flex-1 text-left min-w-0">
            <div className="text-sm font-semibold text-text-primary mb-1">{currentWalletName} : Account {currentAccountIndex + 1}</div>
            <div className="text-sm font-mono text-text-secondary">{formatAddress(currentAddress)}</div>
          </div>
          <span className="text-sm text-text-secondary">▼</span>
        </button>
      </div>
    </div>
  );
}

export default Header;
