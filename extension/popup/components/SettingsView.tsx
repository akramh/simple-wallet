/**
 * SettingsView Component
 *
 * Settings page with appearance, security, and about sections.
 */
import React, { useState, useEffect } from 'react';
import RevealSecretModal from './RevealSecretModal';
import ChangePasswordModal from './ChangePasswordModal';
import mnemonicIcon from '../../assets/icons/mnemonic.svg';
import keyIcon from '../../assets/icons/key.svg';
import lockIcon from '../../assets/icons/lock.svg';
import { applyTheme, getStoredTheme, setStoredTheme, type UiTheme } from '../theme';
import { Icon } from './ui';
import AlchemyKeySetup, { type AlchemyKeyStatus } from './AlchemyKeySetup';
import { sendMessageWithRetry } from '../utils/messaging';

interface Props {
  currentAddress?: string;
  onAccountSwitch?: () => void;
  onWalletSwitch?: () => void;
  onStateChange?: () => void;
  onClose?: () => void;
}

interface RowProps {
  iconSrc?: string;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onClick?: () => void;
  /** Visually separate this row from the one above with a top border. */
  topBorder?: boolean;
}

/**
 * Single settings row — icon + title + subtitle + trailing affordance.
 * Used for Security and About sections. Presentational.
 */
function SettingsRow({ iconSrc, title, subtitle, trailing, onClick, topBorder }: RowProps) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`settings-row${topBorder ? ' has-top-border' : ''}`}
      onClick={onClick}
      {...(onClick ? { type: 'button' as const } : {})}
    >
      <div className="settings-row__main">
        {iconSrc && <img src={iconSrc} alt="" className="settings-icon" />}
        <div className="settings-row__text">
          <div className="settings-row__title">{title}</div>
          {subtitle && <div className="settings-row__subtitle">{subtitle}</div>}
        </div>
      </div>
      {trailing ?? (onClick && <Icon name="chevron-right" size={16} decorative className="settings-row__chev" />)}
    </Tag>
  );
}

