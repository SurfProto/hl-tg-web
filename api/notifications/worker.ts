import { HttpError, json, withJsonRoute } from "../onramp/_lib/http";
import { getNotificationWorkerConfig } from "../../apps/notification-worker/src/config";

/**
 * The worker's dependencies are imported on demand, not at module scope.
 *
 * createHyperliquidMarketDataService pulls in the whole 2,400-line
 * HyperliquidClient and its viem graph. Loading that eagerly meant an
 * unauthorised request — the common case for a public endpoint — paid the full
 * cold-start cost before it could return 401. Earlier commits (see "Lazy-load
 * rewards Hyperliquid client") applied the same fix to the rewards routes.
 */
async function loadWorkerDependencies() {
  const [hyperliquid, runOnce, supabase, telegram] = await Promise.all([
    import("../../apps/notification-worker/src/hyperliquid"),
    import("../../apps/notification-worker/src/run-once"),
    import("../../apps/notification-worker/src/supabase"),
    import("../../apps/notification-worker/src/telegram"),
  ]);

  return {
    createHyperliquidMarketDataService: hyperliquid.createHyperliquidMarketDataService,
    createSupabaseNotificationRepository: supabase.createSupabaseNotificationRepository,
    createTelegramClient: telegram.createTelegramClient,
    runNotificationWorkerOnce: runOnce.runNotificationWorkerOnce,
  };
}

function ensureCronRequest(request: any) {
  if (request.method !== "GET") {
    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Expected GET");
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new HttpError(500, "CRON_SECRET_MISSING", "Missing CRON_SECRET");
  }

  const authorization = request.headers?.authorization ?? request.headers?.Authorization;
  if (authorization !== `Bearer ${cronSecret}`) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid cron authorization");
  }
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureCronRequest(request);

    const config = getNotificationWorkerConfig({
      ...process.env,
      NOTIFICATION_RUN_ONCE: "true",
    });
    const now = new Date();

    const {
      createHyperliquidMarketDataService,
      createSupabaseNotificationRepository,
      createTelegramClient,
      runNotificationWorkerOnce,
    } = await loadWorkerDependencies();

    await runNotificationWorkerOnce({
      repository: createSupabaseNotificationRepository({
        supabaseUrl: config.supabaseUrl,
        supabaseServiceRoleKey: config.supabaseServiceRoleKey,
      }),
      marketData: createHyperliquidMarketDataService(config.hyperliquidTestnet),
      telegram: createTelegramClient(config.telegramBotToken),
      now,
      deliveryBatchSize: config.deliveryBatchSize,
    });

    json(response, 200, {
      success: true,
      data: {
        processedAt: now.toISOString(),
      },
    });
  });
}
