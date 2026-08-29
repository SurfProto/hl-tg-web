import { fetchWithTimeout } from "../_lib/fetch-with-timeout";
import { enforceRateLimit } from "../market/_lib/rate-limit";
import { requirePrivySession } from "../onramp/_lib/auth";
import { ensureMethod, HttpError, json, withJsonRoute } from "../onramp/_lib/http";
import { getProfileConfig } from "../profile/_lib/config";
import { getProfileByPrivyUserId } from "../profile/_lib/supabase-admin";
import { getTelegramChannel, recordChannelProbe } from "./_lib/supabase-admin";

/**
 * Send one message to the caller's own Telegram channel, and say what happened.
 *
 * The question "do my notifications work?" was previously unanswerable without
 * waiting for something to trade. This answers it in a few seconds by
 * exercising the parts that actually break: the bot token, the stored chat
 * target, and Telegram's willingness to deliver — a user who has blocked the
 * bot is the single most common cause of silence, and it is invisible from the
 * database alone.
 *
 * It deliberately does not go through the event queue. The queue is the
 * worker's path and `/api/notifications/status` reports on it; this isolates
 * the channel so a failure points at one thing rather than two.
 *
 * Sends only to the caller's own linked channel — the target comes from the
 * session's own user record and is never taken from the request.
 */

const TEST_MESSAGE =
  "Test notification from P34K. Your alerts are working — you'll get fills, " +
  "deposits and liquidation warnings here.";

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getProfileConfig();
    const session = await requirePrivySession(request, config.privyAppId);

    const profile = await getProfileByPrivyUserId(config, session.privyUserId);
    if (!profile) {
      throw new HttpError(404, "PROFILE_NOT_FOUND", "No profile for this session");
    }

    // Telegram caps the bot's sends globally (~30/s across every user), so an
    // unmetered self-test was a lever for one account to get the bot 429'd and
    // silence everyone's real alerts. Three a minute answers "do my
    // notifications work?" just as well.
    await enforceRateLimit({
      scope: "notifications-test",
      id: profile.id,
      limit: 3,
      windowSeconds: 60,
    });

    const channel = await getTelegramChannel(config, profile.id);
    if (!channel) {
      throw new HttpError(
        409,
        "NO_TELEGRAM_CHANNEL",
        "Open the app from Telegram once so alerts have somewhere to go",
      );
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN ?? process.env.MARKET_TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new HttpError(500, "TELEGRAM_NOT_CONFIGURED", "Notifications are not configured");
    }

    // The worker's client is built around its own run loop and repository. This
    // is one request; importing that machinery to make it would cost more than
    // the call itself. Deadlined like every other outbound call — this was the
    // codebase's one bare fetch, and a stalled Telegram held the function open
    // to the platform limit.
    const telegramResponse = await fetchWithTimeout(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        body: JSON.stringify({
          chat_id: channel.target,
          disable_web_page_preview: true,
          text: TEST_MESSAGE,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    ).catch(() => {
      // A timeout leaves the outcome unknown, so the channel probe is not
      // recorded — only a definite refusal should mark a channel broken.
      throw new HttpError(
        502,
        "TELEGRAM_SEND_FAILED",
        "Telegram could not deliver the message. Try again shortly.",
      );
    });

    const payload = (await telegramResponse.json().catch(() => ({}))) as {
      description?: string;
      error_code?: number;
      ok?: boolean;
    };

    const ok = telegramResponse.ok && payload.ok === true;
    const errorCode = ok ? null : String(payload.error_code ?? telegramResponse.status);

    // Persist the outcome so a channel a user found broken is also visible to
    // the operator report, rather than known only to whoever ran the test.
    await recordChannelProbe(config, profile.id, { errorCode, ok });

    if (!ok) {
      console.warn(
        `[notifications] test send failed user=${profile.id} code=${errorCode}`,
      );

      // Telegram's own wording is the useful part here — "bot was blocked by
      // the user" tells someone exactly what to do — but it is upstream text,
      // so it is reported as a code and a fixed hint rather than passed through.
      throw new HttpError(
        502,
        "TELEGRAM_SEND_FAILED",
        errorCode === "403"
          ? "Telegram refused the message. Unblock the bot and try again."
          : "Telegram could not deliver the message. Try again shortly.",
      );
    }

    json(response, 200, {
      success: true,
      data: { delivered: true },
    });
  });
}
