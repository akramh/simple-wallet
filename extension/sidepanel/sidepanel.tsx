import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../popup/App';
import '../popup/popup.css';
import './sidepanel.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
