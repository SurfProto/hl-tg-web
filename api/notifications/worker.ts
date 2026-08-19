import { HttpError, json, withJsonRoute } from "../onramp/_lib/http";

/**
 * The worker's dependencies are imported on demand, not at module scope.
 *
 * It also has to be on demand: every one of them lives in
 * apps/notification-worker, which is "type": "module", while Vercel compiles
 * this entrypoint to CommonJS. A static import becomes a require() of an ES
 * module and the function dies at load with ERR_REQUIRE_ESM — which is exactly
 * what the config import did, silently, until a smoke check asked.
 *
 * createHyperliquidMarketDataService pulls in the whole 2,400-line
 * HyperliquidClient and its viem graph. Loading that eagerly meant an
 * unauthorised request — the common case for a public endpoint — paid the full
 * cold-start cost before it could return 401. Earlier commits (see "Lazy-load
 * rewards Hyperliquid client") applied the same fix to the rewards routes.
 */
async function loadWorkerDependencies() {
  const [config, hyperliquid, runOnce, supabase, telegram] = await Promise.all([
    import("../../apps/notification-worker/src/config"),
    import("../../apps/notification-worker/src/hyperliquid"),
    import("../../apps/notification-worker/src/run-once"),
    import("../../apps/notification-worker/src/supabase"),
    import("../../apps/notification-worker/src/telegram"),
  ]);

  return {
    getNotificationWorkerConfig: config.getNotificationWorkerConfig,
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

    const now = new Date();

    const {
      getNotificationWorkerConfig,
      createHyperliquidMarketDataService,
      createSupabaseNotificationRepository,
      createTelegramClient,
      runNotificationWorkerOnce,
    } = await loadWorkerDependencies();

    const config = getNotificationWorkerConfig({
      ...process.env,
      NOTIFICATION_RUN_ONCE: "true",
    });

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
