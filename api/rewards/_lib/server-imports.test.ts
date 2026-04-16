import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSource(fileName: string) {
  return readFileSync(resolve(import.meta.dirname, fileName), "utf8");
}

describe("server runtime import boundaries", () => {
  it("does not statically import the Hyperliquid client in rewards server modules", () => {
    const programSource = readSource("program.ts");
    const payoutSource = readSource("payout.ts");

    expect(programSource).not.toContain(
      'import { HyperliquidClient } from "../../../packages/hyperliquid-sdk/src/client";',
    );
    expect(programSource).not.toContain(
      'import { hasRewardsTreasury, sendRewardUsdc } from "./payout";',
    );
    expect(payoutSource).not.toContain(
      'import { HyperliquidClient } from "../../../packages/hyperliquid-sdk/src/client";',
    );
  });

  it("uses an emitted file extension for the lazy payout import", () => {
    const programSource = readSource("program.ts");

    expect(programSource).toContain('return import("./payout.js");');
    expect(programSource).not.toContain('return import("./payout");');
  });
});
