import { requirePrivySession } from "../onramp/_lib/auth";
import { HttpError, json, withJsonRoute } from "../onramp/_lib/http";
import { getStringQuery } from "../onramp/_lib/request";
import { getProfileConfig } from "../profile/_lib/config";
import { getProfileByPrivyUserId } from "../profile/_lib/supabase-admin";
import {
  deletePriceAlert,
  insertPriceAlert,
  listPriceAlerts,
} from "./_lib/supabase-admin";

/**
 * A user's own price alerts: GET lists the armed ones, POST arms a new one,
 * DELETE (?id=) disarms one. Alerts are one-shot — the worker consumes a row
 * when its level is crossed — so this route only ever deals in armed rows.
 *
 * The cap bounds the worker: it scans every armed alert every minute, so an
 * account cannot be allowed to arm an unbounded number of them.
 */
const MAX_ACTIVE_ALERTS = 20;

/** Market symbols as the SDK names them, dex-prefixed HIP-3 ones included. */
const COIN_PATTERN = /^[A-Za-z0-9:/-]{1,32}$/u;

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    const config = getProfileConfig();
    const session = await requirePrivySession(request, config.privyAppId);
    const profile = await getProfileByPrivyUserId(config, session.privyUserId);
    if (!profile) {
      throw new HttpError(404, "PROFILE_NOT_FOUND", "No profile for this session");
    }

    if (request.method === "GET") {
      const alerts = await listPriceAlerts(config, profile.id);
      json(response, 200, { success: true, data: { alerts } });
      return;
    }

    if (request.method === "POST") {
      const body = (request.body ?? {}) as {
        coin?: unknown;
        targetPx?: unknown;
        direction?: unknown;
      };

      const coin = typeof body.coin === "string" ? body.coin.trim() : "";
      const targetPx = Number(body.targetPx);
      const direction = body.direction;

      if (
        !COIN_PATTERN.test(coin) ||
        !Number.isFinite(targetPx) ||
        targetPx <= 0 ||
        targetPx >= 1e12 ||
        (direction !== "above" && direction !== "below")
      ) {
        throw new HttpError(400, "INVALID_PRICE_ALERT", "Invalid price alert");
      }

      const existing = await listPriceAlerts(config, profile.id);
      if (existing.length >= MAX_ACTIVE_ALERTS) {
        throw new HttpError(
          400,
          "PRICE_ALERT_LIMIT",
          `At most ${MAX_ACTIVE_ALERTS} active alerts`,
        );
      }

      const alert = await insertPriceAlert(config, profile.id, {
        coin,
        direction,
        targetPx,
      });
      json(response, 200, { success: true, data: { alert } });
      return;
    }

    if (request.method === "DELETE") {
      const alertId = getStringQuery(request, "id");
      if (!alertId) {
        throw new HttpError(400, "INVALID_PRICE_ALERT", "Missing alert id");
      }

      const deleted = await deletePriceAlert(config, profile.id, alertId);
      if (!deleted) {
        throw new HttpError(404, "ALERT_NOT_FOUND", "No such alert");
      }
      json(response, 200, { success: true, data: { deleted: true } });
      return;
    }

    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Expected GET, POST or DELETE");
  });
}
