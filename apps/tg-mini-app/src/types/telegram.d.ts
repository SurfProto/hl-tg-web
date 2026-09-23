interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    start_param?: string;
    user?: { id: number; first_name: string; username?: string };
  };
  version?: string;
  isVersionAtLeast?(version: string): boolean;
  ready(): void;
  expand(): void;
  close(): void;
  openLink(url: string): void;
  openTelegramLink?(url: string): void;
  MainButton: {
    text: string;
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
  };
  BackButton: {
    isVisible: boolean;
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  showAlert(message: string, callback?: () => void): void;
  showConfirm(message: string, callback?: (confirmed: boolean) => void): void;
  themeParams: Record<string, string>;
  colorScheme: 'light' | 'dark';
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  onEvent(eventType: 'viewportChanged', callback: () => void): void;
  offEvent(eventType: 'viewportChanged', callback: () => void): void;
}

/**
 * The Telegram Login Widget, defined by telegram-widget.js.
 *
 * This app loads telegram-web-app.js (which defines `Telegram.WebApp`) and
 * never the widget, so `Telegram.Login` is expected to be undefined here.
 * It is declared only so the auth diagnostic can report its absence: Privy's
 * `useLoginWithTelegram().login()` drives the widget flow, so when it is
 * missing that call cannot succeed and seamless mini-app auth has to carry
 * the login instead.
 */
interface TelegramLoginWidget {
  auth(
    options: { bot_id: string; request_access?: boolean },
    callback: (result: unknown) => void,
  ): void;
}

interface Window {
  Telegram?: { WebApp?: TelegramWebApp; Login?: TelegramLoginWidget };
  __APP_LOGS__?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    context?: unknown;
    timestamp: string;
  }>;
  requestIdleCallback?: (
    callback: (deadline: { readonly didTimeout: boolean; timeRemaining(): number }) => void,
    options?: { timeout?: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
}
