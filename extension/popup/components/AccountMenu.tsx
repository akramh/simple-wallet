/**
 * AccountMenu Component
 * 
 * A comprehensive modal for managing wallets and accounts.
 * Features: view/switch wallets & accounts, create/import wallets
 */
import React, { useState, useEffect, useRef } from 'react';
import { Button } from './ui/Button';
import { Input, TextArea } from './ui/Input';
import { Modal } from './ui/Modal';

interface Account {
  index: number;
  address: string;
  createdAt?: string;
}

interface WalletMeta {
  name: string;
  accounts: Record<number, { address: string; createdAt: string }>;
}

interface Props {
  currentAddress: string;
  currentWalletName?: string;
  onClose: () => void;
  onAccountSwitch: () => void;
  onWalletSwitch?: () => void;
  onStateChange?: () => void;
}

function AccountMenu({
  currentAddress,
  currentWalletName,
  onClose,
  onAccountSwitch,
  onWalletSwitch,
  onStateChange
}: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [wallets, setWallets] = useState<WalletMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success' | ''; message: string }>({ type: '', message: '' });
  const [importMnemonic, setImportMnemonic] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [createStep, setCreateStep] = useState<'form' | 'success'>('form');
  const [importStep, setImportStep] = useState<'form' | 'success'>('form');
  const [showCreatedMnemonic, setShowCreatedMnemonic] = useState(false);
  const [createdMnemonic, setCreatedMnemonic] = useState('');
  const [createdWalletName, setCreatedWalletName] = useState('');
  const [importedWalletName, setImportedWalletName] = useState('');
  const [toast, setToast] = useState('');
  const [pendingCreateName, setPendingCreateName] = useState('wallet1');
  const [pendingImportName, setPendingImportName] = useState('wallet1');
  const toastTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadAccounts();
    loadWallets();
    return () => {
      setStatus({ type: '', message: '' });
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const loadAccounts = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNTS' });
      if (response.accounts) {
        const accountList = Object.entries(response.accounts).map(([index, data]: [string, any]) => ({
          index: parseInt(index, 10),
          address: data.address,
          createdAt: data.createdAt
        }));
        setAccounts(accountList);
      }
    } catch (err) {
      console.error('Failed to load accounts:', err);
    }
  };

  const loadWallets = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_WALLETS' });
      if (response.wallets) {
        const walletList = Object.entries(response.wallets).map(([name, data]: [string, any]) => ({
          name,
          accounts: data.accounts || {}
        }));
        setWallets(walletList);
      }
    } catch (err) {
      console.error('Failed to load wallets:', err);
    }
  };

  const getNextWalletName = async (): Promise<string> => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_WALLETS' });
      const names = response?.wallets ? Object.keys(response.wallets) : [];
      let max = 0;
      names.forEach((name: string) => {
        const match = name.match(/^wallet(\d+)$/);
        if (match) max = Math.max(max, parseInt(match[1], 10));
      });
      return `wallet${max + 1 || 1}`;
    } catch {
      return 'wallet1';
    }
  };

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2000);
  };

  const handleSwitchAccount = async (walletName: string, accountIndex: number, accountAddress: string) => {
    if (accountAddress === currentAddress) return;

    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      if (walletName !== currentWalletName) {
        await chrome.runtime.sendMessage({ type: 'SWITCH_WALLET', payload: { name: walletName } });
      }
      await chrome.runtime.sendMessage({ type: 'SWITCH_ACCOUNT', payload: { index: accountIndex } });
      showToast(`Switched to ${walletName} - Account ${accountIndex + 1}`);
      await loadAccounts();
      await loadWallets();
      onAccountSwitch();
      onWalletSwitch?.();
      onStateChange?.();
      setTimeout(() => onClose(), 300);
    } catch (err) {
      setStatus({ type: 'error', message: 'Failed to switch account' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async () => {
    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CREATE_ACCOUNT' });
      showToast(`Account ${response.index + 1} created`);
      await loadAccounts();
      await loadWallets();
      onAccountSwitch();
      onStateChange?.();
    } catch (err) {
      setStatus({ type: 'error', message: 'Failed to create account' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWallet = async () => {
    const finalName = pendingCreateName || (await getNextWalletName());
    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CREATE_WALLET',
        payload: { name: finalName }
      });
      if (response.error) {
        setStatus({ type: 'error', message: response.error });
      } else {
        setCreatedMnemonic(response.mnemonic || '');
        setShowCreatedMnemonic(false);
        setCreatedWalletName(finalName);
        setCreateStep('success');
        setPendingCreateName(await getNextWalletName());
      }
    } catch (err) {
      setStatus({ type: 'error', message: 'Failed to create wallet' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWalletDone = async () => {
    setLoading(true);
    try {
      await Promise.all([loadWallets(), loadAccounts()]);
      await chrome.runtime.sendMessage({ type: 'SWITCH_WALLET', payload: { name: createdWalletName } });
      showToast(`Switched to ${createdWalletName}`);
      onWalletSwitch?.();
      onStateChange?.();
      setShowCreateModal(false);
      setCreateStep('form');
      setShowCreatedMnemonic(false);
      setCreatedMnemonic('');
    } catch (err) {
      setStatus({ type: 'error', message: 'Wallet created but failed to switch' });
    } finally {
      setLoading(false);
    }
  };

  const handleImportWallet = async () => {
    const finalName = pendingImportName || (await getNextWalletName());
    if (!importMnemonic.trim()) {
      setStatus({ type: 'error', message: 'Please paste a recovery phrase' });
      return;
    }
    if (importMnemonic.trim().split(/\s+/).length < 12) {
      setStatus({ type: 'error', message: 'Recovery phrase looks too short' });
      return;
    }

    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_WALLET',
        payload: { mnemonic: importMnemonic.trim(), name: finalName }
      });
      if (response.error) {
        setStatus({ type: 'error', message: response.error });
      } else {
        setImportMnemonic('');
        setImportedWalletName(finalName);
        setImportStep('success');
        await Promise.all([loadWallets(), loadAccounts()]);
        await chrome.runtime.sendMessage({ type: 'SWITCH_WALLET', payload: { name: finalName } });
        onWalletSwitch?.();
        onStateChange?.();
        setPendingImportName(await getNextWalletName());
      }
    } catch (err) {
      setStatus({ type: 'error', message: 'Failed to import wallet' });
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (addr: string) => `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;

  const getWalletsWithAccounts = () => {
    return wallets.map(wallet => ({
      name: wallet.name,
      accounts: Object.entries(wallet.accounts || {})
        .map(([index, data]: [string, any]) => ({
          index: parseInt(index, 10),
          address: data.address,
          createdAt: data.createdAt
        }))
        .sort((a, b) => a.index - b.index)
    }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-wallet-lg w-full max-w-[520px] max-h-[90vh] flex flex-col shadow-modal animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-7 py-6 border-b border-border bg-gradient-to-b from-gray-50 to-white">
          <div>
            <div className="text-sm text-text-secondary uppercase tracking-wide mb-1.5">Current wallet</div>
            <div className="text-xl font-bold text-text-primary">{currentWalletName || 'Wallet'}</div>
          </div>
          <button
            className="w-10 h-10 flex items-center justify-center rounded-wallet-sm text-2xl text-text-secondary hover:bg-surface-secondary hover:text-text-primary transition-colors"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Status Alert */}
        {status.message && (
          <div className={`mx-6 mt-5 p-4 rounded-wallet-sm text-sm border ${
            status.type === 'error' 
              ? 'bg-danger-light border-danger text-danger-dark' 
              : 'bg-success-light border-success text-success-dark'
          }`}>
            {status.message}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-7 space-y-7">
          {/* Section Header */}
          <div className="flex justify-between items-center gap-4">
            <div className="text-lg font-bold text-text-primary">Wallets</div>
            <div className="flex gap-3">
              <button
                className="px-5 py-3 text-sm font-semibold border border-border rounded-wallet-sm hover:bg-surface-secondary hover:border-primary transition-all"
                onClick={async () => {
                  setPendingImportName(await getNextWalletName());
                  setShowImportModal(true);
                }}
              >
                Import
              </button>
              <button
                className="px-5 py-3 text-sm font-semibold bg-primary text-white rounded-wallet-sm hover:bg-primary-dark transition-all"
                onClick={async () => {
                  setPendingCreateName(await getNextWalletName());
                  setShowCreateModal(true);
                }}
              >
                Create
              </button>
            </div>
          </div>

          {/* Wallet List */}
          <div className="flex flex-col gap-6">
            {getWalletsWithAccounts().map((wallet) => (
              <div key={wallet.name}>
                <div className="text-sm font-semibold text-text-secondary px-1 mb-3">
                  {wallet.name}
                </div>

                <div className="flex flex-col gap-3.5 max-h-[320px] overflow-y-auto scrollbar-thin pr-1">
                  {wallet.accounts.map((account) => (
                    <div
                      key={`${wallet.name}-${account.index}`}
                      className={`flex items-center gap-5 p-5 rounded-wallet cursor-pointer transition-all border-2
                        ${account.address === currentAddress
                          ? 'bg-gradient-to-r from-primary-50 to-primary-100 border-primary shadow-sm'
                          : 'border-transparent hover:bg-surface-secondary hover:border-border-dark'
                        }`}
                      onClick={() => handleSwitchAccount(wallet.name, account.index, account.address)}
                    >
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-sm font-bold shrink-0">
                        {account.address.substring(2, 4).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-base font-semibold text-text-primary">Account {account.index + 1}</div>
                        <div className="text-sm font-mono text-text-secondary mt-1">{formatAddress(account.address)}</div>
                      </div>
                      {account.address === currentAddress && (
                        <span className="text-primary font-bold text-xl">✓</span>
                      )}
                    </div>
                  ))}

                  {wallet.name === currentWalletName && (
                    <button
                      className="w-full py-4 mt-2 text-primary text-sm font-semibold hover:bg-primary/5 rounded-wallet-sm transition-all disabled:opacity-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateAccount();
                      }}
                      disabled={loading}
                    >
                      + Add account
                    </button>
                  )}
                </div>
              </div>
            ))}

            {getWalletsWithAccounts().length === 0 && (
              <div className="text-center py-12 text-text-secondary text-base">
                No wallets yet. Create or import one to get started.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create Wallet Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          if (createStep === 'success') {
            if (!confirm("Make sure you've saved your recovery phrase!")) return;
          }
          setShowCreateModal(false);
          setCreateStep('form');
          setCreatedMnemonic('');
        }}
        title={createStep === 'success' ? `Wallet: ${createdWalletName}` : 'Create wallet'}
        zIndex={60}
      >
        {status.message && createStep === 'form' && (
          <div className={`mb-5 p-4 rounded-wallet-sm text-sm border ${
            status.type === 'error' ? 'bg-danger-light border-danger text-danger-dark' : 'bg-success-light border-success text-success-dark'
          }`}>
            {status.message}
          </div>
        )}

        {createStep === 'success' && createdMnemonic && (
          <>
            <div className="bg-warning-light border border-warning rounded-wallet-sm p-4 mb-5 text-warning-dark">
              <strong className="block mb-1.5">⚠️ Save your recovery phrase!</strong>
              <span className="text-sm">This is the only way to recover your wallet.</span>
            </div>

            <div className="border border-border rounded-wallet-sm p-4 bg-surface-secondary mb-5">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm text-text-secondary">Recovery phrase</span>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1.5 text-sm font-semibold border border-border rounded-wallet-sm hover:bg-white transition-colors"
                    onClick={() => {
                      navigator.clipboard.writeText(createdMnemonic);
                      showToast('Copied!');
                    }}
                  >
                    📋 Copy
                  </button>
                  <button
                    className="px-3 py-1.5 text-sm font-semibold border border-border rounded-wallet-sm hover:bg-white transition-colors"
                    onClick={() => setShowCreatedMnemonic(v => !v)}
                  >
                    {showCreatedMnemonic ? '👁️ Hide' : '👁️ Reveal'}
                  </button>
                </div>
              </div>
              <div className={`font-mono text-sm p-3 bg-white rounded-wallet-sm border border-border break-all leading-relaxed ${!showCreatedMnemonic ? 'blur-sm select-none' : ''}`}>
                {showCreatedMnemonic ? createdMnemonic : '•••• •••• •••• •••• •••• •••• •••• •••• •••• •••• •••• ••••'}
              </div>
            </div>
          </>
        )}

        {createStep === 'form' ? (
          <Button fullWidth onClick={handleCreateWallet} loading={loading}>
            Create wallet
          </Button>
        ) : (
          <Button fullWidth onClick={handleCreateWalletDone} loading={loading}>
            Done — Switch to wallet
          </Button>
        )}
      </Modal>

      {/* Import Wallet Modal */}
      <Modal
        isOpen={showImportModal}
        onClose={() => {
          setShowImportModal(false);
          setImportStep('form');
          setImportMnemonic('');
        }}
        title="Import wallet"
        zIndex={60}
      >
        {status.message && (
          <div className={`mb-5 p-4 rounded-wallet-sm text-sm border ${
            status.type === 'error' ? 'bg-danger-light border-danger text-danger-dark' : 'bg-success-light border-success text-success-dark'
          }`}>
            {status.message}
          </div>
        )}

        {importStep === 'form' ? (
          <>
            <TextArea
              label="Recovery Phrase"
              rows={3}
              placeholder="Enter your 12-24 word phrase"
              value={importMnemonic}
              onChange={(e) => setImportMnemonic(e.target.value)}
              className="mb-5"
            />
            <Button
              fullWidth
              onClick={handleImportWallet}
              loading={loading}
              disabled={importMnemonic.trim().split(/\s+/).length < 12}
            >
              Import wallet
            </Button>
          </>
        ) : (
          <>
            <div className="bg-success-light border border-success text-success-dark rounded-wallet-sm p-3 mb-4 text-sm">
              Wallet "{importedWalletName}" imported successfully!
            </div>
            <Button fullWidth onClick={() => {
              setShowImportModal(false);
              setImportStep('form');
            }}>
              Go to wallet
            </Button>
          </>
        )}
      </Modal>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-3 rounded-wallet font-medium text-sm shadow-modal z-[60] animate-slide-up">
          {toast}
        </div>
      )}
    </div>
  );
}

export default AccountMenu;
