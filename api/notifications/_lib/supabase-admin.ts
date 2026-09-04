import { buildHeaders, supabaseRequest } from "../../_lib/supabase";
import type { ProfileConfig } from "../../profile/_lib/config";

/**
 * Notification queries that are not the worker's.
 *
 * The worker has its own repository in `apps/notification-worker`, shaped
 * around a run loop. These serve the two routes that answer questions about the
 * pipeline rather than driving it: the operator status report and a user's own
 * channel self-test.
 */

export interface NotificationsStatusReport {
  channelsTotal: number;
  channelsActive: number;
  channelsFailing: number;
  usersWithPreferences: number;
  cursorsTracked: number;
  cursorsUninitialised: number;
  workerLastRunAt: string | null;
  workerLagSeconds: number;
  workerStale: boolean;
  eventsPending: number;
  eventsFailed: number;
  eventsSent: number;
  eventsSent24h: number;
  oldestPendingSeconds: number;
  lastErrorCode: string | null;
}

/**
 * Pipeline health in one call.
 *
 * `workerLagSeconds` is the number that matters: the worker touches runtime
 * state on every pass, so a lag well above the cron interval means it has
 * stopped — regardless of what the event counts say. Zero events is the normal
 * state of a healthy pipeline with nothing to report, which is exactly the
 * ambiguity this exists to remove.
 */
export async function getNotificationsStatus(
  config: ProfileConfig,
  staleAfterSeconds = 300,
): Promise<NotificationsStatusReport> {
  const rows = await supabaseRequest<Array<Record<string, string | number | boolean | null>>>(
    config,
    "rpc/notifications_status_report",
    {
      body: JSON.stringify({ p_stale_after_seconds: staleAfterSeconds }),
      headers: buildHeaders(config),
      method: "POST",
    },
  );

  const row = rows[0] ?? {};
  const num = (key: string) => Number(row[key] ?? 0);

  return {
    channelsActive: num("channels_active"),
    channelsFailing: num("channels_failing"),
    channelsTotal: num("channels_total"),
    cursorsTracked: num("cursors_tracked"),
    cursorsUninitialised: num("cursors_uninitialised"),
    eventsFailed: num("events_failed"),
    eventsPending: num("events_pending"),
    eventsSent: num("events_sent"),
    eventsSent24h: num("events_sent_24h"),
    lastErrorCode: (row.last_error_code as string | null) ?? null,
    oldestPendingSeconds: num("oldest_pending_seconds"),
    usersWithPreferences: num("users_with_preferences"),
    workerLagSeconds: num("worker_lag_seconds"),
    workerLastRunAt: (row.worker_last_run_at as string | null) ?? null,
    workerStale: Boolean(row.worker_stale),
  };
}

export interface PriceAlertRecord {
  id: string;
  coin: string;
  targetPx: number;
  direction: "above" | "below";
  createdAt: string;
}

interface PriceAlertRow {
  id: string;
  coin: string;
  target_px: string | number;
  direction: "above" | "below";
  created_at: string;
}

function mapPriceAlertRow(row: PriceAlertRow): PriceAlertRecord {
  return {
    id: row.id,
    coin: row.coin,
    targetPx: Number(row.target_px),
    direction: row.direction,
    createdAt: row.created_at,
  };
}

/** The caller's own armed alerts, newest first. Triggered rows are history. */
export async function listPriceAlerts(
  config: ProfileConfig,
  userId: string,
): Promise<PriceAlertRecord[]> {
  const rows = await supabaseRequest<PriceAlertRow[]>(
    config,
    `price_alerts?user_id=eq.${encodeURIComponent(userId)}&triggered_at=is.null&select=id,coin,target_px,direction,created_at&order=created_at.desc`,
    { headers: buildHeaders(config) },
  );
  return rows.map(mapPriceAlertRow);
}

export async function insertPriceAlert(
  config: ProfileConfig,
  userId: string,
  input: { coin: string; targetPx: number; direction: "above" | "below" },
): Promise<PriceAlertRecord> {
  const rows = await supabaseRequest<PriceAlertRow[]>(config, "price_alerts", {
    body: JSON.stringify({
      coin: input.coin,
      direction: input.direction,
      target_px: input.targetPx,
      user_id: userId,
    }),
    headers: buildHeaders(config, { Prefer: "return=representation" }),
    method: "POST",
  });
  return mapPriceAlertRow(rows[0]);
}

/**
 * Deletes only the caller's own row — the user_id filter is the IDOR guard.
 * Returns whether anything was deleted, so the route can 404 honestly.
 */
export async function deletePriceAlert(
  config: ProfileConfig,
  userId: string,
  alertId: string,
): Promise<boolean> {
  const rows = await supabaseRequest<PriceAlertRow[]>(
    config,
    `price_alerts?id=eq.${encodeURIComponent(alertId)}&user_id=eq.${encodeURIComponent(userId)}`,
    {
      headers: buildHeaders(config, { Prefer: "return=representation" }),
      method: "DELETE",
    },
  );
  return rows.length > 0;
}

export interface TelegramChannelRow {
  status: string;
  target: string;
}

/** The caller's own Telegram channel, or null if they have never linked one. */
export async function getTelegramChannel(
  config: ProfileConfig,
  userId: string,
): Promise<TelegramChannelRow | null> {
  const rows = await supabaseRequest<TelegramChannelRow[]>(
    config,
    `notification_channels?user_id=eq.${userId}&channel=eq.telegram&select=status,target&limit=1`,
    { headers: buildHeaders(config) },
  );

  return rows[0] ?? null;
}

/**
 * Record what a self-test found, so a failing channel is visible to the
 * operator report rather than only to the person who ran the test.
 */
export async function recordChannelProbe(
  config: ProfileConfig,
  userId: string,
  outcome: { errorCode: string | null; ok: boolean },
): Promise<void> {
  await supabaseRequest<unknown>(
    config,
    `notification_channels?user_id=eq.${userId}&channel=eq.telegram`,
    {
      body: JSON.stringify({
        last_error_code: outcome.errorCode,
        status: outcome.ok ? "active" : "failing",
        updated_at: new Date().toISOString(),
        ...(outcome.ok ? { last_delivered_at: new Date().toISOString() } : {}),
      }),
      headers: buildHeaders(config, { Prefer: "return=minimal" }),
      method: "PATCH",
    },
  );
}
