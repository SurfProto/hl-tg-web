export type AppLogLevel = "debug" | "info" | "warn" | "error";

export interface AppLogEntry {
  level: AppLogLevel;
  message: string;
  context?: unknown;
  timestamp: string;
}

const MAX_LOG_ENTRIES = 200;
const shouldBufferLogs =
  import.meta.env.DEV || import.meta.env.MODE === "test";
const shouldWriteToConsole = import.meta.env.MODE !== "test";

function getConsoleMethod(level: AppLogLevel) {
  switch (level) {
    case "debug":
      return console.debug;
    case "info":
      return console.info;
    case "warn":
      return console.warn;
    case "error":
      return console.error;
  }
}

function pushLogEntry(entry: AppLogEntry) {
  if (!shouldBufferLogs) {
    return;
  }

  const nextLogs = [...(window.__APP_LOGS__ ?? []), entry].slice(
    -MAX_LOG_ENTRIES,
  );
  window.__APP_LOGS__ = nextLogs;
}

function write(level: AppLogLevel, message: string, context?: unknown) {
  const entry: AppLogEntry = {
    level,
    message,
    context,
    timestamp: new Date().toISOString(),
  };

  pushLogEntry(entry);

  if (!shouldWriteToConsole) {
    return;
  }

  const logToConsole = getConsoleMethod(level);
  if (typeof context === "undefined") {
    logToConsole(message);
    return;
  }

  logToConsole(message, context);
}

export const log = {
  debug(message: string, context?: unknown) {
    write("debug", message, context);
  },
  info(message: string, context?: unknown) {
    write("info", message, context);
  },
  warn(message: string, context?: unknown) {
    write("warn", message, context);
  },
  error(message: string, context?: unknown) {
    write("error", message, context);
  },
};

export function getAppLogs() {
  return window.__APP_LOGS__ ?? [];
}

export function clearAppLogs() {
  window.__APP_LOGS__ = [];
}

let globalErrorLoggingInstalled = false;

export function installGlobalErrorLogging() {
  if (globalErrorLoggingInstalled) {
    return;
  }

  window.addEventListener("error", (event) => {
    log.error("window.error", {
      message: event.message,
      error: event.error,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    log.error("window.unhandledrejection", {
      reason: event.reason,
    });
  });

  globalErrorLoggingInstalled = true;
}
