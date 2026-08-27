import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProfileByPrivyUserId: vi.fn(),
  getProfileConfig: vi.fn(),
  getTelegramChannel: vi.fn(),
  recordChannelProbe: vi.fn(),
  requirePrivySession: vi.fn(),
}));

vi.mock("../onramp/_lib/auth", () => ({ requirePrivySession: mocks.requirePrivySession }));
vi.mock("../profile/_lib/config", () => ({ getProfileConfig: mocks.getProfileConfig }));
vi.mock("../profile/_lib/supabase-admin", () => ({
  getProfileByPrivyUserId: mocks.getProfileByPrivyUserId,
}));
vi.mock("./_lib/supabase-admin", () => ({
  getTelegramChannel: mocks.getTelegramChannel,
  recordChannelProbe: mocks.recordChannelProbe,
}));

function makeResponse() {
  const res: any = {
    body: null,
    statusCode: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const REQUEST = { headers: { authorization: "Bearer token" }, method: "POST" };

function telegramReplies(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    json: async () => body,
    ok,
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.TELEGRAM_BOT_TOKEN = "bot-token";
  mocks.getProfileConfig.mockReturnValue({ privyAppId: "app" });
  mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:user:1" });
  mocks.getProfileByPrivyUserId.mockResolvedValue({ id: "user-1" });
  mocks.getTelegramChannel.mockResolvedValue({ status: "active", target: "555" });
  mocks.recordChannelProbe.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/notifications/test", () => {
  it("sends to the caller's own channel and reports delivery", async () => {
    const fetchSpy = telegramReplies({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    const { default: handler } = await import("./test");
    const response = makeResponse();

    await handler(REQUEST, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual({ delivered: true });

    // Telegram's URL is literally `bot` concatenated with the token.
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/botbot-token/sendMessage");
    expect(JSON.parse(init.body).chat_id).toBe("555");
  });

  /**
   * The target comes from the session's own user record. A request naming
   * another chat must not be able to make the bot message a stranger.
   */
  it("never takes the target from the request", async () => {
    const fetchSpy = telegramReplies({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    const { default: handler } = await import("./test");

    await handler({ ...REQUEST, body: { target: "999", chat_id: "999" } }, makeResponse());

    expect(JSON.parse(fetchSpy.mock.calls[0]![1].body).chat_id).toBe("555");
  });

  it("explains what to do when no channel is linked", async () => {
    mocks.getTelegramChannel.mockResolvedValue(null);
    vi.stubGlobal("fetch", telegramReplies({ ok: true }));
    const { default: handler } = await import("./test");
    const response = makeResponse();

    await handler(REQUEST, response);

    expect(response.statusCode).toBe(409);
    expect(response.body.code).toBe("NO_TELEGRAM_CHANNEL");
  });

  /**
   * A blocked bot is the commonest cause of silence and is invisible from the
   * database. The reply has to say what to do about it.
   */
  it("turns a blocked bot into an instruction", async () => {
    vi.stubGlobal(
      "fetch",
      telegramReplies({ description: "Forbidden: bot was blocked by the user", error_code: 403, ok: false }, false),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { default: handler } = await import("./test");
    const response = makeResponse();

    await handler(REQUEST, response);

    expect(response.statusCode).toBe(502);
    expect(response.body.code).toBe("TELEGRAM_SEND_FAILED");
    expect(response.body.error).toContain("Unblock the bot");
    // Telegram's own wording is upstream text and does not get passed through.
    expect(response.body.error).not.toContain("Forbidden:");
  });

  // A channel a user finds broken should be visible to the operator report,
  // not known only to whoever ran the test.
  it("records the outcome against the channel either way", async () => {
    vi.stubGlobal("fetch", telegramReplies({ error_code: 403, ok: false }, false));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { default: handler } = await import("./test");

    await handler(REQUEST, makeResponse());

    expect(mocks.recordChannelProbe).toHaveBeenCalledWith(expect.anything(), "user-1", {
      errorCode: "403",
      ok: false,
    });
  });

  it("records success against the channel too", async () => {
    vi.stubGlobal("fetch", telegramReplies({ ok: true }));
    const { default: handler } = await import("./test");

    await handler(REQUEST, makeResponse());

    expect(mocks.recordChannelProbe).toHaveBeenCalledWith(expect.anything(), "user-1", {
      errorCode: null,
      ok: true,
    });
  });

  it("refuses anything but POST", async () => {
    vi.stubGlobal("fetch", telegramReplies({ ok: true }));
    const { default: handler } = await import("./test");
    const response = makeResponse();

    await handler({ ...REQUEST, method: "GET" }, response);

    expect(response.statusCode).toBe(405);
  });

  it("says notifications are unconfigured rather than sending nowhere", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.MARKET_TELEGRAM_BOT_TOKEN;
    const fetchSpy = telegramReplies({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    const { default: handler } = await import("./test");
    const response = makeResponse();

    await handler(REQUEST, response);

    expect(response.statusCode).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
