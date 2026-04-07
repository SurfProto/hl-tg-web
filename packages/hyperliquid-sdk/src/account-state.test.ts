import { describe, expect, it } from "vitest";
import {
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
  it("requires first-run unified setup, builder approval, and agent approval", () => {
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
      shouldPromptRestoreUnified: false,
    });
  });

  it("allows standard-mode fallback when unified was previously enabled", () => {
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
      canTrade: true,
      isAgentExpired: false,
      needsAgentApproval: false,
      needsBuilderApproval: false,
      needsHip3AbstractionEnable: false,
      needsUnifiedEnable: false,
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
      shouldPromptRestoreUnified: false,
    });
  });
});
