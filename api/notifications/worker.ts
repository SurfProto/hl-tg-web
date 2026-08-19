import { HttpError, json, withJsonRoute } from "../onramp/_lib/http";

/**
 * The worker's dependencies are imported on demand, not at module scope.
 *
 * Note that "on demand" is not what makes these safe to import. Vercel compiles
 * this entrypoint to CommonJS, and TypeScript rewrites import() to
 * Promise.resolve().then(() => require()) under that setting — so every one of
 * these is a require() at runtime, lazy or not. While apps/notification-worker
 * declared "type": "module", Node refused all five with ERR_REQUIRE_ESM and
 * this route had never once completed a run. That field is gone; the package is
 * started with tsx from source and never needed it.
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
