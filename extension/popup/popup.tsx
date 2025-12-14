import '../../src/process-polyfill.js';
import '../../src/buffer-polyfill.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './context/ToastContext';
import '../styles/tailwind.css';
import '../styles/ui-shared.css';
import './popup.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
