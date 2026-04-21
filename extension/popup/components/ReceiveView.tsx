/**
 * @file ReceiveView.tsx
 * @description Receive screen with a chain picker. Lets the user select which
 *   chain (EVM, Solana, Bitcoin, XRP, TON) to receive on without switching the
 *   wallet's active network. The service worker derives each per-chain address
 *   on demand via GET_CHAIN_ADDRESS so no key material crosses the boundary.
 * @responsibilities
 *   - Render the chain pill picker (with overflow fade-mask) and per-chain QR,
 *     address chip, warning note, and copy action.
 *   - Filter pills by wallet import type so private-key wallets only show the
 *     single pill that matches their `privateKeyType`.
 * @security
 *   - Never asks for or holds mnemonic / private-key material. Only receives
 *     already-derived public addresses from the service worker.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useToast } from '../context/ToastContext';
import { getChainBadgeIcon } from '../utils/chainBadge';
import { Icon } from './ui';

type ChainGroup = 'evm' | 'solana' | 'bitcoin' | 'xrp' | 'ton';

// Representative network key per group — used only to resolve the chain icon
// via the existing badge resolver. The actual address derivation path is
// chain-level (not network-level) so testnet chains share the icon.
const CHAIN_ICON_KEY: Record<ChainGroup, string> = {
  evm: 'mainnet',
  solana: 'solana-mainnet',
  bitcoin: 'bitcoin-mainnet',
  xrp: 'xrp-mainnet',
  ton: 'ton-mainnet',
};

interface ChainGroupDef {
  key: ChainGroup;
  label: string;
  full: string;
  assets: string[];
  note: string;
}

const CHAIN_GROUPS: ChainGroupDef[] = [
  {
    key: 'evm',
    label: 'EVM',
    full: 'Ethereum + L2s',
    assets: ['ETH', 'USDC', 'USDT', 'POL', 'ARB', 'OP', 'BASE'],
    note: 'One address works for Ethereum, Polygon, Arbitrum, Optimism, Base, Linea, and BNB Chain.',
  },
  {
    key: 'solana',
    label: 'Solana',
    full: 'Solana',
    assets: ['SOL', 'USDC'],
    note: 'Only send SPL tokens and SOL to this address.',
  },
  {
    key: 'bitcoin',
    label: 'Bitcoin',
    full: 'Bitcoin',
    assets: ['BTC'],
    note: 'Native SegWit (bech32). Do not send Lightning.',
  },
  {
    key: 'xrp',
    label: 'XRP',
    full: 'XRP Ledger',
    assets: ['XRP'],
    note: 'Some exchanges require a destination tag. Personal wallets usually do not.',
  },
  {
    key: 'ton',
    label: 'TON',
    full: 'TON',
    assets: ['TON', 'USDT'],
    note: 'Bounceable non-init (UQ) address.',
  },
];

function defaultChainForNetwork(network: string): ChainGroup {
  if (network.startsWith('solana-')) return 'solana';
  if (network.startsWith('bitcoin-')) return 'bitcoin';
  if (network.startsWith('xrp-')) return 'xrp';
  if (network.startsWith('ton-')) return 'ton';
  return 'evm';
}

interface Props {
  /** Initial address for the wallet's active network. Used as a fallback while
   *  the first per-chain derivation is in flight. */
  address: string;
  /** Active network key (e.g. 'mainnet', 'solana-mainnet'). Drives which pill
   *  is selected on first render. */
  network: string;
  networks: Record<string, any>;
  importType?: 'mnemonic' | 'privateKey' | null;
  privateKeyType?: ChainGroup | null;
}

