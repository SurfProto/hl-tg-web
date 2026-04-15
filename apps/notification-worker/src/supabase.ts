import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  EligibleUser,
  NotificationPreferences,
  NotificationRepository,
  NotificationChannelStatus,
  PendingNotificationEvent,
  QueuedNotificationEvent,
  SuccessfulDepositOrder,
} from "./types";

interface UserRow {
  id: string;
  wallet_address: string | null;
  telegram_id: string | null;
  language: string | null;
}

interface PreferenceRow {
  user_id: string;
  liquidation_alerts: boolean | null;
  order_fills: boolean | null;
  usdc_deposits: boolean | null;
}

interface ChannelRow {
  user_id: string;
  target: string;
  status: NotificationChannelStatus;
}

interface EventRow {
  id: string;
  user_id: string;
  channel: "telegram";
  topic: "liquidation_risk" | "order_fill" | "usdc_deposit";
  attempts: number;
  payload: Record<string, unknown>;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  liquidation_alerts: true,
  order_fills: true,
  usdc_deposits: true,
};

export function createSupabaseNotificationRepository(args: {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}): NotificationRepository {
  const supabase = createClient(args.supabaseUrl, args.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return new SupabaseNotificationRepository(supabase);
}

class SupabaseNotificationRepository implements NotificationRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listEligibleUsers(): Promise<EligibleUser[]> {
    const [{ data: users, error: usersError }, { data: preferences, error: preferencesError }, { data: channels, error: channelsError }] =
      await Promise.all([
        this.supabase
          .from("users")
          .select("id, wallet_address, telegram_id, language")
          .not("telegram_id", "is", null),
        this.supabase
          .from("notification_preferences")
          .select("user_id, liquidation_alerts, order_fills, usdc_deposits"),
        this.supabase
          .from("notification_channels")
          .select("user_id, target, status")
          .eq("channel", "telegram"),
      ]);

    if (usersError) throw usersError;
    if (preferencesError) throw preferencesError;
    if (channelsError) throw channelsError;

    const preferencesByUser = new Map(
      (preferences ?? []).map((row) => [
        row.user_id,
        {
          liquidation_alerts:
            row.liquidation_alerts ?? DEFAULT_PREFERENCES.liquidation_alerts,
          order_fills: row.order_fills ?? DEFAULT_PREFERENCES.order_fills,
          usdc_deposits:
            row.usdc_deposits ?? DEFAULT_PREFERENCES.usdc_deposits,
        } satisfies NotificationPreferences,
      ]),
    );
    const channelsByUser = new Map((channels ?? []).map((row) => [row.user_id, row]));

    return (users ?? [])
      .filter(
        (row) => row.wallet_address && row.telegram_id,
      )
      .map((row) => {
        const prefs = preferencesByUser.get(row.id) ?? DEFAULT_PREFERENCES;
        const channel = channelsByUser.get(row.id);
        return {
          userId: row.id,
          walletAddress: row.wallet_address!,
          telegramId: row.telegram_id!,
          language: row.language ?? "en",
          preferences: prefs,
          channelStatus: channel?.status ?? null,
        } satisfies EligibleUser;
      })
      .filter(
        (user) =>
          user.channelStatus !== "blocked" &&
          user.channelStatus !== "invalid" &&
          (user.preferences.liquidation_alerts ||
            user.preferences.order_fills ||
            user.preferences.usdc_deposits),
      );
  }

  async ensureTelegramChannel(userId: string, telegramId: string): Promise<void> {
    const { error } = await this.supabase
      .from("notification_channels")
      .upsert(
        {
          user_id: userId,
          channel: "telegram",
          target: telegramId,
        },
        {
          onConflict: "user_id,channel",
          ignoreDuplicates: true,
        },
      );

    if (error) throw error;
  }

  async getRuntimeState<T>(userId: string, stateKey: string): Promise<T | null> {
    const { data, error } = await this.supabase
      .from("notification_runtime_state")
      .select("state")
      .eq("user_id", userId)
      .eq("state_key", stateKey)
      .maybeSingle();

    if (error) throw error;
    return (data?.state as T | undefined) ?? null;
  }

  async setRuntimeState(userId: string, stateKey: string, state: unknown): Promise<void> {
    const { error } = await this.supabase.from("notification_runtime_state").upsert(
      {
        user_id: userId,
        state_key: stateKey,
        state,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id,state_key",
      },
    );

    if (error) throw error;
  }

  async listSuccessfulDepositOrders(userId: string): Promise<SuccessfulDepositOrder[]> {
    const { data, error } = await this.supabase
      .from("onramp_orders")
      .select("provider_order_id, payout_amount, payout_currency, last_synced_at")
      .eq("user_id", userId)
      .eq("app_state", "success");

    if (error) throw error;

    return (data ?? []).map((row) => ({
      providerOrderId: row.provider_order_id,
      payoutAmount: row.payout_amount,
      payoutCurrency: row.payout_currency,
      lastSyncedAt: row.last_synced_at,
    }));
  }

  async enqueueEvent(event: QueuedNotificationEvent): Promise<void> {
    const { error } = await this.supabase.from("notification_events").upsert(
      {
        user_id: event.userId,
        channel: event.channel,
        topic: event.topic,
        status: "pending",
        idempotency_key: event.idempotencyKey,
        payload: event.payload,
        next_attempt_at: new Date().toISOString(),
      },
      {
        onConflict: "idempotency_key",
        ignoreDuplicates: true,
      },
    );

    if (error) throw error;
  }

  async listPendingTelegramEvents(limit: number, now: Date): Promise<PendingNotificationEvent[]> {
    const { data: events, error: eventsError } = await this.supabase
      .from("notification_events")
      .select("id, user_id, channel, topic, attempts, payload")
      .eq("channel", "telegram")
      .in("status", ["pending", "retry"])
      .lte("next_attempt_at", now.toISOString())
      .order("created_at", { ascending: true })
      .limit(limit);

    if (eventsError) throw eventsError;

    const userIds = Array.from(new Set((events ?? []).map((event) => event.user_id)));
    if (userIds.length === 0) {
      return [];
    }

    const { data: channels, error: channelsError } = await this.supabase
      .from("notification_channels")
      .select("user_id, target, status")
      .eq("channel", "telegram")
      .in("user_id", userIds);

    if (channelsError) throw channelsError;

    const channelsByUser = new Map((channels ?? []).map((row) => [row.user_id, row]));

    return (events ?? [])
      .map((event) => {
        const channel = channelsByUser.get(event.user_id);
        if (!channel?.target || channel.status !== "active") {
          return null;
        }

        return {
          id: event.id,
          userId: event.user_id,
          channel: event.channel,
          topic: event.topic,
          attempts: event.attempts,
          target: channel.target,
          language:
            typeof event.payload.language === "string"
              ? event.payload.language
              : "en",
          payload: event.payload,
        } satisfies PendingNotificationEvent;
      })
      .filter((event): event is PendingNotificationEvent => Boolean(event));
  }

  async markEventSent(eventId: string): Promise<void> {
    await this.bumpAttempts(eventId, {
      status: "sent",
      sent_at: new Date().toISOString(),
      last_error_code: null,
      last_error_message: null,
    });
  }

  async markEventRetry(
    eventId: string,
    nextAttemptAt: Date,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    await this.bumpAttempts(eventId, {
      status: "retry",
      next_attempt_at: nextAttemptAt.toISOString(),
      last_error_code: errorCode,
      last_error_message: errorMessage,
    });
  }

  async markEventFailed(
    eventId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    await this.bumpAttempts(eventId, {
      status: "failed",
      last_error_code: errorCode,
      last_error_message: errorMessage,
    });
  }

  async updateChannelStatus(
    userId: string,
    status: NotificationChannelStatus,
    errorCode: string | null,
    errorMessage: string | null,
  ): Promise<void> {
    const { error } = await this.supabase
      .from("notification_channels")
      .update({
        status,
        last_error_code: errorCode,
        last_error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("channel", "telegram");

    if (error) throw error;
  }

  private async bumpAttempts(
    eventId: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from("notification_events")
      .select("attempts")
      .eq("id", eventId)
      .maybeSingle();

    if (error) throw error;

    const { error: updateError } = await this.supabase
      .from("notification_events")
      .update({
        ...fields,
        attempts: (data?.attempts ?? 0) + 1,
      })
      .eq("id", eventId);

    if (updateError) throw updateError;
  }
}
