import '../../src/process-polyfill.js';
import '../../src/buffer-polyfill.js';
import { installConsoleRedactor } from '../../src/utils/redact-logs.js';
installConsoleRedactor(import.meta.env.VITE_ALCHEMY_API_KEY);
installConsoleRedactor(import.meta.env.VITE_HELIUS_API_KEY);

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../popup/App';
import { ToastProvider } from '../popup/context/ToastContext';
import '../styles/tailwind.css';
import '../styles/ui-shared.css';
import '../popup/popup.css';
import './sidepanel.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
