import { afterEach, describe, expect, it } from "vitest";

import type { HyperliquidClient } from "./client";
import { configureBuilder, isBuilderFeeApproved } from "./builder";

function clientApprovedAt(maxFeeTenthsBp: number): HyperliquidClient {
  return {
    getMaxBuilderFee: async () => maxFeeTenthsBp,
  } as unknown as HyperliquidClient;
}

describe("isBuilderFeeApproved", () => {
  afterEach(() => {
    // configureBuilder mutates module state; restore the defaults.
    configureBuilder("0x99E3327611c4d5aBfeaA9c64C151817a9554Fb5D", 50);
  });

  /**
   * Approved means approved at the configured rate. Every order carries the
   * full configured fee, so an approval below it passed the old `> 0` check
   * here, and then every single order was rejected upstream with a raw
   * exchange error — a hard-fail loop instead of a re-approval prompt.
   */
  it("requires the approval to cover the configured fee", async () => {
    configureBuilder(undefined, 50);

    await expect(isBuilderFeeApproved(clientApprovedAt(10))).resolves.toBe(false);
    await expect(isBuilderFeeApproved(clientApprovedAt(50))).resolves.toBe(true);
    await expect(isBuilderFeeApproved(clientApprovedAt(80))).resolves.toBe(true);
  });

  it("still treats no approval as not approved", async () => {
    await expect(isBuilderFeeApproved(clientApprovedAt(0))).resolves.toBe(false);
  });
});
