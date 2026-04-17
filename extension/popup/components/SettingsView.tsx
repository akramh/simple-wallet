/**
 * SettingsView Component
 * 
 * Settings page with security options and wallet management.
 */
import React, { useState, useEffect } from 'react';
import RevealSecretModal from './RevealSecretModal';
import ChangePasswordModal from './ChangePasswordModal';
import mnemonicIcon from '../../assets/icons/mnemonic.svg';
import keyIcon from '../../assets/icons/key.svg';
import lockIcon from '../../assets/icons/lock.svg';
import { applyTheme, getStoredTheme, setStoredTheme, type UiTheme } from '../theme';
import { Icon } from './ui';

interface Props {
  currentAddress?: string;
  onAccountSwitch?: () => void;
  onWalletSwitch?: () => void;
  onStateChange?: () => void;
  onClose?: () => void;
}

function SettingsView({ onClose }: Props) {
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [secretType, setSecretType] = useState<'mnemonic' | 'privateKey'>('mnemonic');
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

    // Fetch wallet state to check import type
    chrome.runtime.sendMessage({ type: 'GET_STATE' }).then(state => {
        if (state.importType) {
            setImportType(state.importType);
        }
    }).catch(err => console.warn('Failed to get wallet state', err));

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
      {/* Header */}
      <div className="settings-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
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

      {/* Content */}
      <div className="content">
        {/* Appearance Section */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
            Appearance
          </div>

          <div className="wallet-card" style={{ padding: '14px 16px' }}>
            <div className="theme-toggle-row">
              <div>
                <div className="theme-toggle-title">Theme</div>
                <div className="theme-toggle-subtitle">
                  {uiTheme === 'auto' ? 'Follow system appearance' :
                   uiTheme === 'dark' ? 'Dark' : 'Light'}
                </div>
              </div>
              <div
                className="theme-segmented"
                role="radiogroup"
                aria-label="Appearance"
              >
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
        </div>

        {/* Security Section */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
            Security
          </div>
          
          <div className="wallet-card" style={{ padding: '0' }}>
            {importType === 'mnemonic' && (
                <button
                onClick={() => handleRevealSecret('mnemonic')}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '14px 16px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    textAlign: 'left'
                }}
                >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <img src={mnemonicIcon} alt="" className="settings-icon" />
                    <div>
                    <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
                        Secret Recovery Phrase
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        View your 12-word recovery phrase
                    </div>
                    </div>
                </div>
                <Icon name="chevron-right" size={16} decorative style={{ color: 'var(--text-tertiary)' }} />
                </button>
            )}

            <button
              onClick={() => handleRevealSecret('privateKey')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '14px 16px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <img src={keyIcon} alt="" className="settings-icon" />
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
                    Private Key
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Export your account's private key
                  </div>
                </div>
              </div>
              <span style={{ color: 'var(--text-tertiary)', fontSize: '18px' }}>›</span>
            </button>

            <button
              onClick={() => setShowChangePassword(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '14px 16px',
                background: 'transparent',
                border: 'none',
                borderTop: '1px solid var(--border)',
                cursor: 'pointer',
                textAlign: 'left'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <img src={lockIcon} alt="" className="settings-icon" />
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
                    Change Password
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Update your wallet password
                  </div>
                </div>
              </div>
              <span style={{ color: 'var(--text-tertiary)', fontSize: '18px' }}>›</span>
            </button>
          </div>
        </div>

        {/* Info Section */}
        <div className="wallet-card" style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--radius-pill)',
              background: 'var(--surface-muted)',
              color: 'var(--text-tertiary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px',
            }}
          >
            <Icon name="settings" size={22} decorative />
          </div>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: 1.5 }}>
            Wallet and account management is available in the main menu.
          </p>
          <p style={{ fontSize: '14px', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            Click the account selector (top-left) to manage wallets and accounts.
          </p>
        </div>

        {/* Preferences Section */}
        <div style={{ marginTop: '24px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
            About
          </div>

          <div className="wallet-card" style={{ padding: '0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '4px' }}>Version</div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Simple Wallet Extension</div>
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>1.0.0</div>
            </div>

            <button
              onClick={() => {
                const url = chrome.runtime.getURL('licenses.html');
                chrome.tabs.create({ url });
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '14px 16px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left'
              }}
            >
              <div>
                <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
                  Open Source Licenses
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Third-party software attributions
                </div>
              </div>
              <span style={{ color: 'var(--text-tertiary)', fontSize: '18px' }}>›</span>
            </button>
          </div>
        </div>
      </div>

      {/* Reveal Secret Modal */}
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