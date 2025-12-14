import React, { useState, useRef, useEffect } from 'react';

interface NetworkOption {
  value: string;
  label: string;
  icon?: string;
}

interface Props {
  value: string;
  options: NetworkOption[];
  onChange: (value: string) => void;
  className?: string;
}

export function NetworkSelector({ value, options, onChange, className = '' }: Props) {
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
        <span className="dropdown-arrow">▼</span>
      </button>

      {isOpen && (
        <div className="network-dropdown">
          {options.map((option) => (
            <div 
              key={option.value} 
              className={`network-option ${option.value === value ? 'active' : ''}`}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              {option.icon ? (
                <img src={option.icon} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} />
              ) : (
                <div className="network-dot" />
              )}
              <span>{option.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default NetworkSelector;
