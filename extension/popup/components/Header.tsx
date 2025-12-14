/**
 * Header Component
 * 
 * Displays the main navigation header with:
 * - App logo and branding
 * - Account/wallet selector button (shows wallet:account format)
 * - Settings and lock buttons
 * - Light/dark theme toggle (quick access on wallet home)
 */
import React, { useEffect, useState } from 'react';
import lockSlashIcon from '../../assets/icons/lock-slash.svg';
import settingIcon from '../../assets/icons/setting.svg';
import moonIcon from '../../assets/icons/moon.svg';
import sunIcon from '../../assets/icons/sun.svg';
import logoIcon from '../../assets/img/logo.svg';
import { applyTheme, getStoredTheme, setStoredTheme, type UiTheme } from '../theme';

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
  const [uiTheme, setUiTheme] = useState<UiTheme>('light');

  useEffect(() => {
    getStoredTheme()
      .then((theme) => setUiTheme(theme))
      .catch(() => {});
  }, []);

  const handleToggleTheme = async () => {
    const nextTheme: UiTheme = uiTheme === 'dark' ? 'light' : 'dark';
    setUiTheme(nextTheme);
    applyTheme(nextTheme);
    try {
      await setStoredTheme(nextTheme);
    } catch {
      // If persistence fails, keep the current session's theme applied.
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  const themeIcon = uiTheme === 'dark' ? sunIcon : moonIcon;
  const themeTitle = uiTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <div className="header-new">
      {/* Top row: Logo + Actions */}
      <div className="header-top">
        <div className="logo">
          <img src={logoIcon} alt="Simple Wallet" className="logo-icon" />
          <span className="logo-text">Simple Wallet</span>
        </div>
        <div className="header-actions">
          <button
            className="icon-btn"
            onClick={handleToggleTheme}
            title={themeTitle}
            aria-label={themeTitle}
          >
            <img src={themeIcon} alt="" className="header-icon" />
          </button>
          {onOpenSettings && (
            <button 
              className="icon-btn"
              onClick={onOpenSettings} 
              title="Settings"
              aria-label="Open settings"
            >
              <img src={settingIcon} alt="Settings" className="header-icon" />
            </button>
          )}
          <button 
            className="icon-btn"
            onClick={onLock} 
            title="Lock Wallet"
            aria-label="Lock wallet"
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
