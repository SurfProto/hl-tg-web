import { describe, expect, it } from "vitest";
import { normalizeOrderState } from "./normalize";

describe("normalizeOrderState", () => {
  it("maps provider preorder into invoice pending", () => {
    expect(normalizeOrderState("PREORDER")).toBe("invoice_pending");
  });

  it("maps provider payment states into customer-facing pending states", () => {
    expect(normalizeOrderState("PENDING")).toBe("payment_pending");
    expect(normalizeOrderState("PAYIN_PENDING")).toBe("payment_pending");
  });

  it("maps processing and terminal states", () => {
    expect(normalizeOrderState("PROCESSING")).toBe("processing");
    expect(normalizeOrderState("SUCCESS")).toBe("success");
    expect(normalizeOrderState("ERROR")).toBe("failed");
  });

  it("falls back to failed for unknown states", () => {
    expect(normalizeOrderState("WHATEVER")).toBe("failed");
  });
});
