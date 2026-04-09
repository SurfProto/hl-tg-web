import React from "react";
import ReactDOM from "react-dom/client";
import {
  configureBuilder,
  loadHyperliquidSDK,
  loadHyperliquidSigning,
} from "@repo/hyperliquid-sdk";
import App from "./App";
import { installGlobalErrorLogging, log } from "./lib/logger";
import {
  bootstrapTelegramWebApp,
  migrateLegacyHashRoute,
} from "./lib/startup";
import "./index.css";

// Inject builder config from Vite env before any rendering.
// This keeps import.meta.env usage in the app layer (where Vite runs),
// not in the shared hyperliquid-sdk package.
configureBuilder(
  import.meta.env.VITE_BUILDER_ADDRESS ??
    "0x99E3327611c4d5aBfeaA9c64C151817a9554Fb5D",
  parseInt(import.meta.env.VITE_BUILDER_FEE || "50", 10),
);

installGlobalErrorLogging();
migrateLegacyHashRoute();
bootstrapTelegramWebApp();

void loadHyperliquidSDK().catch((error: unknown) => {
  log.warn("[startup] failed to preload Hyperliquid SDK", { error });
});

void loadHyperliquidSigning().catch((error: unknown) => {
  log.warn("[startup] failed to preload Hyperliquid signing", { error });
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
