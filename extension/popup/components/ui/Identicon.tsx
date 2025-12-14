import React, { useMemo } from 'react';
// @ts-ignore - no types available for this package
import makeBlockie from 'ethereum-blockies-base64';

interface Props {
  address: string;
  size?: number; // size in pixels (rendered)
  className?: string;
}

export function Identicon({ address, size = 24, className = '' }: Props) {
  const blockieSrc = useMemo(() => {
    try {
      if (!address) return '';
      // Ensure address is lowercased for consistency if it's EVM, 
      // but keep case for base58 if that matters? 
      // Blockies just needs a seed string.
      return makeBlockie(address.toLowerCase());
    } catch (e) {
      return '';
    }
  }, [address]);

  if (!blockieSrc || !address) {
    // Return a placeholder or null
    return (
      <div 
        className={`bg-gray-200 rounded-full ${className}`} 
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <img 
      src={blockieSrc} 
      alt="Identicon" 
      className={`rounded-full select-none ${className}`}
      style={{ width: size, height: size }} 
    />
  );
}

export default Identicon;
