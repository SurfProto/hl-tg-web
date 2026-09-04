interface EnvLike {
  [key: string]: string | undefined;
}

export interface NotificationWorkerConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  telegramBotToken: string;
  pollIntervalMs: number;
  deliveryBatchSize: number;
  hyperliquidTestnet: boolean;
  runOnce: boolean;
}

function getRequired(env: EnvLike, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function getBoolean(env: EnvLike, key: string, fallback = false): boolean {
  const value = env[key];
  if (!value) {
    return fallback;
  }

  return value === "1" || value.toLowerCase() === "true";
}

/**
 * A typo'd number must fall back, not propagate: Number("15s") is NaN, and
 * sleep(NaN) is a zero-delay tight loop hammering Supabase, Hyperliquid and
 * Telegram until someone notices.
 */
function getPositiveNumber(
  env: EnvLike,
  key: string,
  fallback: number,
): number {
  const parsed = Number(env[key] ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getNotificationWorkerConfig(
  env: EnvLike = process.env,
): NotificationWorkerConfig {
  return {
    supabaseUrl: getRequired(env, "SUPABASE_URL"),
    supabaseServiceRoleKey: getRequired(env, "SUPABASE_SERVICE_ROLE_KEY"),
    telegramBotToken: getRequired(env, "TELEGRAM_BOT_TOKEN"),
    pollIntervalMs: getPositiveNumber(env, "NOTIFICATION_POLL_INTERVAL_MS", 15000),
    deliveryBatchSize: getPositiveNumber(env, "NOTIFICATION_DELIVERY_BATCH_SIZE", 50),
    hyperliquidTestnet: getBoolean(env, "VITE_HYPERLIQUID_TESTNET", false),
    runOnce: getBoolean(env, "NOTIFICATION_RUN_ONCE", false),
  };
}
