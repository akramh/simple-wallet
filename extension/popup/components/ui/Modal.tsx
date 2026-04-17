/**
 * @fileoverview Modal primitive — centered dialog with backdrop scrim.
 *
 * - Escape-to-close, click-scrim-to-close, body-scroll-lock while open.
 * - Uses the `--overlay-scrim` token so scrim darkness matches the theme.
 * - Animates in with fade + scale; the parent controls mount/unmount.
 */
import React, { useCallback, useEffect } from 'react';
import { Icon } from './Icon';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  showCloseButton?: boolean;
  zIndex?: number;
}

const sizeStyles = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true,
  zIndex,
}: ModalProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 animate-fade-in"
      style={{
        zIndex: zIndex ?? 'var(--z-modal)',
        backgroundColor: 'var(--overlay-scrim)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`
          w-full ${sizeStyles[size]} bg-surface-primary rounded-wallet-lg shadow-modal
          flex flex-col max-h-[90vh] animate-scale-in
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-6 py-3 border-b border-border">
            {title && (
              <h2 className="flex-1 text-base font-semibold text-text-primary mr-2">
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-secondary hover:text-text-primary transition-colors"
              >
                <Icon name="x" size={18} decorative />
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function ModalFooter({ children, className = '' }: ModalFooterProps) {
  return (
    <div
      className={`flex gap-3 pt-4 border-t border-border mt-4 -mx-5 -mb-5 px-5 py-4 bg-surface-secondary rounded-b-wallet-lg ${className}`}
    >
      {children}
    </div>
  );
}

export default Modal;
