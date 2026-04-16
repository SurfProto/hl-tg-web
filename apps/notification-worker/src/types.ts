export type NotificationTopic =
  | "liquidation_risk"
  | "order_fill"
  | "usdc_deposit";

export type NotificationChannel = "telegram";
export type NotificationChannelStatus = "active" | "blocked" | "invalid";

export interface NotificationPreferences {
  liquidation_alerts: boolean;
  order_fills: boolean;
  usdc_deposits: boolean;
}

export interface EligibleUser {
  userId: string;
  walletAddress: string;
  telegramId: string;
  language: string;
  preferences: NotificationPreferences;
  channelStatus: NotificationChannelStatus | null;
}

export interface FillRecord {
  tid: number;
  coin: string;
  side: "buy" | "sell";
  px: number;
  sz: number;
  dir: "Open" | "Close" | "Flip";
  time: number;
  closedPnl: number;
}

export interface SuccessfulDepositOrder {
  providerOrderId: string;
  payoutAmount: string | null;
  payoutCurrency: string | null;
  lastSyncedAt: string | null;
}

export interface PositionSnapshot {
  coin: string;
  szi: number;
  liquidationPx: number | null;
  entryPx: number;
}

export interface QueuedNotificationEvent {
  userId: string;
  channel: NotificationChannel;
  topic: NotificationTopic;
  idempotencyKey: string;
  language: string;
  payload: Record<string, unknown>;
}

export interface PendingNotificationEvent {
  id: string;
  userId: string;
  channel: NotificationChannel;
  topic: NotificationTopic;
  attempts: number;
  target: string;
  language: string;
  payload: Record<string, unknown>;
}

export interface MarketDataService {
  getFills(walletAddress: string): Promise<FillRecord[]>;
  getPositions(walletAddress: string): Promise<PositionSnapshot[]>;
  getMids(coins: string[]): Promise<Record<string, number>>;
}

export interface TelegramSendResult {
  ok: boolean;
  code?: number;
  description?: string;
  retryAfterSeconds?: number;
}

export interface TelegramClient {
  sendMessage(args: {
    target: string;
    text: string;
  }): Promise<TelegramSendResult>;
}

export interface NotificationRepository {
  listEligibleUsers(): Promise<EligibleUser[]>;
  ensureTelegramChannel(userId: string, telegramId: string): Promise<void>;
  getRuntimeState<T>(userId: string, stateKey: string): Promise<T | null>;
  setRuntimeState(userId: string, stateKey: string, state: unknown): Promise<void>;
  listSuccessfulDepositOrders(userId: string): Promise<SuccessfulDepositOrder[]>;
  enqueueEvent(event: QueuedNotificationEvent): Promise<void>;
  listPendingTelegramEvents(limit: number, now: Date): Promise<PendingNotificationEvent[]>;
  markEventSent(eventId: string): Promise<void>;
  markEventRetry(
    eventId: string,
    nextAttemptAt: Date,
    errorCode: string,
    errorMessage: string,
  ): Promise<void>;
  markEventFailed(
    eventId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void>;
  updateChannelStatus(
    userId: string,
    status: NotificationChannelStatus,
    errorCode: string | null,
    errorMessage: string | null,
  ): Promise<void>;
}
