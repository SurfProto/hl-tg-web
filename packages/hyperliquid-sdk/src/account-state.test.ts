import { describe, expect, it } from "vitest";
import {
  combineStableBalances,
  evaluateTradingSetupStatus,
  getActionableBalances,
  getAvailableCollateralForMarket,
  getVisibleStableBalances,
  inferAbstractionMode,
  normalizePerpStableBalance,
  normalizeStableBalances,
} from "./account-state";

describe("inferAbstractionMode", () => {
  it("maps unified account directly", () => {
    expect(inferAbstractionMode("unifiedAccount", false)).toBe(
      "unifiedAccount",
    );
  });

  it("treats default and disabled as standard when dex abstraction is off", () => {
    expect(inferAbstractionMode("default", false)).toBe("standard");
    expect(inferAbstractionMode("disabled", false)).toBe("standard");
    expect(inferAbstractionMode(null, false)).toBe("standard");
  });

  it("surfaces dex abstraction when explicitly enabled", () => {
    expect(inferAbstractionMode("default", true)).toBe("dexAbstraction");
  });
});

describe("normalizeStableBalances", () => {
  it("normalizes supported stable balances into totals, holds, and available amounts", () => {
    expect(
      normalizeStableBalances([
        { coin: "USDC", total: "12.5", hold: "2.5" },
        { coin: "USDH", total: "5", hold: "0" },
        { coin: "BTC", total: "1", hold: "0" },
      ]),
    ).toEqual({
      USDC: { total: 12.5, hold: 2.5, available: 10 },
      USDH: { total: 5, hold: 0, available: 5 },
    });
  });
});

describe("normalizePerpStableBalance", () => {
  it("derives standard perp cash balances from raw usd and margin used instead of account value", () => {
    expect(
      normalizePerpStableBalance({
        totalRawUsd: "1250",
        totalMarginUsed: "400",
      }),
    ).toEqual({
      total: 1250,
      hold: 400,
      available: 850,
      perp: {
        total: 1250,
        hold: 400,
        available: 850,
      },
    });
  });

  it("clamps available balance to zero when margin used exceeds raw usd", () => {
    expect(
      normalizePerpStableBalance({
        totalRawUsd: "50",
        totalMarginUsed: "80",
      }),
    ).toEqual({
      total: 50,
      hold: 50,
      available: 0,
      perp: {
        total: 50,
        hold: 50,
        available: 0,
      },
    });
  });
});

describe("getVisibleStableBalances", () => {
  it("only returns stable assets with a positive total or hold", () => {
    expect(
      getVisibleStableBalances({
        USDC: { total: 0, hold: 0, available: 0 },
        USDT: { total: 0, hold: 1.25, available: 0 },
        USDE: { total: 8.5, hold: 0, available: 8.5 },
      }),
    ).toEqual([
      { asset: "USDT", total: 0, hold: 1.25, available: 0 },
      { asset: "USDE", total: 8.5, hold: 0, available: 8.5 },
    ]);
  });
});

describe("getActionableBalances", () => {
  it("sums actual available balances across supported assets", () => {
    expect(
      getActionableBalances({
        USDC: { total: 100, hold: 35, available: 65 },
        USDH: { total: 30, hold: 0, available: 30 },
        USDT: { total: 5, hold: 5, available: 0 },
      }),
    ).toEqual({
      availableBalance: 95,
      withdrawableBalance: 95,
    });
  });

  it("falls back when no actual stable balances are visible", () => {
    expect(getActionableBalances({}, 17)).toEqual({
      availableBalance: 17,
      withdrawableBalance: 17,
    });
  });
});

describe("combineStableBalances", () => {
  it("combines spot and perp balances per asset in standard mode", () => {
    expect(
      combineStableBalances({
        abstractionMode: "standard",
        spotBalances: {
          USDC: { total: 12, hold: 2, available: 10 },
          USDH: { total: 5, hold: 0, available: 5 },
        },
        perpBalances: {
          USDC: { total: 30, hold: 24, available: 6 },
          USDH: { total: 7, hold: 4, available: 3 },
        },
      }),
    ).toEqual({
      USDC: {
        total: 42,
        hold: 26,
        available: 16,
        spot: { total: 12, hold: 2, available: 10 },
        perp: { total: 30, hold: 24, available: 6 },
      },
      USDH: {
        total: 12,
        hold: 4,
        available: 8,
        spot: { total: 5, hold: 0, available: 5 },
        perp: { total: 7, hold: 4, available: 3 },
      },
    });
  });

  it("treats spot as the source of truth in unified mode", () => {
    expect(
      combineStableBalances({
        abstractionMode: "unifiedAccount",
        spotBalances: {
          USDC: { total: 22, hold: 2, available: 20 },
        },
        perpBalances: {
          USDC: { total: 30, hold: 24, available: 6 },
        },
      }),
    ).toEqual({
      USDC: {
        total: 22,
        hold: 2,
        available: 20,
        spot: { total: 22, hold: 2, available: 20 },
      },
    });
  });
});

