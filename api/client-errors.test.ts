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

  it("strips query strings and hashes from an untrusted report URL", async () => {
    const response = createResponse();
    await handler(
      createRequest({
        body: {
          message: "boom",
          url: "https://app.example/trade?wallet=0xsecret#tgWebAppData=private",
        },
      }),
      response,
    );

    expect(response.statusCode).toBe(204);
    expect((consoleError.mock.calls[0][1] as any).url).toBe(
      "https://app.example/trade",
    );
  });

  it("redacts secrets and wallets embedded in a report URL path", async () => {
    const privateKey = `0x${"ef".repeat(32)}`;
    const wallet = "0x1234567890abcdef1234567890abcdef12345678";
    const response = createResponse();
    await handler(
      createRequest({
        body: {
          message: "boom",
          url: `https://app.example/debug/${privateKey}/wallet/${wallet}?ignored=1`,
        },
      }),
      response,
    );

    const url = (consoleError.mock.calls[0][1] as any).url as string;
    expect(url).toContain("[redacted-secret]");
    expect(url).toContain("[redacted-address]");
    expect(url).not.toContain(privateKey);
    expect(url).not.toContain(wallet);
    expect(url).not.toContain("ignored");
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

    expect((consoleError.mock.calls[0][1] as any).userAgent).toBe(
      "TelegramBot",
    );
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

  it("redacts private keys and wallet addresses from every logged text field", async () => {
    const privateKey = `0x${"ab".repeat(32)}`;
    const wallet = "0x1234567890abcdef1234567890abcdef12345678";
    const response = createResponse();
    await handler(
      createRequest({
        headers: {
          "x-forwarded-for": "203.0.113.5",
          "user-agent": `wallet/${privateKey}`,
        },
        body: {
          kind: `error-${privateKey}`,
          message: `failed ${privateKey} for ${wallet}`,
          stack: `at signer (${privateKey})`,
          componentStack: `in Wallet ${wallet}`,
        },
      }),
      response,
    );

    expect(response.statusCode).toBe(204);
    const logged = JSON.stringify(consoleError.mock.calls[0]?.[1]);
    expect(logged).not.toContain(privateKey);
    expect(logged).not.toContain(wallet);
    expect(logged).toContain("[redacted-secret]");
    expect(logged).toContain("[redacted-address]");
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

describe("POST /api/client-errors, exchange-action reports", () => {
  it("keeps the fields a rejection report is allowed to carry", async () => {
    const response = createResponse();
    await handler(
      createRequest({
        body: {
          kind: "exchange-action",
          message: "User or API Wallet 0x1234…5678 does not exist.",
          detail: {
            code: "AGENT_AUTHORIZATION_REJECTED",
            action: "closePosition",
            network: "mainnet",
            buildId: "a1b2c3d",
            agentAddress: "0x1234…5678",
          },
        },
      }),
      response,
    );

    expect(response.statusCode).toBe(204);
    expect(consoleError).toHaveBeenCalledWith(
      "[client-error]",
      expect.objectContaining({
        kind: "exchange-action",
        detail: {
          code: "AGENT_AUTHORIZATION_REJECTED",
          action: "closePosition",
          network: "mainnet",
          buildId: "a1b2c3d",
          agentAddress: "0x1234…5678",
        },
      }),
    );
  });

  it("drops anything the client added that is not on the list", async () => {
    // The endpoint is unauthenticated and the client can send whatever it
    // likes. A pass-through would put an order size or a key into the logs.
    const response = createResponse();
    await handler(
      createRequest({
        body: {
          kind: "exchange-action",
          message: "rejected",
          detail: {
            code: "AGENT_AUTHORIZATION_REJECTED",
            action: "placeOrder",
            network: "testnet",
            buildId: "dev",
            agentAddress: null,
            privateKey: "0xdeadbeef",
            masterWallet: "0x5bF344d20040e6c7589b46ae0e9F98210C40bF41",
            sizeUsd: 1234,
            balance: 99999,
          },
        },
      }),
      response,
    );

    const [, logged] = consoleError.mock.calls[0] as [string, any];
    expect(Object.keys(logged.detail).sort()).toEqual([
      "action",
      "agentAddress",
      "buildId",
      "code",
      "network",
    ]);
    expect(JSON.stringify(logged)).not.toContain("0xdeadbeef");
    expect(JSON.stringify(logged)).not.toContain("5bF344");
    expect(JSON.stringify(logged)).not.toContain("1234");
  });

  it("refuses an agent address that arrived unmasked", async () => {
    // The client masks it. A full address here means something upstream
    // stopped masking, and logging it anyway would defeat the point.
    const response = createResponse();
    await handler(
      createRequest({
        body: {
          kind: "exchange-action",
          message: "rejected",
          detail: {
            code: "AGENT_AUTHORIZATION_REJECTED",
            action: "cancelOrder",
            network: "mainnet",
            buildId: "dev",
            agentAddress: "0x1234567890abcdef1234567890abcdef12345678",
          },
        },
      }),
      response,
    );

    const [, logged] = consoleError.mock.calls[0] as [string, any];
    expect(logged.detail.agentAddress).toBeNull();
  });

  it("does not accept a network it does not recognise", async () => {
    const response = createResponse();
    await handler(
      createRequest({
        body: {
          kind: "exchange-action",
          message: "rejected",
          detail: { action: "closePosition", network: "sepolia" },
        },
      }),
      response,
    );

    const [, logged] = consoleError.mock.calls[0] as [string, any];
    expect(logged.detail.network).toBeNull();
  });

  it("rejects arbitrary diagnostic vocabulary and malformed masked agents", async () => {
    const privateKey = `0x${"cd".repeat(32)}`;
    const response = createResponse();
    await handler(
      createRequest({
        body: {
          kind: "exchange-action",
          message: "rejected",
          detail: {
            code: privateKey,
            action: "withdrawEverything",
            network: "mainnet",
            buildId: privateKey,
            agentAddress: `0x1234…${privateKey}`,
          },
        },
      }),
      response,
    );

    const [, logged] = consoleError.mock.calls[0] as [string, any];
    expect(logged.detail).toEqual({
      code: null,
      action: null,
      network: "mainnet",
      buildId: null,
      agentAddress: null,
    });
    expect(JSON.stringify(logged)).not.toContain(privateKey);
  });

  it("leaves an ordinary crash report without a detail", async () => {
    const response = createResponse();
    await handler(createRequest(), response);

    const [, logged] = consoleError.mock.calls[0] as [string, any];
    expect(logged.detail).toBeNull();
  });
});
