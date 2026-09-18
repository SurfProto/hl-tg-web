import { describe, expect, it } from "vitest";
import { buildGrowthFunnel, type FunnelInputs } from "./growth-funnel";

const NOW = "2026-03-01T00:00:00.000Z";
const JOINED = "2026-02-01T00:00:00.000Z"; // 28 days before NOW
const D7_LATER = "2026-02-10T00:00:00.000Z"; // 9 days after JOINED

function baseInputs(overrides: Partial<FunnelInputs> = {}): FunnelInputs {
  return {
    attributions: [],
    wnftByUser: new Map(),
    fundedUserIds: new Set(),
    lastActivityByUser: new Map(),
    spendByCampaign: new Map(),
    retentionDays: 7,
    ...overrides,
  };
}

describe("buildGrowthFunnel", () => {
  it("groups by campaign, and computes funded, WNFT and CAC per channel", () => {
    const report = buildGrowthFunnel(
      baseInputs({
        attributions: [
          { userId: "u1", source: "campaign", campaignCode: "twitter", firstSeenAt: JOINED },
          { userId: "u2", source: "campaign", campaignCode: "twitter", firstSeenAt: JOINED },
          { userId: "u3", source: "referral", campaignCode: null, firstSeenAt: JOINED },
        ],
        fundedUserIds: new Set(["u1", "u2"]),
        wnftByUser: new Map([
          ["u1", "confirmed"],
          ["u2", "provisional"],
        ]),
        spendByCampaign: new Map([["twitter", 200]]),
      }),
    );

    const twitter = report.channels.find((c) => c.channel === "twitter")!;
    expect(twitter).toMatchObject({
      authedUsers: 2,
      fundedUsers: 2,
      wnftConfirmed: 1,
      wnftProvisional: 1,
      spendUsd: 200,
      cacUsd: 100, // 200 / 2 funded
    });

    const referral = report.channels.find((c) => c.channel === "(referral)")!;
    expect(referral).toMatchObject({ authedUsers: 1, fundedUsers: 0, spendUsd: 0, cacUsd: null });
  });

  it("counts D7 only when activity is at least the retention window after joining", () => {
    const report = buildGrowthFunnel(
      baseInputs({
        attributions: [
          { userId: "retained", source: "campaign", campaignCode: "x", firstSeenAt: JOINED },
          { userId: "churned", source: "campaign", campaignCode: "x", firstSeenAt: JOINED },
          { userId: "silent", source: "campaign", campaignCode: "x", firstSeenAt: JOINED },
        ],
        lastActivityByUser: new Map([
          ["retained", D7_LATER], // 9 days later → retained
          ["churned", "2026-02-03T00:00:00.000Z"], // 2 days later → not D7
          // "silent" has no activity at all
        ]),
      }),
    );

    expect(report.channels[0].d7Active).toBe(1);
  });

  it("leaves CAC null when spend is set but nobody funded, and when nobody paid", () => {
    const report = buildGrowthFunnel(
      baseInputs({
        attributions: [
          { userId: "u1", source: "campaign", campaignCode: "paid", firstSeenAt: JOINED },
          { userId: "u2", source: "campaign", campaignCode: "free", firstSeenAt: JOINED },
        ],
        fundedUserIds: new Set(["u2"]),
        spendByCampaign: new Map([["paid", 500]]), // spend but no funded
      }),
    );

    expect(report.channels.find((c) => c.channel === "paid")!.cacUsd).toBeNull();
    expect(report.channels.find((c) => c.channel === "free")!.cacUsd).toBeNull();
  });

  it("totals across channels, with a blended CAC", () => {
    const report = buildGrowthFunnel(
      baseInputs({
        attributions: [
          { userId: "u1", source: "campaign", campaignCode: "a", firstSeenAt: JOINED },
          { userId: "u2", source: "campaign", campaignCode: "b", firstSeenAt: JOINED },
        ],
        fundedUserIds: new Set(["u1", "u2"]),
        spendByCampaign: new Map([["a", 100], ["b", 300]]),
      }),
    );

    expect(report.totals).toMatchObject({
      authedUsers: 2,
      fundedUsers: 2,
      spendUsd: 400,
      cacUsd: 200, // 400 / 2
    });
  });

  it("is empty, not broken, with no data", () => {
    const report = buildGrowthFunnel(baseInputs());
    expect(report.channels).toEqual([]);
    expect(report.totals).toMatchObject({ authedUsers: 0, cacUsd: null });
  });
});

// A tiny explicit NOW keeps the retention arithmetic legible above.
void NOW;
