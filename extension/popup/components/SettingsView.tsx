/**
 * SettingsView Component
 * 
 * Simplified settings page that directs users to the AccountMenu
 * for all wallet and account management operations.
 */
import React from 'react';

interface Props {
  onClose?: () => void;
}

function SettingsView({ onClose }: Props) {
  return (
    <div className="container">
      {/* Header */}
      <div className="settings-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <h2 className="settings-title">Settings</h2>
        {onClose && (
          <button className="btn btn-secondary btn-inline settings-back-btn" onClick={onClose}>
            ← Back
          </button>
        )}
      </div>

      {/* Content */}
      <div className="content">
        <div className="wallet-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '16px' }}>⚙️</div>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: 1.5 }}>
            Wallet and account management is available in the main menu.
          </p>
          <p style={{ fontSize: '14px', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            Click the account selector (top-left) to manage wallets and accounts.
          </p>
        </div>

        {/* Future settings sections can be added here */}
        <div style={{ marginTop: '32px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
            Preferences
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
    </div>
  );
}

export default SettingsView;
