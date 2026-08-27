import { describe, expect, it } from "vitest";
import { buildTier, resolveTier, tierBonusFor, TIERS } from "./tiers";

describe("rank thresholds", () => {
  it("starts everyone at Basecamp", () => {
    expect(resolveTier(0).rank).toBe("basecamp");
    expect(resolveTier(-100).rank).toBe("basecamp");
  });

  it("promotes exactly at the threshold, not one XP later", () => {
    expect(resolveTier(2_499).rank).toBe("basecamp");
    expect(resolveTier(2_500).rank).toBe("climber");
    expect(resolveTier(9_999).rank).toBe("climber");
    expect(resolveTier(10_000).rank).toBe("ridge");
  });

  it("holds at the top rank however far past it you go", () => {
    expect(resolveTier(150_000).rank).toBe("peak");
    expect(resolveTier(50_000_000).rank).toBe("peak");
  });

  // Ordering is load-bearing: resolveTier walks the list assuming it ascends.
  it("declares thresholds and multipliers in ascending order", () => {
    const thresholds = TIERS.map((tier) => tier.minSeasonXp);
    const multipliers = TIERS.map((tier) => tier.multiplier);

    expect(thresholds).toEqual([...thresholds].sort((a, b) => a - b));
    expect(multipliers).toEqual([...multipliers].sort((a, b) => a - b));
  });
});

describe("rank progress", () => {
  it("reports the distance to the next rank", () => {
    const tier = buildTier(3_000);

    expect(tier.rank).toBe("climber");
    expect(tier.nextRank).toBe("ridge");
    expect(tier.nextRankAtXp).toBe(10_000);
    expect(tier.xpToNextRank).toBe(7_000);
  });

  /**
   * Null rather than zero at the top. "0 XP to go" reads as being on the cusp
   * of something, which is the opposite of having arrived.
   */
  it("has no next rank at the top", () => {
    const tier = buildTier(200_000);

    expect(tier.rank).toBe("peak");
    expect(tier.nextRank).toBeNull();
    expect(tier.nextRankAtXp).toBeNull();
    expect(tier.xpToNextRank).toBeNull();
  });
});

describe("tier bonus", () => {
  /**
   * Returned separately from the base amount because it is written as its own
   * ledger row. Folding it in would make every historical total a function of
   * today's rank, so a promotion would silently rewrite last week's earnings.
   */
  it("is the difference the multiplier adds, not the multiplied total", () => {
    expect(tierBonusFor(100, 1.25)).toBe(25);
    expect(tierBonusFor(400, 1.5)).toBe(200);
  });

  it("pays nothing at the baseline multiplier", () => {
    expect(tierBonusFor(100, 1)).toBe(0);
  });

  it("pays nothing on a zero or negative grant", () => {
    expect(tierBonusFor(0, 2)).toBe(0);
    expect(tierBonusFor(-50, 2)).toBe(0);
  });

  // Floored, so a bonus can never round a grant up into XP nobody earned.
  it("rounds down rather than up", () => {
    expect(tierBonusFor(101, 1.1)).toBe(Math.floor(101 * 1.1) - 101);
    expect(tierBonusFor(3, 1.1)).toBe(0);
  });

  it("never exceeds the multiplier applied to the base", () => {
    for (const base of [1, 7, 100, 999, 12_345]) {
      for (const tier of TIERS) {
        const bonus = tierBonusFor(base, tier.multiplier);
        expect(base + bonus).toBeLessThanOrEqual(Math.ceil(base * tier.multiplier));
        expect(bonus).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
