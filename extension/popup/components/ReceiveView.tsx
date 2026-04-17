import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useToast } from '../context/ToastContext';
import { Icon } from './ui';

interface Props {
  address: string;
  network: string;
  networks: Record<string, any>;
}

function ReceiveView({ address, network, networks }: Props) {
  const { showToast } = useToast();
  const isXrp = network.startsWith('xrp-');
  const [justCopied, setJustCopied] = useState(false);

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setJustCopied(true);
      showToast('Address copied!');
      // Keep the inline "Copied" state a little longer than the toast so the
      // user sees the CTA confirm the action even if they dismissed the toast.
      window.setTimeout(() => setJustCopied(false), 1800);
    } catch (err) {
      console.error('Failed to copy address:', err);
      showToast('Failed to copy address', { duration: 3000, variant: 'error' });
    }
  };

  const handleShareAddress = async () => {
    if (navigator.share) {
      try {
        const networkName = networks[network]?.name || network;
        await navigator.share({
          title: `My ${networkName} Address`,
          text: `Here's my ${networkName} address:`,
          url: address, // Or use a block explorer link if available
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

  const networkName = networks[network]?.name || network;
  const nativeSymbol = networks[network]?.nativeSymbol || 'ETH';

  return (
    <div className="receive-view">
      {/* Header */}
      <div className="receive-header">
        <h2>Receive {nativeSymbol}</h2>
        <p className="receive-subtitle">Scan QR code or copy address</p>
      </div>

      {/* QR Code */}
      <div className="qr-container">
        <div className="qr-code-wrapper">
          <QRCodeSVG
            value={address}
            size={200}
            level="H"
            includeMargin={true}
          />
        </div>
      </div>

      {/* Address Section */}
      <div className="receive-address-section">
        <div className="receive-label">Your Address</div>
        <button
          type="button"
          className={`receive-address-chip${justCopied ? ' is-copied' : ''}`}
          onClick={handleCopyAddress}
          aria-label="Copy address"
        >
          <span className="receive-address-chip__addr">{address}</span>
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
        >
          <Icon name={justCopied ? 'check' : 'copy'} size={16} decorative />
          {justCopied ? 'Copied!' : 'Copy Address'}
        </button>
        {navigator.share && (
          <button className="btn btn-secondary" style={{ marginTop: '8px' }} onClick={handleShareAddress}>
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
          <strong>Important:</strong> Only send {nativeSymbol} and tokens on the <strong>{networkName}</strong> network to this address. Sending assets from other networks may result in permanent loss.
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
