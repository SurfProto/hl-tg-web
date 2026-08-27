import { describe, expect, it } from "vitest";
import { buildReferralMilestoneEntries } from "./referrals";

const ARGS = { seasonId: "season-1", weekStart: "2026-08-24T00:00:00.000Z" };

function entriesFor(milestone: "funded" | "traded" | "retained") {
  return buildReferralMilestoneEntries({
    milestones: [{ milestone, refereeId: "referee-1", referrerId: "referrer-1" }],
    ...ARGS,
  });
}

describe("referral milestone grants", () => {
  /**
   * The bug this replaces: the old key was
   * `quest:{season}:{referrer}:referral_funded_friend:xp` — one row per
   * referrer per season — so a referrer who brought ten funded friends was
   * paid for one. The referee has to be in the key.
   */
  it("keys on the referee, so each referral pays separately", () => {
    const entries = buildReferralMilestoneEntries({
      milestones: [
        { milestone: "traded", refereeId: "referee-1", referrerId: "referrer-1" },
        { milestone: "traded", refereeId: "referee-2", referrerId: "referrer-1" },
        { milestone: "traded", refereeId: "referee-3", referrerId: "referrer-1" },
      ],
      ...ARGS,
    });

    const referrerGrants = entries.filter((entry) => entry.userId === "referrer-1");
    expect(referrerGrants).toHaveLength(3);
    expect(new Set(referrerGrants.map((entry) => entry.idempotencyKey)).size).toBe(3);
  });

  /**
   * No season in the key. A referral milestone happens once in a user's life,
   * and re-granting it every eight weeks would turn the funnel into a
   * subscription.
   */
  it("grants a milestone once ever, not once per season", () => {
    const [entry] = entriesFor("traded");

    expect(entry!.idempotencyKey).toBe("referral:traded:referee-1:referrer");
    expect(entry!.idempotencyKey).not.toContain("season-1");
  });

  it("pays the referrer nothing for funding alone", () => {
    const entries = entriesFor("funded");

    expect(entries.filter((entry) => entry.userId === "referrer-1")).toEqual([]);
    // The referee still gets their welcome bonus.
    expect(entries.filter((entry) => entry.userId === "referee-1")).toHaveLength(1);
  });

  /**
   * Two thirds of the referrer's total weight sits on retention, which is the
   * only rung that cannot be compressed into an afternoon. That is what prices
   * a real trader above a warm body.
   */
  it("weights retention above everything else for the referrer", () => {
    const traded = entriesFor("traded").find((entry) => entry.userId === "referrer-1");
    const retained = entriesFor("retained").find((entry) => entry.userId === "referrer-1");

    expect(traded!.amount).toBe(750);
    expect(retained!.amount).toBe(1_500);

    const total = 0 + traded!.amount + retained!.amount;
    expect(retained!.amount / total).toBeGreaterThanOrEqual(2 / 3);
  });

  it("pays both sides on the rungs that pay at all", () => {
    for (const milestone of ["traded", "retained"] as const) {
      const entries = entriesFor(milestone);
      expect(entries.map((entry) => entry.userId).sort()).toEqual(["referee-1", "referrer-1"]);
    }
  });

  it("grants only XP, never anything redeemable", () => {
    for (const milestone of ["funded", "traded", "retained"] as const) {
      for (const entry of entriesFor(milestone)) {
        expect(entry.rewardKind).toBe("xp");
        expect(entry.asset).toBeNull();
        expect(entry.status).toBe("posted");
      }
    }
  });

  // A dry invite has no rung at all. An empty wallet costs an attacker nothing,
  // and if XP ever backs an allocation, paying for one pays out cap table.
  it("has no rung for an account that only exists", () => {
    const entries = buildReferralMilestoneEntries({
      milestones: [
        { milestone: "dry" as never, refereeId: "referee-1", referrerId: "referrer-1" },
      ],
      ...ARGS,
    });

    expect(entries).toEqual([]);
  });
});
