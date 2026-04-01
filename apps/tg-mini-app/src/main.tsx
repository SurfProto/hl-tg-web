import React from 'react';
import ReactDOM from 'react-dom/client';
import { configureBuilder } from '@repo/hyperliquid-sdk';
import App from './App';
import './index.css';

// Inject builder config from Vite env before any rendering.
// This keeps import.meta.env usage in the app layer (where Vite runs),
// not in the shared hyperliquid-sdk package.
configureBuilder(
  import.meta.env.VITE_BUILDER_ADDRESS,
  parseInt(import.meta.env.VITE_BUILDER_FEE || '50', 10),
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
