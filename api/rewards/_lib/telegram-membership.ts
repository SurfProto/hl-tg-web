import { fetchWithTimeout } from "../../_lib/fetch-with-timeout";

/**
 * Whether a user is in the app's Telegram channel, according to Telegram.
 *
 * Server-verified rather than self-reported. A "join our channel" quest that
 * trusts a button press is worth nothing — the reward is XP, and XP may one day
 * back an allocation — so the only acceptable evidence is Telegram's own answer
 * about that user's membership. The bot must be an administrator of the channel
 * for `getChatMember` to answer at all, which is also a useful property: the
 * quest cannot be configured against a channel we do not control.
 */

/**
 * Statuses that mean the user is in the channel.
 *
 * `restricted` is a member with limited rights, which is still a member, but
 * only when `is_member` is set — Telegram uses the same status for a user who
 * was restricted *and* left.
 */
const PRESENT_STATUSES = new Set(["administrator", "creator", "member", "restricted"]);

export type ChannelMembership =
  | { kind: "member" }
  | { kind: "not_member" }
  /**
   * Telegram could not answer. Deliberately distinct from `not_member`: a
   * misconfigured channel id, a bot that is not an administrator, or an expired
   * token would otherwise look exactly like "nobody has joined yet", and the
   * quest would sit at zero forever with nothing reporting a problem.
   */
  | { kind: "unavailable"; code: string };

export async function getChannelMembership(args: {
  botToken: string;
  channelId: string;
  telegramUserId: string;
}): Promise<ChannelMembership> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `https://api.telegram.org/bot${args.botToken}/getChatMember`,
      {
        body: JSON.stringify({ chat_id: args.channelId, user_id: args.telegramUserId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
  } catch {
    return { code: "network_error", kind: "unavailable" };
  }

  let payload: {
    description?: string;
    error_code?: number;
    ok?: boolean;
    result?: { is_member?: boolean; status?: string };
  };

  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return { code: `http_${response.status}`, kind: "unavailable" };
  }

  if (!payload.ok) {
    // "user not found" is Telegram's answer for someone who has never been in
    // the chat, which is a real not-a-member rather than a fault. Everything
    // else — chat not found, bot not an administrator, bad token — is a
    // configuration problem and must not be reported as a negative answer.
    const description = (payload.description ?? "").toLowerCase();
    if (description.includes("user not found")) {
      return { kind: "not_member" };
    }

    // The code, never the description: it reaches a run log, and Telegram's
    // text can carry the chat title and other detail that does not belong
    // there.
    return { code: `telegram_${payload.error_code ?? response.status}`, kind: "unavailable" };
  }

  const status = payload.result?.status ?? "";
  if (status === "restricted") {
    return payload.result?.is_member ? { kind: "member" } : { kind: "not_member" };
  }

  return PRESENT_STATUSES.has(status) ? { kind: "member" } : { kind: "not_member" };
}
