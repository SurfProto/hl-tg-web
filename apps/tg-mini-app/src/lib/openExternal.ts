/**
 * Open a URL outside the mini app — through Telegram's own opener when the
 * WebApp bridge is present (a bare window.open can be swallowed by the
 * webview), falling back to a hardened window.open elsewhere.
 *
 * One implementation, one address: three pages carried verbatim copies of
 * this, which is exactly how copies drift.
 */
export function openExternal(url?: string | null): void {
  if (!url) return;
  if (window.Telegram?.WebApp?.openLink) {
    window.Telegram.WebApp.openLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
