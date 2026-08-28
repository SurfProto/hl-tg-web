import { afterEach, describe, expect, it, vi } from "vitest";
import { getChannelMembership } from "./telegram-membership";

const ARGS = { botToken: "bot-token", channelId: "@p34k", telegramUserId: "42" };

function stub(payload: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), { status: ok ? 200 : 400 })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("channel membership", () => {
  it.each(["administrator", "creator", "member"])("counts %s as present", async (status) => {
    stub({ ok: true, result: { status } });

    await expect(getChannelMembership(ARGS)).resolves.toEqual({ kind: "member" });
  });

  it.each(["kicked", "left"])("counts %s as absent", async (status) => {
    stub({ ok: true, result: { status } });

    await expect(getChannelMembership(ARGS)).resolves.toEqual({ kind: "not_member" });
  });

  /**
   * Telegram uses one status for a restricted member and for someone who was
   * restricted and then left; only `is_member` separates them.
   */
  it("separates a restricted member from a restricted leaver", async () => {
    stub({ ok: true, result: { is_member: true, status: "restricted" } });
    await expect(getChannelMembership(ARGS)).resolves.toEqual({ kind: "member" });

    stub({ ok: true, result: { is_member: false, status: "restricted" } });
    await expect(getChannelMembership(ARGS)).resolves.toEqual({ kind: "not_member" });
  });

  it("reads 'user not found' as a real answer, not a fault", async () => {
    stub({ description: "Bad Request: user not found", error_code: 400, ok: false }, false);

    await expect(getChannelMembership(ARGS)).resolves.toEqual({ kind: "not_member" });
  });

  /**
   * The distinction that matters. A wrong channel id, or a bot that is not an
   * administrator, must not look like "nobody has joined yet" — that is exactly
   * how the fill notifications managed to be silent for four months.
   */
  it("reports a misconfigured channel as unavailable rather than absent", async () => {
    stub({ description: "Bad Request: chat not found", error_code: 400, ok: false }, false);

    await expect(getChannelMembership(ARGS)).resolves.toEqual({
      code: "telegram_400",
      kind: "unavailable",
    });
  });

  it("reports a network failure as unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );

    await expect(getChannelMembership(ARGS)).resolves.toEqual({
      code: "network_error",
      kind: "unavailable",
    });
  });

  // The description can carry the chat title and other detail, and this value
  // reaches a run log.
  it("never puts Telegram's prose in the result", async () => {
    stub(
      { description: "Forbidden: bot is not a member of the channel chat 'Private Alpha'", error_code: 403, ok: false },
      false,
    );

    const result = await getChannelMembership(ARGS);
    expect(JSON.stringify(result)).not.toContain("Private Alpha");
    expect(result).toEqual({ code: "telegram_403", kind: "unavailable" });
  });
});
