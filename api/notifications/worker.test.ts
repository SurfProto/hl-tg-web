import { describe, expect, it, vi, beforeEach } from "vitest";

const runNotificationWorkerOnce = vi.fn();

vi.mock("../../apps/notification-worker/src/run-once", () => ({
  runNotificationWorkerOnce,
}));

interface MockResponse {
  statusCode: number | null;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
}

function makeResponse(): MockResponse {
  return {
    statusCode: null,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe("GET /api/notifications/worker", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
  });

  it("rejects requests without valid cron auth", async () => {
    const { default: handler } = await import("./worker");
    const response = makeResponse();

    await handler(
      {
        method: "GET",
        headers: {},
      },
      response,
    );

    expect(response.statusCode).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      code: "UNAUTHORIZED",
    });
    expect(runNotificationWorkerOnce).not.toHaveBeenCalled();
  });

  it("runs the worker exactly once for an authenticated cron request", async () => {
    runNotificationWorkerOnce.mockResolvedValue(undefined);
    const { default: handler } = await import("./worker");
    const response = makeResponse();

    await handler(
      {
        method: "GET",
        headers: {
          authorization: "Bearer cron-secret",
        },
      },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
    });
    expect(runNotificationWorkerOnce).toHaveBeenCalledTimes(1);
  });
});
