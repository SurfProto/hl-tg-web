import { describe, expect, it } from "vitest";
import {
  combineStableBalances,
  evaluateTradingSetupStatus,
  getAvailableCollateralForMarket,
  getVisibleStableBalances,
  inferAbstractionMode,
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
    expect(
      evaluateTradingSetupStatus({
        hasAgentKey: false,
        isAgentExpired: false,
        abstractionMode: "standard",
        prefersUnifiedAccount: false,
        needsBuilderApproval: true,
        targetIsHip3: false,
        hip3DexAbstractionEnabled: false,
      }),
    ).toEqual({
      canTrade: false,
      isAgentExpired: false,
      needsAgentApproval: true,
      needsBuilderApproval: true,
      needsHip3AbstractionEnable: false,
      needsUnifiedEnable: true,
      pendingSteps: ["agent", "builder", "unified"],
      shouldPromptRestoreUnified: false,
    });
  });

  it("still requires unified approval when the user disabled it after previously enabling it", () => {
    expect(
      evaluateTradingSetupStatus({
        hasAgentKey: true,
        isAgentExpired: false,
        abstractionMode: "standard",
        prefersUnifiedAccount: true,
        needsBuilderApproval: false,
        targetIsHip3: false,
        hip3DexAbstractionEnabled: false,
      }),
    ).toEqual({
      canTrade: false,
      isAgentExpired: false,
      needsAgentApproval: false,
      needsBuilderApproval: false,
      needsHip3AbstractionEnable: false,
      needsUnifiedEnable: true,
      pendingSteps: ["unified"],
      shouldPromptRestoreUnified: true,
    });
  });

  it("requires dex abstraction before a HIP-3 trade when it is missing", () => {
    expect(
      evaluateTradingSetupStatus({
        hasAgentKey: true,
        isAgentExpired: false,
        abstractionMode: "unifiedAccount",
        prefersUnifiedAccount: true,
        needsBuilderApproval: false,
        targetIsHip3: true,
        hip3DexAbstractionEnabled: false,
      }),
    ).toEqual({
      canTrade: false,
      isAgentExpired: false,
      needsAgentApproval: false,
      needsBuilderApproval: false,
      needsHip3AbstractionEnable: true,
      needsUnifiedEnable: false,
      pendingSteps: ["hip3"],
      shouldPromptRestoreUnified: false,
    });
  });

  it("keeps HIP-3 abstraction last when other approvals are also missing", () => {
    expect(
      evaluateTradingSetupStatus({
        hasAgentKey: false,
        isAgentExpired: false,
        abstractionMode: "standard",
        prefersUnifiedAccount: false,
        needsBuilderApproval: true,
        targetIsHip3: true,
        hip3DexAbstractionEnabled: false,
      }),
    ).toEqual({
      canTrade: false,
      isAgentExpired: false,
      needsAgentApproval: true,
      needsBuilderApproval: true,
      needsHip3AbstractionEnable: true,
      needsUnifiedEnable: true,
      pendingSteps: ["agent", "builder", "unified", "hip3"],
      shouldPromptRestoreUnified: false,
    });
  });
});
