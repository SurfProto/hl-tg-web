import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./client-errors";
import { __resetRedisMemoryForTests } from "./market/_lib/redis";

function createResponse() {
  const res: any = {
    statusCode: null as number | null,
    body: null as unknown,
    ended: false,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
  };
  return res;
}

function createRequest(overrides: Record<string, any> = {}) {
  return {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.5", "user-agent": "TelegramBot" },
    body: { message: "a is not a function" },
    ...overrides,
  };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetRedisMemoryForTests();
});

describe("POST /api/client-errors", () => {
  it("accepts a report and writes it where runtime logs collect it", async () => {
    const response = createResponse();
    await handler(
      createRequest({
        body: {
          kind: "error-boundary",
          message: "a is not a function",
          stack: "at r (index-abc.js:1:2)",
          componentStack: "in TradePage",
          url: "https://example.com/trade",
        },
      }),
      response,
    );

    expect(response.statusCode).toBe(204);
    expect(response.ended).toBe(true);
    const [prefix, payload] = consoleError.mock.calls[0] as [string, any];
    expect(prefix).toBe("[client-error]");
    expect(payload).toMatchObject({
      kind: "error-boundary",
      message: "a is not a function",
      stack: "at r (index-abc.js:1:2)",
      componentStack: "in TradePage",
      url: "https://example.com/trade",
    });
  });

  it("parses a body that arrived as a string", async () => {
    const response = createResponse();
    await handler(
      createRequest({ body: JSON.stringify({ message: "boom" }) }),
      response,
    );

    expect(response.statusCode).toBe(204);
    expect((consoleError.mock.calls[0][1] as any).message).toBe("boom");
  });

  it("falls back to the request's own user agent", async () => {
    const response = createResponse();
    await handler(createRequest(), response);

    expect((consoleError.mock.calls[0][1] as any).userAgent).toBe("TelegramBot");
  });

  it("rejects anything but POST", async () => {
    const response = createResponse();
    await handler(createRequest({ method: "GET" }), response);

    expect(response.statusCode).toBe(405);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("requires a message, since a report without one says nothing", async () => {
    const response = createResponse();
    await handler(createRequest({ body: { stack: "only a stack" } }), response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ code: "MESSAGE_REQUIRED" });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON", async () => {
    const response = createResponse();
    await handler(createRequest({ body: "{oops" }), response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ code: "INVALID_JSON" });
  });

  it("refuses an oversized payload rather than logging it", async () => {
    const response = createResponse();
    await handler(
      createRequest({ body: JSON.stringify({ message: "x".repeat(20_000) }) }),
      response,
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("truncates a stack instead of dropping the report", async () => {
    const response = createResponse();
    await handler(
      createRequest({
        body: { message: "boom", stack: "y".repeat(9_000) },
      }),
      response,
    );

    expect(response.statusCode).toBe(204);
    const payload = consoleError.mock.calls[0][1] as any;
    expect(payload.stack).toHaveLength(4_000 + "…[truncated]".length);
    expect(payload.stack.endsWith("…[truncated]")).toBe(true);
  });

  it("stops a crash loop from flooding the logs", async () => {
    // A render loop can fire continuously; the point is to learn it happened.
    for (let i = 0; i < 30; i += 1) {
      await handler(createRequest(), createResponse());
    }
    expect(consoleError).toHaveBeenCalledTimes(30);

    const response = createResponse();
    await handler(createRequest(), response);

    expect(response.statusCode).toBe(429);
    expect(consoleError).toHaveBeenCalledTimes(30);
  });

  it("counts each client separately", async () => {
    for (let i = 0; i < 30; i += 1) {
      await handler(createRequest(), createResponse());
    }

    const response = createResponse();
    await handler(
      createRequest({ headers: { "x-forwarded-for": "198.51.100.9" } }),
      response,
    );

    expect(response.statusCode).toBe(204);
  });

  it("takes the first hop of a forwarded-for chain", async () => {
    for (let i = 0; i < 31; i += 1) {
      await handler(
        createRequest({
          headers: { "x-forwarded-for": "203.0.113.5, 70.41.3.18" },
        }),
        createResponse(),
      );
    }

    const response = createResponse();
    await handler(createRequest(), response);
    expect(response.statusCode).toBe(429);
  });
});
