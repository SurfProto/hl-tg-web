import { detectDepositEvents } from "./detect-deposits";
import { detectFillEvents } from "./detect-fills";
import { detectLiquidationEvents } from "./detect-liquidation";
import { processTelegramEvents } from "./process-telegram-events";
import type {
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
      state: fillState as { initialized: boolean; maxTid: number | null } | null,
      enabled: user.preferences.order_fills,
    });
    const liquidationResult = detectLiquidationEvents({
      user,
      positions,
      midsByCoin,
      state: liquidationState as {
        initialized: boolean;
        activeBandsByPosition: Record<string, number[]>;
      } | null,
      enabled: user.preferences.liquidation_alerts,
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
