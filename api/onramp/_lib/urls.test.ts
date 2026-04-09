import { describe, expect, it } from "vitest";
import { buildReturnUrl } from "./urls";

describe("buildReturnUrl", () => {
  it("appends the external order id to the return url", () => {
    const url = buildReturnUrl(
      "https://app.example/account/deposit",
      "ext_123",
    );

    expect(url).toBe(
      "https://app.example/account/deposit?onramp_external_order_id=ext_123",
    );
  });

  it("preserves existing query params", () => {
    const url = buildReturnUrl(
      "https://app.example/account/deposit?from=fiat",
      "ext_123",
    );

    expect(url).toBe(
      "https://app.example/account/deposit?from=fiat&onramp_external_order_id=ext_123",
    );
  });
});
