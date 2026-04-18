/**
 * @fileoverview Sort modal for the unified portfolio view.
 *
 * Presents three sort options — fiat desc (default), alphabetical, and by
 * chain — and emits the chosen mode back to the parent. "By chain" is listed
 * as "Coming soon" for v1: the aggregator supports it but we haven't shipped
 * the sticky per-network section headers yet.
 */
import React from 'react';
import Modal from '../ui/Modal';
import type { TokenSort } from '../../../../src/types/unified-portfolio.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  value: TokenSort;
  onChange: (next: TokenSort) => void;
}

interface Option {
  value: TokenSort;
  label: string;
  description: string;
  disabled?: boolean;
  badge?: string;
}

const OPTIONS: Option[] = [
  {
    value: 'fiat',
    label: 'Declining balance (USD)',
    description: 'Biggest holdings first. Tokens without a price fall to the bottom.',
  },
  {
    value: 'alpha',
    label: 'Alphabetical (A → Z)',
    description: 'Sort by token name.',
  },
  {
    value: 'chain',
    label: 'By chain',
    description: 'Group rows by network. Sticky headers ship in a later release.',
    disabled: true,
    badge: 'Coming soon',
  },
];

export function SortModal({ isOpen, onClose, value, onChange }: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sort tokens" size="sm">
      <div className="sort-modal__options" role="radiogroup" aria-label="Sort tokens">
        {OPTIONS.map(opt => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={opt.disabled || undefined}
              disabled={opt.disabled}
              className={`sort-modal__option ${selected ? 'is-selected' : ''} ${opt.disabled ? 'is-disabled' : ''}`}
              onClick={() => {
                if (opt.disabled) return;
                onChange(opt.value);
                onClose();
              }}
            >
              <div className="sort-modal__radio" aria-hidden="true">
                {selected ? <span className="sort-modal__radio-dot" /> : null}
              </div>
              <div className="sort-modal__text">
                <div className="sort-modal__label">
                  {opt.label}
                  {opt.badge && <span className="sort-modal__badge">{opt.badge}</span>}
                </div>
                <div className="sort-modal__description">{opt.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

export default SortModal;
