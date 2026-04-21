/**
 * @file AssetPickerModal.tsx
 * @description Cross-chain asset picker used by the Send screen. Shows every
 *   (network, token) pair the wallet currently holds with a positive balance,
 *   each row labelled with a chain badge, symbol, balance and USD value.
 *   Selecting a row commits both network and token to the caller — the send
 *   flow uses that tuple to route the transaction to the right RPC.
 * @responsibilities
 *   - Fetch sendable assets via GET_SENDABLE_ASSETS (service worker flattens the
 *     unified-portfolio snapshot; no extra RPC load).
 *   - Filter by a typed search box.
 *   - Emit the picked asset through `onSelect` and close.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Modal from './ui/Modal';
import { getChainBadgeIcon } from '../utils/chainBadge';
import type { Token } from '../../../src/types/token.js';

export interface SendableAsset {
  networkKey: string;
  networkLabel: string;
  chainBadgeIcon?: string;
  token: Token;
  balance: string;
  balanceNumber: number;
  usdValue: number | null;
  usdFormatted: string | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (asset: SendableAsset) => void;
  /** Optional filter: only show assets matching this chain group. Used when a
   *  private-key wallet can only operate on one chain. */
  restrictToChain?: 'evm' | 'solana' | 'bitcoin' | 'xrp' | 'ton';
  /** Currently-selected asset, highlighted in the list. */
  selectedRowKey?: string;
}

function chainGroupForNetwork(networkKey: string): 'evm' | 'solana' | 'bitcoin' | 'xrp' | 'ton' {
  if (networkKey.startsWith('solana-')) return 'solana';
  if (networkKey.startsWith('bitcoin-')) return 'bitcoin';
  if (networkKey.startsWith('xrp-')) return 'xrp';
  if (networkKey.startsWith('ton-')) return 'ton';
  return 'evm';
}

function rowKey(a: SendableAsset): string {
  const tokenKey = a.token.type === 'native' ? 'native' : (a.token.address || a.token.symbol).toLowerCase();
  return `${a.networkKey}:${tokenKey}`;
}

export function AssetPickerModal({ isOpen, onClose, onSelect, restrictToChain, selectedRowKey }: Props) {
  const [assets, setAssets] = useState<SendableAsset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    chrome.runtime.sendMessage({ type: 'GET_SENDABLE_ASSETS' }, (resp) => {
      if (cancelled) return;
      setLoading(false);
      if (!resp || resp.error) {
        setError(resp?.error || 'Could not load assets');
        setAssets([]);
        return;
      }
      setAssets(resp.assets || []);
    });
    return () => { cancelled = true; };
  }, [isOpen]);

  // Reset search when the modal opens so the previous query doesn't bleed in.
  useEffect(() => {
    if (isOpen) setQuery('');
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!assets) return [];
    const q = query.trim().toLowerCase();
    return assets.filter(a => {
      if (restrictToChain && chainGroupForNetwork(a.networkKey) !== restrictToChain) {
        return false;
      }
      if (!q) return true;
      return (
        a.token.symbol.toLowerCase().includes(q) ||
        a.token.name?.toLowerCase().includes(q) ||
        a.networkLabel.toLowerCase().includes(q) ||
        a.networkKey.toLowerCase().includes(q)
      );
    });
  }, [assets, query, restrictToChain]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Select asset to send" size="md">
      <div className="asset-picker">
        <input
          type="text"
          className="asset-picker__search"
          placeholder="Search by token or network"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        {loading && <div className="asset-picker__state">Loading assets…</div>}
        {!loading && error && <div className="asset-picker__state is-error">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="asset-picker__state">
            {assets && assets.length > 0
              ? 'No matches'
              : 'No sendable balances yet. Fund the wallet on any supported chain to get started.'}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <ul className="asset-picker__list" role="listbox" aria-label="Sendable assets">
            {filtered.map(a => {
              const key = rowKey(a);
              const badge = a.chainBadgeIcon || getChainBadgeIcon(a.networkKey);
              const selected = key === selectedRowKey;
              return (
                <li key={key} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    className={`asset-picker__row${selected ? ' is-selected' : ''}`}
                    onClick={() => {
                      onSelect(a);
                      onClose();
                    }}
                  >
                    <span className="asset-picker__badge" aria-hidden>
                      {badge && <img src={badge} alt="" />}
                    </span>
                    <span className="asset-picker__main">
                      <span className="asset-picker__symbol">{a.token.symbol}</span>
                      <span className="asset-picker__network">{a.networkLabel}</span>
                    </span>
                    <span className="asset-picker__balance">
                      <span className="asset-picker__balance-token">{a.balance}</span>
                      {a.usdFormatted && (
                        <span className="asset-picker__balance-usd">≈ {a.usdFormatted}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export default AssetPickerModal;
