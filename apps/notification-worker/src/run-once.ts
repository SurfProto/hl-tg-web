import { detectDepositEvents } from "./detect-deposits";
import { detectFillEvents, type FillCursorState } from "./detect-fills";
import {
  detectLiquidationEvents,
  type LiquidationRiskState,
} from "./detect-liquidation";
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

  const pendingEvents = await repository.listPendingTelegramEvents(
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
  await repository.ensureTelegramChannel(user.userId, user.telegramId);

  const [fills, positions, depositOrders, fillState, liquidationState, depositState] =
    await Promise.all([
      marketData.getFills(user.walletAddress),
      marketData.getPositions(user.walletAddress),
      repository.listSuccessfulDepositOrders(user.userId),
      repository.getRuntimeState(user.userId, "fills"),
      repository.getRuntimeState(user.userId, "liquidation"),
      repository.getRuntimeState(user.userId, "deposits"),
    ]);

  const midsByCoin =
    positions.length > 0
      ? await marketData.getMids(
          Array.from(new Set(positions.map((position) => position.coin))),
        )
      : {};

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
  ]);
}
