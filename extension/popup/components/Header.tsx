/**
 * Header Component
 * 
 * Displays the main navigation header with:
 * - App logo and branding
 * - Account/wallet selector button (shows wallet:account format)
 * - Settings and lock buttons
 */
import React from 'react';
import lockSlashIcon from '../../assets/icons/lock-slash.svg';
import settingIcon from '../../assets/icons/setting.svg';

interface Props {
  network: string;
  networks: Record<string, any>;
 currentAddress: string;
 currentWalletName: string;
 currentAccountIndex: number;
 onAccountMenuClick: () => void;
 onOpenSettings?: () => void;
 onLock: () => void;
  showAccountButton?: boolean;
}

function Header({
  currentAddress,
  currentWalletName,
  currentAccountIndex,
  onAccountMenuClick,
  onOpenSettings,
  onLock,
  showAccountButton = true
}: Props) {
  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  return (
    <div className="header-new">
      {/* Top row: Logo + Actions */}
      <div className="header-top">
        <div className="logo">
          <span className="logo-text">Simple Wallet</span>
        </div>
        <div className="header-actions">
          {onOpenSettings && (
            <button 
              className="icon-btn"
              onClick={onOpenSettings} 
              title="Settings"
            >
              <img src={settingIcon} alt="Settings" className="header-icon" />
            </button>
          )}
          <button 
            className="lock-btn"
            onClick={onLock} 
            title="Lock Wallet"
          >
            <img src={lockSlashIcon} alt="Lock" className="header-icon" />
          </button>
        </div>
      </div>

      {/* Controls row */}
      {showAccountButton && (
        <div className="header-controls">
          {/* Account Button */}
          <button 
            className="account-button"
            onClick={onAccountMenuClick}
          >
            <div className="account-avatar">
              {currentAddress.substring(2, 4).toUpperCase()}
            </div>
            <div className="account-info">
              <div className="account-name">{currentWalletName} : Account {currentAccountIndex + 1}</div>
              <div className="account-address">{formatAddress(currentAddress)}</div>
            </div>
            <span className="dropdown-arrow">▼</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default Header;
