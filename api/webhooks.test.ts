import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMerchantByApiKey: vi.fn(),
  persistWebhookEvent: vi.fn(),
}));

vi.mock("./platform/_lib/supabase-admin", () => ({
  getMerchantByApiKey: mocks.getMerchantByApiKey,
  persistWebhookEvent: mocks.persistWebhookEvent,
}));

import { signWebhookPayload } from "./platform/_lib/webhooks";
import handler from "./webhooks";

const SECRET = "webhook-secret";

function post(body: string, headers: Record<string, string> = {}) {
  return new Request("https://example.com/api/webhooks", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

function signedHeaders(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  return {
    "x-platform-timestamp": String(timestamp),
    "x-platform-signature": signWebhookPayload({ body, secret: SECRET, timestamp }),
  };
}

describe("POST /api/webhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("PLATFORM_WEBHOOK_SECRET", SECRET);
    mocks.getMerchantByApiKey.mockResolvedValue(null);
    mocks.persistWebhookEvent.mockImplementation(
      async (_config: unknown, input: Record<string, unknown>) => ({
        id: "evt-1",
        ...input,
      }),
    );
  });

  /**
   * The bug this route was rewritten for: Vercel parses application/json into
   * request.body and consumes the stream, so the previous Node-signature
   * handler verified the HMAC against JSON.stringify(parsedBody). That only
   * matches when the sender's byte order happens to agree. Here the signed
   * bytes deliberately use a key order and spacing that re-serialising would
   * not reproduce.
   */
  it("verifies the signature against the exact transmitted bytes", async () => {
    const raw = '{"eventType":"payment.settled","eventId":"evt-1",  "payload":{"b":2,"a":1}}';
    expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw);

    const response = await handler.fetch(post(raw, signedHeaders(raw)));

    expect(response.status).toBe(200);
    expect(mocks.persistWebhookEvent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ eventId: "evt-1", eventType: "payment.settled" }),
    );
  });

  it("rejects a body that was altered after signing", async () => {
    const signed = '{"eventId":"evt-1","eventType":"payment.settled"}';
    const tampered = '{"eventId":"evt-1","eventType":"payment.refunded"}';

    const response = await handler.fetch(post(tampered, signedHeaders(signed)));

    expect(response.status).toBe(401);
    expect(mocks.persistWebhookEvent).not.toHaveBeenCalled();
  });

  it("rejects a signature outside the timestamp window", async () => {
    const raw = '{"eventId":"evt-1","eventType":"payment.settled"}';
    const stale = Math.floor(Date.now() / 1000) - 3600;

    const response = await handler.fetch(post(raw, signedHeaders(raw, stale)));

    expect(response.status).toBe(401);
  });

  it("requires an eventId so replays inside the window can be deduplicated", async () => {
    const raw = '{"eventType":"payment.settled"}';

    const response = await handler.fetch(post(raw, signedHeaders(raw)));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("acknowledges a duplicate event rather than erroring", async () => {
    // persistWebhookEvent returns null when event_id already exists.
    mocks.persistWebhookEvent.mockResolvedValue(null);
    const raw = '{"eventId":"evt-1","eventType":"payment.settled"}';

    const response = await handler.fetch(post(raw, signedHeaders(raw)));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { duplicate: true } });
  });

  it("rejects an unknown merchant API key", async () => {
    const raw = '{"eventId":"evt-1","eventType":"payment.settled"}';

    const response = await handler.fetch(
      post(raw, { ...signedHeaders(raw), "x-merchant-api-key": "nope" }),
    );

    expect(response.status).toBe(401);
    expect(mocks.persistWebhookEvent).not.toHaveBeenCalled();
  });

  it("rejects a non-POST request", async () => {
    const response = await handler.fetch(
      new Request("https://example.com/api/webhooks", { method: "GET" }),
    );

    expect(response.status).toBe(405);
  });
});
