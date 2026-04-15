import { getNotificationWorkerConfig } from "./config";
import { createHyperliquidMarketDataService } from "./hyperliquid";
import { runNotificationWorkerOnce } from "./run-once";
import { createSupabaseNotificationRepository } from "./supabase";
import { createTelegramClient } from "./telegram";

async function ensureNodeRuntimeGlobals(): Promise<void> {
  if (typeof globalThis.WebSocket !== "undefined") {
    return;
  }

  const { WebSocket } = await import("ws");
  (globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket =
    WebSocket;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main(): Promise<void> {
  await ensureNodeRuntimeGlobals();

  const config = getNotificationWorkerConfig();
  const repository = createSupabaseNotificationRepository({
    supabaseUrl: config.supabaseUrl,
    supabaseServiceRoleKey: config.supabaseServiceRoleKey,
  });
  const marketData = createHyperliquidMarketDataService(
    config.hyperliquidTestnet,
  );
  const telegram = createTelegramClient(config.telegramBotToken);

  do {
    await runNotificationWorkerOnce({
      repository,
      marketData,
      telegram,
      now: new Date(),
      deliveryBatchSize: config.deliveryBatchSize,
    });

    if (config.runOnce) {
      return;
    }

    await sleep(config.pollIntervalMs);
  } while (true);
}

main().catch((error) => {
  console.error("[notification-worker] fatal", error);
  process.exitCode = 1;
});
