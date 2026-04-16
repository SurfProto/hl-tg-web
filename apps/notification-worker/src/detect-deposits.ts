import type {
  EligibleUser,
  QueuedNotificationEvent,
  SuccessfulDepositOrder,
} from "./types";

interface DepositCursorState {
  initialized: boolean;
  seenProviderOrderIds: string[];
}

interface DetectDepositEventsArgs {
  user: EligibleUser;
  orders: SuccessfulDepositOrder[];
  state: DepositCursorState | null;
  enabled: boolean;
}

interface DetectDepositEventsResult {
  events: QueuedNotificationEvent[];
  state: DepositCursorState;
}

export function detectDepositEvents({
  user,
  orders,
  state,
  enabled,
}: DetectDepositEventsArgs): DetectDepositEventsResult {
  const nextSeenIds = Array.from(
    new Set([
      ...(state?.seenProviderOrderIds ?? []),
      ...orders.map((order) => order.providerOrderId),
    ]),
  ).sort();

  if (!state?.initialized) {
    return {
      events: [],
      state: {
        initialized: true,
        seenProviderOrderIds: nextSeenIds,
      },
    };
  }

  const seenIds = new Set(state.seenProviderOrderIds);
  const events = enabled
    ? orders
        .filter((order) => !seenIds.has(order.providerOrderId))
        .map<QueuedNotificationEvent>((order) => ({
          userId: user.userId,
          channel: "telegram",
          topic: "usdc_deposit",
          idempotencyKey: `usdc_deposit:${user.userId}:${order.providerOrderId}:success`,
          language: user.language,
          payload: {
            ...order,
            language: user.language,
          },
        }))
    : [];

  return {
    events,
    state: {
      initialized: true,
      seenProviderOrderIds: nextSeenIds,
    },
  };
}
