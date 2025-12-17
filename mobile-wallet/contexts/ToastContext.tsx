/**
 * @fileoverview Toast context for app-wide toast notifications.
 * 
 * Provides a showToast function that can be called from anywhere
 * in the app to display a polished toast notification.
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Toast, ToastType } from '../components/Toast';

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

interface ToastState {
  visible: boolean;
  message: string;
  type: ToastType;
  key: number; // Used to reset animation on rapid successive calls
}

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: '',
    type: 'success',
    key: 0,
  });

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    setToast(prev => ({
      visible: true,
      message,
      type,
      key: prev.key + 1, // Increment key to force re-render on rapid calls
    }));
  }, []);

  const hideToast = useCallback(() => {
    setToast(prev => ({ ...prev, visible: false }));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Toast
        key={toast.key}
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={hideToast}
      />
    </ToastContext.Provider>
  );
}

/**
 * Hook to access toast functionality.
 * 
 * @returns Object with showToast function
 * @throws Error if used outside ToastProvider
 * 
 * @example
 * const { showToast } = useToast();
 * showToast('Address copied!', 'success');
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