describe("getAvailableCollateralForMarket", () => {
  const stableBalances = {
    USDC: { total: 100, hold: 20, available: 80 },
    USDH: { total: 40, hold: 0, available: 40 },
    USDT: { total: 25, hold: 5, available: 20 },
  } as const;

  it("uses the matching quote asset for unified and dex abstraction modes", () => {
    expect(
      getAvailableCollateralForMarket({
        abstractionMode: "unifiedAccount",
        stableBalances,
        fallbackWithdrawable: 0,
        marketName: "builder:GOLD-USDH",
      }),
    ).toBe(40);

    expect(
      getAvailableCollateralForMarket({
        abstractionMode: "dexAbstraction",
        stableBalances,
        fallbackWithdrawable: 0,
        marketName: "builder:OIL-USDT",
      }),
    ).toBe(20);
  });

  it("falls back to withdrawable balance for standard users", () => {
    expect(
      getAvailableCollateralForMarket({
        abstractionMode: "standard",
        stableBalances,
        fallbackWithdrawable: 17,
        marketName: "BTC",
      }),
    ).toBe(17);
  });

  it("uses spot collateral for non-USDC HIP-3 markets in standard mode", () => {
    expect(
      getAvailableCollateralForMarket({
        abstractionMode: "standard",
        stableBalances,
        fallbackWithdrawable: 17,
        marketName: "builder:OIL-USDH",
      }),
    ).toBe(40);
  });

  it("uses perps withdrawable for USDC collateral in dex abstraction mode", () => {
    expect(
      getAvailableCollateralForMarket({
        abstractionMode: "dexAbstraction",
        stableBalances,
        fallbackWithdrawable: 33,
        marketName: "builder:SILVER-USDC",
      }),
    ).toBe(33);
  });
});

describe("evaluateTradingSetupStatus", () => {
  it("requires first-run gasless setup, builder approval, and unified approval", () => {
    const status = evaluateTradingSetupStatus({
      agentState: "missing",
      isAgentExpired: false,
      abstractionMode: "standard",
      prefersUnifiedAccount: false,
      builderState: "missing",
      unifiedState: "missing",
    });

    expect(status).toMatchObject({
      canTrade: false,
      isChecking: false,
      isAgentExpired: false,
      needsAgentApproval: true,
      needsBuilderApproval: true,
      needsUnifiedEnable: true,
      pendingSteps: ["agent", "builder", "unified"],
      blockingSteps: ["agent", "builder", "unified"],
      stepStates: {
        agent: "missing",
        builder: "missing",
        unified: "missing",
      },
      shouldPromptRestoreUnified: false,
    });
    expect(typeof status.lastVerifiedAt).toBe("number");
  });

  it("still requires unified approval when the user disabled it after previously enabling it", () => {
    const status = evaluateTradingSetupStatus({
      agentState: "approved",
      isAgentExpired: false,
      abstractionMode: "standard",
      prefersUnifiedAccount: true,
      builderState: "approved",
      unifiedState: "missing",
    });

    expect(status).toMatchObject({
      canTrade: false,
      isChecking: false,
      isAgentExpired: false,
      needsAgentApproval: false,
      needsBuilderApproval: false,
      needsUnifiedEnable: true,
      pendingSteps: ["unified"],
      blockingSteps: ["unified"],
      stepStates: {
        agent: "approved",
        builder: "approved",
        unified: "missing",
      },
      shouldPromptRestoreUnified: true,
    });
    expect(typeof status.lastVerifiedAt).toBe("number");
  });

  it("allows trading when approvals are verified or stale", () => {
    const status = evaluateTradingSetupStatus({
      agentState: "approved",
      isAgentExpired: false,
      abstractionMode: "unifiedAccount",
      prefersUnifiedAccount: true,
      builderState: "stale",
      unifiedState: "approved",
    });

    expect(status).toMatchObject({
      canTrade: true,
      isChecking: false,
      needsAgentApproval: false,
      needsBuilderApproval: false,
      needsUnifiedEnable: false,
      pendingSteps: [],
      blockingSteps: [],
      stepStates: {
        agent: "approved",
        builder: "stale",
        unified: "approved",
      },
    });
    expect(typeof status.lastVerifiedAt).toBe("number");
  });

  it("holds trading while approval state is still checking without surfacing a blocking step", () => {
    expect(
      evaluateTradingSetupStatus({
        agentState: "approved",
        isAgentExpired: false,
        abstractionMode: "unifiedAccount",
        prefersUnifiedAccount: true,
        builderState: "checking",
        unifiedState: "approved",
      }),
    ).toEqual({
      canTrade: false,
      isChecking: true,
      isAgentExpired: false,
      needsAgentApproval: false,
      needsBuilderApproval: false,
      needsUnifiedEnable: false,
      pendingSteps: [],
      blockingSteps: [],
      stepStates: {
        agent: "approved",
        builder: "checking",
        unified: "approved",
      },
      shouldPromptRestoreUnified: false,
      lastVerifiedAt: null,
    });
  });
});
