/**
 * SettingsView Component
 * 
 * Simplified settings page that directs users to the AccountMenu
 * for all wallet and account management operations.
 */
import React from 'react';
import { Button } from './ui/Button';

interface Props {
  onClose?: () => void;
}

function SettingsView({ onClose }: Props) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex justify-between items-center px-5 py-4 border-b border-border">
        <h2 className="text-base font-bold text-text-primary">Settings</h2>
        {onClose && (
          <Button variant="secondary" size="sm" onClick={onClose}>
            ← Back
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-8">
        <div className="bg-surface-secondary border border-border rounded-wallet p-5 text-center">
          <div className="text-4xl mb-4">⚙️</div>
          <p className="text-sm text-text-secondary mb-3 leading-relaxed">
            Wallet and account management is available in the main menu.
          </p>
          <p className="text-sm text-text-tertiary leading-relaxed">
            Click the account selector (top-left) to manage wallets and accounts.
          </p>
        </div>

        {/* Future settings sections can be added here */}
        <div className="mt-8 space-y-4">
          <div className="text-sm font-bold text-text-secondary uppercase tracking-wide mb-3">
            Preferences
          </div>
          
          <div className="flex items-center justify-between p-4 bg-white border border-border rounded-wallet-sm">
            <div>
              <div className="text-sm font-medium text-text-primary mb-1">Version</div>
              <div className="text-sm text-text-secondary">Simple Wallet Extension</div>
            </div>
            <div className="text-sm text-text-tertiary">1.0.0</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsView;
