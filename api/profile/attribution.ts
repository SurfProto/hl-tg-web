import { requirePrivySession } from "../onramp/_lib/auth";
import { HttpError, json, withJsonRoute } from "../onramp/_lib/http";
import { getProfileConfig } from "./_lib/config";
import { getProfileByPrivyUserId, recordFirstTouch } from "./_lib/supabase-admin";

/**
 * Record the caller's first touch — the channel they arrived through — once.
 *
 * The client sends what it captured on the first open; the server writes it
 * only if the account has no attribution yet, so the first authenticated
 * session wins and nothing later overwrites it. Called every session and safe
 * to: insert-if-absent makes repeat calls no-ops.
 *
 * Not an affiliate portal. It stores one row and returns nothing but success.
 */

const SOURCES = new Set(["campaign", "referral", "direct"]);

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    if (request.method !== "POST") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Expected POST");
    }

    const config = getProfileConfig();
    const session = await requirePrivySession(request, config.privyAppId);
    const profile = await getProfileByPrivyUserId(config, session.privyUserId);
    if (!profile) {
      throw new HttpError(404, "PROFILE_NOT_FOUND", "No profile for this session");
    }

    const body = (request.body ?? {}) as {
      source?: unknown;
      campaignCode?: unknown;
      rawStartParam?: unknown;
    };

    const source = typeof body.source === "string" ? body.source : "";
    if (!SOURCES.has(source)) {
      throw new HttpError(400, "INVALID_ATTRIBUTION", "Unknown attribution source");
    }

    // Re-validate the code server-side rather than trust the client: only a
    // campaign carries one, and only within the allowed set. Anything else is
    // stored as a null code with its raw start_param kept for audit.
    const rawCode =
      typeof body.campaignCode === "string" ? body.campaignCode.trim().toLowerCase() : "";
    const campaignCode =
      source === "campaign" && /^[a-z0-9_-]{1,64}$/u.test(rawCode) ? rawCode : null;

    const rawStartParam =
      typeof body.rawStartParam === "string" ? body.rawStartParam.slice(0, 128) : null;

    await recordFirstTouch(config, profile.id, {
      source: source as "campaign" | "referral" | "direct",
      campaignCode,
      rawStartParam,
    });

    json(response, 200, { success: true, data: { recorded: true } });
  });
}
