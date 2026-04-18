import '../../src/process-polyfill.js';
import '../../src/buffer-polyfill.js';
import { installConsoleRedactor } from '../../src/utils/redact-logs.js';
installConsoleRedactor(import.meta.env.VITE_ALCHEMY_API_KEY);
installConsoleRedactor(import.meta.env.VITE_HELIUS_API_KEY);

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './context/ToastContext';
import '../styles/tailwind.css';
import '../styles/ui-shared.css';
import './popup.css';

/**
 * Open a long-lived port to the service worker so the background knows a
 * popup surface is connected. The service worker uses this signal to drive
 * the fast-path 30 s polling loop while the popup is open, and falls back
 * to the idle alarm when the popup closes and the port disconnects.
 *
 * Fire-and-forget: no response needed. Any error (service worker
 * temporarily unreachable during MV3 suspension) is swallowed — the alarm
 * will still maintain cadence in the background.
 */
try {
  chrome.runtime.connect({ name: 'popup' });
} catch {
  // Service worker not ready yet — alarm cadence still applies.
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