function SettingsView({ onClose }: Props) {
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [secretType, setSecretType] = useState<'mnemonic' | 'privateKey'>('mnemonic');
  const [showAlchemyKey, setShowAlchemyKey] = useState(false);
  const [alchemyStatus, setAlchemyStatus] = useState<AlchemyKeyStatus | null>(null);

  const refreshAlchemyStatus = () => {
    sendMessageWithRetry<AlchemyKeyStatus>({ type: 'GET_ALCHEMY_KEY_STATUS' })
      .then(setAlchemyStatus)
      .catch(() => setAlchemyStatus(null));
  };

  useEffect(refreshAlchemyStatus, []);

  const alchemyKeySubtitle = !alchemyStatus
    ? 'Powers RPC, history, prices, and portfolio'
    : alchemyStatus.hasKey
      ? alchemyStatus.source === 'stored'
        ? `${alchemyStatus.masked} (entered here)`
        : `${alchemyStatus.masked} (build-time)`
      : 'Not set — add for full features';
  const [uiTheme, setUiTheme] = useState<UiTheme>('auto');
  const [importType, setImportType] = useState<'mnemonic' | 'privateKey' | null>(null);

  useEffect(() => {
    getStoredTheme()
      .then((theme) => setUiTheme(theme))
      .catch(() => {});

    // Stay in sync with changes made from Header or other popup instances.
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.uiTheme?.newValue) {
        setUiTheme(changes.uiTheme.newValue as UiTheme);
      }
    };
    chrome.storage.local?.onChanged.addListener(listener);

    chrome.runtime
      .sendMessage({ type: 'GET_STATE' })
      .then((state) => {
        if (state?.importType) setImportType(state.importType);
      })
      .catch((err) => console.warn('Failed to get wallet state', err));

    return () => chrome.storage.local?.onChanged.removeListener(listener);
  }, []);

  const handleRevealSecret = (type: 'mnemonic' | 'privateKey') => {
    setSecretType(type);
    setShowSecretModal(true);
  };

  const handleSelectTheme = async (next: UiTheme) => {
    if (next === uiTheme) return;
    setUiTheme(next);
    applyTheme(next);
    try {
      await setStoredTheme(next);
    } catch {
      // If persistence fails, keep the current session's theme applied.
    }
  };

  return (
    <div className="container">
      <div className="settings-header">
        {onClose && (
          <button
            className="btn btn-secondary btn-inline settings-back-btn"
            onClick={onClose}
            aria-label="Back"
          >
            <Icon name="arrow-left" size={16} decorative />
          </button>
        )}
        <h2 className="settings-title">Settings</h2>
      </div>

      <div className="content">
        {/* Appearance */}
        <section className="settings-section">
          <h3 className="settings-section__label">Appearance</h3>
          <div className="wallet-card settings-card">
            <div className="theme-toggle-row">
              <div>
                <div className="theme-toggle-title">Theme</div>
                <div className="theme-toggle-subtitle">
                  {uiTheme === 'auto'
                    ? 'Follow system appearance'
                    : uiTheme === 'dark'
                    ? 'Dark'
                    : 'Light'}
                </div>
              </div>
              <div className="theme-segmented" role="radiogroup" aria-label="Appearance">
                {(['light', 'dark', 'auto'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    role="radio"
                    aria-checked={uiTheme === opt}
                    className={`theme-segmented__btn${uiTheme === opt ? ' is-active' : ''}`}
                    onClick={() => handleSelectTheme(opt)}
                  >
                    {opt === 'light' ? 'Light' : opt === 'dark' ? 'Dark' : 'Auto'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Security */}
        <section className="settings-section">
          <h3 className="settings-section__label">Security</h3>
          <div className="wallet-card settings-card settings-card--rows">
            {importType === 'mnemonic' && (
              <SettingsRow
                iconSrc={mnemonicIcon}
                title="Secret Recovery Phrase"
                subtitle="View your 12-word recovery phrase"
                onClick={() => handleRevealSecret('mnemonic')}
              />
            )}
            <SettingsRow
              iconSrc={keyIcon}
              title="Private Key"
              subtitle="Export your account's private key"
              onClick={() => handleRevealSecret('privateKey')}
              topBorder={importType === 'mnemonic'}
            />
            <SettingsRow
              iconSrc={lockIcon}
              title="Change Password"
              subtitle="Update your wallet password"
              onClick={() => setShowChangePassword(true)}
              topBorder
            />
          </div>
        </section>

        {/* Network & API */}
        <section className="settings-section">
          <h3 className="settings-section__label">Network &amp; API</h3>
          <div className="wallet-card settings-card settings-card--rows">
            <SettingsRow
              iconSrc={keyIcon}
              title="Alchemy API Key"
              subtitle={alchemyKeySubtitle}
              onClick={() => setShowAlchemyKey((prev) => !prev)}
              trailing={
                <Icon
                  name={showAlchemyKey ? 'chevron-down' : 'chevron-right'}
                  size={16}
                  decorative
                  className="settings-row__chev"
                />
              }
            />
            {showAlchemyKey && (
              <div className="settings-card__expanded">
                <AlchemyKeySetup variant="settings" onSaved={refreshAlchemyStatus} />
              </div>
            )}
          </div>
        </section>

        {/* Hint card */}
        <div className="wallet-card settings-hint">
          <div className="settings-hint__icon">
            <Icon name="settings" size={22} decorative />
          </div>
          <p className="settings-hint__primary">
            Wallet and account management is available in the main menu.
          </p>
          <p className="settings-hint__secondary">
            Click the account selector (top-left) to manage wallets and accounts.
          </p>
        </div>

        {/* About */}
        <section className="settings-section">
          <h3 className="settings-section__label">About</h3>
          <div className="wallet-card settings-card settings-card--rows">
            <SettingsRow
              title="Version"
              subtitle="Simple Wallet Extension"
              trailing={<span className="settings-row__trailing-text">1.0.0</span>}
            />
            <SettingsRow
              title="Open Source Licenses"
              subtitle="Third-party software attributions"
              onClick={() => {
                const url = chrome.runtime.getURL('licenses.html');
                chrome.tabs.create({ url });
              }}
              topBorder
            />
          </div>
        </section>
      </div>

      <RevealSecretModal
        isOpen={showSecretModal}
        onClose={() => setShowSecretModal(false)}
        secretType={secretType}
      />
      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
    </div>
  );
}

export default SettingsView;
