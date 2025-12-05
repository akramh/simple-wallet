import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from './ui/Button';

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
    <div className="flex flex-col items-center px-6 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h2 className="text-xl font-bold text-text-primary mb-2">Receive {nativeSymbol}</h2>
        <p className="text-base text-text-secondary">Scan QR code or copy address</p>
      </div>

      {/* QR Code */}
      <div className="bg-white p-5 rounded-wallet-lg shadow-wallet border border-border mb-8">
        <QRCodeSVG
          value={address}
          size={200}
          level="H"
          includeMargin={true}
        />
      </div>

      {/* Address Section */}
      <div className="w-full text-center">
        <div className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
          Your Address
        </div>
        <div className="font-mono text-sm text-text-primary bg-surface-secondary border border-border rounded-wallet-sm p-4 break-all mb-4 leading-relaxed">
          {address}
        </div>
        <Button onClick={handleCopyAddress} className="w-full">
          {copied ? '✓ Copied!' : 'Copy Address'}
        </Button>
      </div>

      {/* Warning */}
      <div className="mt-8 w-full flex gap-4 bg-warning-light border border-warning rounded-wallet p-4">
        <div className="text-2xl shrink-0">⚠️</div>
        <div className="text-sm text-warning-dark leading-relaxed">
          <strong>Important:</strong> Only send {nativeSymbol} and tokens on the <strong>{networkName}</strong> network to this address. Sending assets from other networks may result in permanent loss.
        </div>
      </div>
    </div>
  );
}

export default ReceiveView;
