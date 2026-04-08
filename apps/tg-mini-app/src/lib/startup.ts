import { log } from "./logger";

export function migrateLegacyHashRoute() {
  const hash = window.location.hash;

  if (!hash.startsWith("#/")) {
    return;
  }

  const route = hash.slice(1);
  const nextUrl = route.includes("?")
    ? route
    : `${route}${window.location.search}`;
  window.history.replaceState(null, "", nextUrl);
}

export function syncTelegramViewportHeight() {
  const stableHeight = window.Telegram?.WebApp?.viewportStableHeight;
  const nextHeight =
    typeof stableHeight === "number" && stableHeight > 0
      ? `${stableHeight}px`
      : "100dvh";

  document.documentElement.style.setProperty(
    "--tg-viewport-height",
    nextHeight,
  );
}

export function bootstrapTelegramWebApp() {
  const webApp = window.Telegram?.WebApp;

  if (!webApp) {
    syncTelegramViewportHeight();
    return;
  }

  try {
    webApp.ready();
    webApp.expand();
  } catch (error) {
    log.warn("[telegram] bootstrap failed", { error });
  }

  syncTelegramViewportHeight();

  const handleViewportChanged = () => syncTelegramViewportHeight();
  webApp.onEvent?.("viewportChanged", handleViewportChanged);
}

export function teardownStartupShell() {
  const startupShell = document.getElementById("startup-shell");

  if (!startupShell) {
    return;
  }

  window.requestAnimationFrame(() => {
    startupShell.setAttribute("data-hidden", "true");
    window.setTimeout(() => startupShell.remove(), 180);
  });
}
