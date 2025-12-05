import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface Props {
  address: string;
  network: string;
  networks: Record<string, any>;
}

function ReceiveView({ address, network, networks }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
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
        <div className="receive-address">{address}</div>
        <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={handleCopyAddress}>
          {copied ? '✓ Copied!' : 'Copy Address'}
        </button>
      </div>

      {/* Warning */}
      <div className="receive-warning">
        <div className="warning-icon">⚠️</div>
        <div className="warning-content">
          <strong>Important:</strong> Only send {nativeSymbol} and tokens on the <strong>{networkName}</strong> network to this address. Sending assets from other networks may result in permanent loss.
        </div>
      </div>
    </div>
  );
}

export default ReceiveView;
