/**
 * @fileoverview Toast notifications — stackable, variant-aware, auto-dismiss.
 *
 * Provides `useToast()` and a provider that renders a toast stack (bottom,
 * centered) above all app content. Use for:
 *   - short success confirmations (e.g. "Address copied")
 *   - non-blocking errors ("Failed to load balance")
 *   - info nudges
 *
 * Don't use for messages that require user action — use a Modal for that.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/ui/Icon';

export type ToastVariant = 'default' | 'success' | 'error' | 'info';

interface ToastEntry {
  id: number;
  message: string;
  variant: ToastVariant;
  /** Wall-clock ms when the entry's exit animation should start. */
  expiresAt: number;
  /** Set to true when we've started the exit animation. */
  leaving: boolean;
}

interface ToastContextType {
  /**
   * Show a toast. Signature preserves the legacy `(message, duration)` form
   * so existing callers don't need to change.
   */
  showToast: (
    message: string,
    durationOrOptions?: number | { duration?: number; variant?: ToastVariant },
  ) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

const DEFAULT_DURATION = 2400;
const EXIT_ANIMATION_MS = 180;

const variantIcon: Record<ToastVariant, React.ReactNode> = {
  default: null,
  success: <Icon name="check" size={14} decorative />,
  error: <Icon name="alert-circle" size={14} decorative />,
  info: <Icon name="info" size={14} decorative />,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_ANIMATION_MS);
  }, []);

  const showToast = useCallback<ToastContextType['showToast']>(
    (message, arg) => {
      const duration =
        typeof arg === 'number' ? arg : arg?.duration ?? DEFAULT_DURATION;
      const variant = typeof arg === 'object' ? arg.variant ?? 'default' : 'default';
      const id = nextId.current++;
      const entry: ToastEntry = {
        id,
        message,
        variant,
        expiresAt: Date.now() + duration,
        leaving: false,
      };
      setToasts((prev) => [...prev, entry]);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  // Safety: clear any lingering toasts if the provider unmounts.
  useEffect(() => {
    return () => setToasts([]);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-stack" role="region" aria-label="Notifications" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`toast toast--${t.variant}${t.leaving ? ' is-leaving' : ''}`}
              role={t.variant === 'error' ? 'alert' : 'status'}
            >
              {variantIcon[t.variant] && (
                <span className="toast__icon">{variantIcon[t.variant]}</span>
              )}
              <span className="toast__message">{t.message}</span>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
