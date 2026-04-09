import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSignature, serializeSignatureParams } from "./signer";

describe("serializeSignatureParams", () => {
  it("sorts keys alphabetically and renders key:value pairs", () => {
    const serialized = serializeSignatureParams({
      service_id: "svc_123",
      amount: 100.5,
      base_currency: "USD",
    });

    expect(serialized).toBe(
      "amount:100.5;base_currency:USD;service_id:svc_123;",
    );
  });
});

describe("createSignature", () => {
  it("hashes params + timestamp + secret with sha256", () => {
    const params = "amount:100.5;base_currency:USD;service_id:svc_123;";
    const timestamp = "1705320000";
    const secret = "sk_test_secret";
    const expected = createHash("sha256")
      .update(`${params}${timestamp}${secret}`)
      .digest("hex");

    expect(createSignature(params, timestamp, secret)).toBe(expected);
  });
});
