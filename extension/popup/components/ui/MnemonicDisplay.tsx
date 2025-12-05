import React from 'react';

interface MnemonicDisplayProps {
  mnemonic: string;
  isRevealed: boolean;
}

export function MnemonicDisplay({ mnemonic, isRevealed }: MnemonicDisplayProps) {
  const words = mnemonic.split(' ');

  return (
    <div className="mnemonic-grid">
      {words.map((word, i) => (
        <div key={i} className="mnemonic-word">
          <span className="mnemonic-index">{i + 1}</span>
          <span className="mnemonic-text">{isRevealed ? word : '••••••'}</span>
        </div>
      ))}
    </div>
  );
}
