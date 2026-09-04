import { detectDepositEvents } from "./detect-deposits";
import { detectFillEvents, type FillCursorState } from "./detect-fills";
import {
  detectLiquidationEvents,
  type LiquidationRiskState,
} from "./detect-liquidation";
import { detectPriceAlertEvents } from "./detect-price-alerts";
import { processTelegramEvents } from "./process-telegram-events";
import type {
  EligibleUser,
  MarketDataService,
  NotificationRepository,
  TelegramClient,
} from "./types";

interface RunNotificationWorkerOnceArgs {
  repository: NotificationRepository;
  marketData: MarketDataService;
  telegram: TelegramClient;
  now: Date;
  deliveryBatchSize?: number;
}

export async function runNotificationWorkerOnce({
  repository,
  marketData,
  telegram,
  now,
  deliveryBatchSize = 50,
}: RunNotificationWorkerOnceArgs): Promise<void> {
  const eligibleUsers = await repository.listEligibleUsers();

  for (const user of eligibleUsers) {
    // One account's failure must not starve the accounts behind it. Without
    // this, a single wallet whose fills endpoint kept erroring took the whole
    // process down; systemd restarted it into the same user in the same list
    // order, so detection never got past them and delivery — which only runs
    // after this loop — never ran for anyone.
    try {
      await detectUserEvents(repository, marketData, user, now);
    } catch (error) {
      console.error(
        `[notifications] detection failed user=${user.userId}`,
        error,
      );
    }
  }

  const pendingEvents = await repository.claimPendingTelegramEvents(
    deliveryBatchSize,
    now,
  );
  await processTelegramEvents({
    events: pendingEvents,
    repository,
    telegram,
    now,
  });
}

async function detectUserEvents(
  repository: NotificationRepository,
  marketData: MarketDataService,
  user: EligibleUser,
  now: Date,
): Promise<void> {
  // Missing row, or a re-linked Telegram account whose channel still points
  // at the previous chat — re-point it (which also clears the old chat's
  // status). An unchanged channel takes no write.
  if (user.channelTarget !== user.telegramId) {
    await repository.ensureTelegramChannel(user.userId, user.telegramId);
  }

  const [
    fills,
    positions,
    depositOrders,
    priceAlerts,
    fillState,
    liquidationState,
    depositState,
  ] = await Promise.all([
    marketData.getFills(user.walletAddress),
    marketData.getPositions(user.walletAddress),
    repository.listSuccessfulDepositOrders(user.userId),
    repository.listActivePriceAlerts(user.userId),
    repository.getRuntimeState(user.userId, "fills"),
    repository.getRuntimeState(user.userId, "liquidation"),
    repository.getRuntimeState(user.userId, "deposits"),
  ]);

  // One mids fetch serves both consumers: liquidation bands need position
  // coins, price alerts need theirs.
  const midCoins = Array.from(
    new Set([
      ...positions.map((position) => position.coin),
      ...priceAlerts.map((alert) => alert.coin),
    ]),
  );
  const midsByCoin = midCoins.length > 0 ? await marketData.getMids(midCoins) : {};

  const fillResult = detectFillEvents({
    user,
    fills,
    state: fillState as FillCursorState | null,
    enabled: user.preferences.order_fills,
  });
  if (fillResult.dropped > 0) {
    // The burst cap fired. Always a symptom of something else — a cursor that
    // reset, or a state row a previous version could not read — so it must
    // not be silent.
    console.warn(
      `[notifications] fill burst capped user=${user.userId} dropped=${fillResult.dropped}`,
    );
  }

  const liquidationResult = detectLiquidationEvents({
    user,
    positions,
    midsByCoin,
    state: liquidationState as LiquidationRiskState | null,
    enabled: user.preferences.liquidation_alerts,
    nowIso: now.toISOString(),
  });
  const depositResult = detectDepositEvents({
    user,
    orders: depositOrders,
    state: depositState as {
      initialized: boolean;
      seenProviderOrderIds: string[];
    } | null,
    enabled: user.preferences.usdc_deposits,
  });
  // Creating an alert is the opt-in, so there is no preference gate here.
  const priceAlertResult = detectPriceAlertEvents({
    user,
    alerts: priceAlerts,
    midsByCoin,
  });

  await Promise.all([
    repository.setRuntimeState(user.userId, "fills", fillResult.state),
    repository.setRuntimeState(
      user.userId,
      "liquidation",
      liquidationResult.state,
    ),
    repository.setRuntimeState(user.userId, "deposits", depositResult.state),
    ...fillResult.events.map((event) => repository.enqueueEvent(event)),
    ...liquidationResult.events.map((event) => repository.enqueueEvent(event)),
    ...depositResult.events.map((event) => repository.enqueueEvent(event)),
    ...priceAlertResult.events.map((event) => repository.enqueueEvent(event)),
  ]);

  // Consumed only after the events are enqueued: a crash in between replays
  // into the enqueue's per-alert idempotency key rather than a second message.
  await Promise.all(
    priceAlertResult.triggeredAlertIds.map((alertId) =>
      repository.markPriceAlertTriggered(alertId),
    ),
  );
}
