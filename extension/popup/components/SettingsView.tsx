/**
 * SettingsView Component
 * 
 * Settings page with security options and wallet management.
 */
import React, { useState } from 'react';
import RevealSecretModal from './RevealSecretModal';
import mnemonicIcon from '../../assets/icons/mnemonic.svg';
import keyIcon from '../../assets/icons/key.svg';
import { applyTheme, getStoredTheme, setStoredTheme, type UiTheme } from '../theme';

interface Props {
  currentAddress?: string;
  onAccountSwitch?: () => void;
  onWalletSwitch?: () => void;
  onStateChange?: () => void;
  onClose?: () => void;
}

function SettingsView({ onClose }: Props) {
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [secretType, setSecretType] = useState<'mnemonic' | 'privateKey'>('mnemonic');
  const [uiTheme, setUiTheme] = useState<UiTheme>('light');

  React.useEffect(() => {
    getStoredTheme()
      .then((theme) => setUiTheme(theme))
      .catch(() => {});
  }, []);

  const handleRevealSecret = (type: 'mnemonic' | 'privateKey') => {
    setSecretType(type);
    setShowSecretModal(true);
  };

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

  return (
    <div className="container">
      {/* Header */}
      <div className="settings-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        {onClose && (
          <button className="btn btn-secondary btn-inline settings-back-btn" onClick={onClose}>
            ←
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
                <div className="theme-toggle-subtitle">{uiTheme === 'dark' ? 'Dark' : 'Light'}</div>
              </div>
              <button
                type="button"
                className={`theme-toggle ${uiTheme === 'dark' ? 'on' : ''}`}
                role="switch"
                aria-checked={uiTheme === 'dark'}
                aria-label="Toggle dark mode"
                onClick={handleToggleTheme}
              >
                <span className="theme-toggle-thumb" />
              </button>
            </div>
          </div>
        </div>

        {/* Security Section */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
            Security
          </div>
          
          <div className="wallet-card" style={{ padding: '0' }}>
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
              <span style={{ color: 'var(--text-tertiary)', fontSize: '18px' }}>›</span>
            </button>

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
          </div>
        </div>

        {/* Info Section */}
        <div className="wallet-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '16px' }}>⚙️</div>
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
          
          <div className="wallet-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '4px' }}>Version</div>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Simple Wallet Extension</div>
            </div>
            <div style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>1.0.0</div>
          </div>
        </div>
      </div>

      {/* Reveal Secret Modal */}
      <RevealSecretModal
        isOpen={showSecretModal}
        onClose={() => setShowSecretModal(false)}
        secretType={secretType}
      />
    </div>
  );
}

export default SettingsView;
