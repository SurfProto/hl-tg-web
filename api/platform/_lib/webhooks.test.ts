import { describe, expect, it } from "vitest";

import { signWebhookPayload, verifyWebhookSignature } from "./webhooks";

describe("webhook signatures", () => {
  it("verifies HMAC signatures using the timestamped payload envelope", () => {
    const signature = signWebhookPayload({
      body: "{\"event\":\"transaction.updated\"}",
      secret: "whsec_test",
      timestamp: 1779100000,
    });

    expect(
      verifyWebhookSignature({
        body: "{\"event\":\"transaction.updated\"}",
        secret: "whsec_test",
        signature,
        timestamp: 1779100000,
        now: 1779100010,
      }),
    ).toBe(true);
  });

  it("rejects stale or mismatched webhook signatures", () => {
    const signature = signWebhookPayload({
      body: "{\"event\":\"transaction.updated\"}",
      secret: "whsec_test",
      timestamp: 1779100000,
    });

    expect(
      verifyWebhookSignature({
        body: "{\"event\":\"transaction.tampered\"}",
        secret: "whsec_test",
        signature,
        timestamp: 1779100000,
        now: 1779100010,
      }),
    ).toBe(false);

    expect(
      verifyWebhookSignature({
        body: "{\"event\":\"transaction.updated\"}",
        secret: "whsec_test",
        signature,
        timestamp: 1779100000,
        now: 1779101000,
      }),
    ).toBe(false);
  });
});
