import { HttpError, json, withJsonRoute } from "../onramp/_lib/http";
import { getNotificationWorkerConfig } from "../../apps/notification-worker/src/config";
import { createHyperliquidMarketDataService } from "../../apps/notification-worker/src/hyperliquid";
import { runNotificationWorkerOnce } from "../../apps/notification-worker/src/run-once";
import { createSupabaseNotificationRepository } from "../../apps/notification-worker/src/supabase";
import { createTelegramClient } from "../../apps/notification-worker/src/telegram";

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
