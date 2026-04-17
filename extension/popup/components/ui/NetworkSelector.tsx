/**
 * @fileoverview Network dropdown selector with optional testnet toggle.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Icon } from './Icon';

interface NetworkOption {
  value: string;
  label: string;
  icon?: string;
  disabled?: boolean;
}

interface Props {
  value: string;
  options: NetworkOption[];
  onChange: (value: string) => void;
  showTestnets?: boolean;
  onToggleShowTestnets?: (enabled: boolean) => void;
  className?: string;
}

/**
 * Render a network selector dropdown with an optional testnet toggle.
 *
 * @param value - Currently selected network key.
 * @param options - Visible network options.
 * @param onChange - Callback for network selection changes.
 * @param showTestnets - Whether testnets are currently visible.
 * @param onToggleShowTestnets - Callback to toggle testnet visibility.
 * @param className - Optional container class names.
 * @returns JSX element for the selector.
 */
export function NetworkSelector({
  value,
  options,
  onChange,
  showTestnets,
  onToggleShowTestnets,
  className = ''
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`network-selector-new ${className}`} ref={containerRef}>
      <button 
        type="button"
        className="network-button" 
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedOption?.icon ? (
          <img src={selectedOption.icon} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} />
        ) : (
          <div className="network-dot" />
        )}
        <span style={{ flex: 1, textAlign: 'left' }}>{selectedOption?.label || 'Select Network'}</span>
        <Icon
          name="chevron-down"
          size={14}
          decorative
          className={`dropdown-arrow${isOpen ? ' is-open' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="network-dropdown">
          {options.map((option) => (
            <div 
              key={option.value} 
              className={`network-option ${option.value === value ? 'active' : ''} ${option.disabled ? 'disabled' : ''}`}
              onClick={() => {
                if (option.disabled) return;
                onChange(option.value);
                setIsOpen(false);
              }}
              style={option.disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
              title={option.disabled ? 'Not available for private key wallets' : undefined}
            >
              {option.icon ? (
                <img src={option.icon} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} />
              ) : (
                <div className="network-dot" />
              )}
              <span>{option.label}</span>
              {option.disabled && (
                <Icon
                  name="lock"
                  size={12}
                  aria-label="Not available for this wallet"
                  style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }}
                />
              )}
            </div>
          ))}
          {onToggleShowTestnets && (
            <label className="network-toggle">
              <span>Show Test Networks</span>
              <input
                type="checkbox"
                checked={Boolean(showTestnets)}
                onChange={(event) => onToggleShowTestnets(event.target.checked)}
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

export default NetworkSelector;
