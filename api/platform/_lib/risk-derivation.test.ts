import { describe, expect, it } from "vitest";

import {
  deriveRiskFlags,
  SCREENING_MAX_AGE_DAYS,
  VELOCITY_AMOUNT_THRESHOLD,
} from "./risk-derivation";
import type { UserRiskProfile } from "./types";

function profile(overrides: Partial<UserRiskProfile> = {}): UserRiskProfile {
  return {
    adverseMedia: false,
    blockchainExposure: false,
    chargebackHistory: false,
    pepMatch: false,
    sanctionsMatch: false,
    screenedAt: new Date().toISOString(),
    userId: "user-1",
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof deriveRiskFlags>[0]> = {}) {
  return {
    amount: 100,
    country: "KZ",
    direction: "onramp" as const,
    highRiskCountries: [],
    profile: profile(),
    velocity: { grossAmount24h: 0, transactionCount24h: 0 },
    ...overrides,
  };
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("deriveRiskFlags", () => {
  it("returns nothing for a freshly screened, low-volume customer", () => {
    expect(deriveRiskFlags(input())).toEqual([]);
  });

  it("marks a customer with no screening record as unscreened", () => {
    expect(deriveRiskFlags(input({ profile: null }))).toContain("unscreened");
  });

  it("marks a stale screening record as unscreened", () => {
    expect(
      deriveRiskFlags(
        input({ profile: profile({ screenedAt: daysAgo(SCREENING_MAX_AGE_DAYS + 1) }) }),
      ),
    ).toContain("unscreened");
  });

  it("carries screening hits through from the stored record", () => {
    const flags = deriveRiskFlags(
      input({ profile: profile({ sanctionsMatch: true, chargebackHistory: true }) }),
    );
    expect(flags).toEqual(expect.arrayContaining(["sanctions_match", "chargeback_history"]));
  });

  it("matches high-risk countries case-insensitively", () => {
    expect(
      deriveRiskFlags(input({ country: "kz", highRiskCountries: ["KZ"] })),
    ).toContain("high_risk_country");
  });

  it("counts the pending transaction towards velocity", () => {
    // Just under the threshold before this transaction, over it after.
    const flags = deriveRiskFlags(
      input({
        amount: 10,
        velocity: { grossAmount24h: VELOCITY_AMOUNT_THRESHOLD - 5, transactionCount24h: 1 },
      }),
    );
    expect(flags).toContain("velocity_spike");
  });

  it("does not flag velocity below the threshold", () => {
    expect(
      deriveRiskFlags(
        input({ velocity: { grossAmount24h: 100, transactionCount24h: 2 } }),
      ),
    ).not.toContain("velocity_spike");
  });
});