function ReceiveView({ address, network, networks, importType, privateKeyType }: Props) {
  const { showToast } = useToast();
  const [selectedChain, setSelectedChain] = useState<ChainGroup>(() => defaultChainForNetwork(network));
  const [chainAddress, setChainAddress] = useState<string>(address);
  const [justCopied, setJustCopied] = useState(false);

  // Only show pills the wallet can satisfy. Mnemonic wallets cover all 5;
  // private-key imports are pinned to a single chain.
  const pills = useMemo(() => {
    if (importType === 'privateKey' && privateKeyType) {
      return CHAIN_GROUPS.filter(g => g.key === privateKeyType);
    }
    return CHAIN_GROUPS;
  }, [importType, privateKeyType]);

  // If the current selection isn't in the visible pill set (e.g. private-key
  // wallet loaded while default fell on a different chain), snap to the first.
  useEffect(() => {
    if (!pills.some(p => p.key === selectedChain)) {
      setSelectedChain(pills[0]?.key ?? 'evm');
    }
  }, [pills, selectedChain]);

  // Ask the service worker to derive the address for the selected chain.
  useEffect(() => {
    let cancelled = false;
    const defaultChain = defaultChainForNetwork(network);
    if (selectedChain === defaultChain && address) {
      // Active-network address is already loaded — use it directly.
      setChainAddress(address);
      return;
    }
    chrome.runtime.sendMessage({ type: 'GET_CHAIN_ADDRESS', payload: { chain: selectedChain } }, (resp) => {
      if (cancelled) return;
      if (resp?.error) {
        showToast(`Could not load ${selectedChain.toUpperCase()} address`, { duration: 3000, variant: 'error' });
        setChainAddress('');
        return;
      }
      setChainAddress(resp?.address ?? '');
    });
    return () => { cancelled = true; };
  }, [selectedChain, network, address, showToast]);

  // Reset the inline "Copied" state any time the displayed address changes so
  // the user never sees a stale confirmation against a new address.
  useEffect(() => { setJustCopied(false); }, [chainAddress]);

  const active = pills.find(p => p.key === selectedChain) ?? pills[0] ?? CHAIN_GROUPS[0];
  const isXrp = selectedChain === 'xrp';

  const handleCopyAddress = async () => {
    if (!chainAddress) return;
    try {
      await navigator.clipboard.writeText(chainAddress);
      setJustCopied(true);
      showToast('Address copied!');
      window.setTimeout(() => setJustCopied(false), 1800);
    } catch (err) {
      console.error('Failed to copy address:', err);
      showToast('Failed to copy address', { duration: 3000, variant: 'error' });
    }
  };

  const handleShareAddress = async () => {
    if (!chainAddress) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `My ${active.full} Address`,
          text: `Here's my ${active.full} address:`,
          url: chainAddress,
        });
        showToast('Address shared!');
      } catch (error) {
        console.error('Failed to share address:', error);
        showToast('Failed to share address', 3000);
      }
    } else {
      showToast('Share not supported on this browser.', 3000);
    }
  };

  const visibleAssets = active.assets.slice(0, 3);
  const overflow = active.assets.length - visibleAssets.length;

  // Track horizontal scroll so we can fade the edge the user could still
  // scroll toward — signals that more pills exist beyond the viewport.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollEdge, setScrollEdge] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      setScrollEdge({
        left: el.scrollLeft > 2,
        right: maxScroll > 2 && el.scrollLeft < maxScroll - 2,
      });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [pills.length]);

  return (
    <div className="receive-view">
      {/* Chain picker — horizontally scrollable pills with overflow fade-masks */}
      {pills.length > 1 && (
        <div
          className={`receive-chain-picker${scrollEdge.left ? ' is-scrolled-left' : ''}${scrollEdge.right ? ' is-scrolled-right' : ''}`}
        >
          <div className="receive-chain-picker__scroll" ref={scrollRef}>
            {pills.map(p => {
              const selected = p.key === selectedChain;
              const iconSrc = getChainBadgeIcon(CHAIN_ICON_KEY[p.key]);
              return (
                <button
                  key={p.key}
                  type="button"
                  className={`receive-chain-pill${selected ? ' is-active' : ''}`}
                  onClick={() => setSelectedChain(p.key)}
                  aria-pressed={selected}
                >
                  {iconSrc && (
                    <span className="receive-chain-pill__icon" aria-hidden>
                      <img src={iconSrc} alt="" />
                    </span>
                  )}
                  <span className="receive-chain-pill__label">{p.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Context row: full chain name + "Receives" asset chips */}
      <div className="receive-context-row">
        <span className="receive-context-name">{active.full}</span>
        <span className="receive-context-rule" />
        <span className="receive-context-label">Receives</span>
        {visibleAssets.map(a => (
          <span key={a} className="receive-asset-chip">{a}</span>
        ))}
        {overflow > 0 && <span className="receive-asset-more">+{overflow}</span>}
      </div>

      {/* QR Code */}
      <div className="qr-container">
        <div className="qr-code-wrapper">
          {chainAddress ? (
            <QRCodeSVG value={chainAddress} size={200} level="H" includeMargin={true} />
          ) : (
            <div style={{ width: 200, height: 200 }} aria-label="Loading address" />
          )}
        </div>
      </div>

      {/* Address Section */}
      <div className="receive-address-section">
        <div className="receive-label">{active.label} address</div>
        <button
          type="button"
          className={`receive-address-chip${justCopied ? ' is-copied' : ''}`}
          onClick={handleCopyAddress}
          aria-label="Copy address"
          disabled={!chainAddress}
        >
          <span className="receive-address-chip__addr">{chainAddress || '…'}</span>
          <span className="receive-address-chip__icon" aria-hidden>
            <Icon name={justCopied ? 'check' : 'copy'} size={16} decorative />
          </span>
        </button>
        <button
          className="btn btn-primary"
          style={{
            marginTop: '12px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
          onClick={handleCopyAddress}
          disabled={!chainAddress}
        >
          <Icon name={justCopied ? 'check' : 'copy'} size={16} decorative />
          {justCopied ? 'Copied!' : 'Copy Address'}
        </button>
        {typeof navigator.share === 'function' && (
          <button
            className="btn btn-secondary"
            style={{ marginTop: '8px' }}
            onClick={handleShareAddress}
            disabled={!chainAddress}
          >
            Share Address
          </button>
        )}
      </div>

      {/* Warning */}
      <div className="receive-warning">
        <div className="warning-icon">
          <Icon name="alert-triangle" size={16} decorative />
        </div>
        <div className="warning-content">
          <strong>{active.full}:</strong> {active.note}
        </div>
      </div>

      {isXrp && (
        <div className="receive-warning receive-warning--info" style={{ marginTop: 12 }}>
          <div className="warning-icon">
            <Icon name="info" size={16} decorative />
          </div>
          <div className="warning-content">
            <strong>XRP note:</strong> Some exchanges require a destination tag for deposits. Personal wallets typically do not.
          </div>
        </div>
      )}
    </div>
  );
}

export default ReceiveView;
