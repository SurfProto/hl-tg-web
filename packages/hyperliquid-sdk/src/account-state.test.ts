import { describe, expect, it } from "vitest";
import {
  buildAccountState,
  combineStableBalances,
  evaluateTradingSetupStatus,
  getActionableBalances,
  getAvailableCollateralForMarket,
  getNormalizedTotalEquity,
  getUnifiedApprovalState,
  getVisibleStableBalances,
  inferAbstractionMode,
  normalizePerpStableBalance,
  normalizeStableBalances,
} from "./account-state";
import type {
  RawAssetPosition,
  RawClearinghouseState,
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

describe("getNormalizedTotalEquity", () => {
  it("includes idle available balance when there are no open positions", () => {
    expect(
      getNormalizedTotalEquity({
        availableBalance: 145,
        assetPositions: [],
      }),
    ).toBe(145);
  });

  // The account that exposed this: $28.17 free, $8.06 of margin behind a 10x
  // SOFTBANK long marked at a $2.11 loss. The screen read $126.23, because
  // 3.084 × $31.83 = $98.16 of notional was being added as though it were
  // money the account held. The true figure was $34.12.
  it("counts margin and unrealised PnL, never notional", () => {
    const equity = getNormalizedTotalEquity({
      availableBalance: 28.17,
      assetPositions: [
        {
          type: "oneWay",
          position: {
            marginUsed: 8.06,
            unrealizedPnl: -2.11,
            // Present, and deliberately ignored.
            positionValue: 98.16,
          },
        } as any,
      ],
    });

    expect(equity).toBeCloseTo(34.12, 2);
    expect(equity).not.toBeCloseTo(126.33, 2);
  });

  it("sums across several positions", () => {
    expect(
      getNormalizedTotalEquity({
        availableBalance: 120,
        assetPositions: [
          { type: "oneWay", position: { marginUsed: 35.5, unrealizedPnl: 1.5 } } as any,
          { type: "oneWay", position: { marginUsed: 64.5, unrealizedPnl: -1.5 } } as any,
        ],
      }),
    ).toBeCloseTo(220, 6);
  });

  // A losing position pulls equity below the free balance. Under the old rule
  // it could only ever add.
  it("lets a loss reduce equity", () => {
    expect(
      getNormalizedTotalEquity({
        availableBalance: 10,
        assetPositions: [
          { type: "oneWay", position: { marginUsed: 5, unrealizedPnl: -8 } } as any,
        ],
      }),
    ).toBeCloseTo(7, 6);
  });

  it("ignores values that are not finite", () => {
    expect(
      getNormalizedTotalEquity({
        availableBalance: 50,
        assetPositions: [
          { type: "oneWay", position: { marginUsed: Number.NaN, unrealizedPnl: 2 } } as any,
          { type: "oneWay", position: {} } as any,
        ],
      }),
    ).toBeCloseTo(52, 6);
  });
});

describe("getUnifiedApprovalState", () => {
  it("derives unified approval directly from cached user state", () => {
    expect(
      getUnifiedApprovalState(
        {
          abstractionMode: "portfolioMargin",
        } as any,
        undefined,
      ),
    ).toEqual({
      enabled: true,
      abstractionMode: "portfolioMargin",
    });
  });

  it("falls back to stored mode when user state is not loaded yet", () => {
    expect(
      getUnifiedApprovalState(undefined, {
        enabled: false,
        abstractionMode: "standard",
      }),
    ).toEqual({
      enabled: false,
      abstractionMode: "standard",
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

describe("buildAccountState", () => {
  const perpState = ({
    totalRawUsd = "0",
    totalMarginUsed = "0",
    ...rest
  }: {
    totalRawUsd?: string;
    totalMarginUsed?: string;
    accountValue?: string;
    totalNtlPos?: string;
    withdrawable?: string;
    crossMaintenanceMarginUsed?: string;
    assetPositions?: RawAssetPosition[];
  } = {}): RawClearinghouseState => ({
    marginSummary: {
      accountValue: rest.accountValue ?? "0",
      totalMarginUsed,
      totalNtlPos: rest.totalNtlPos ?? "0",
      totalRawUsd,
    },
    crossMarginSummary: {
      accountValue: rest.accountValue ?? "0",
      totalMarginUsed,
      totalNtlPos: rest.totalNtlPos ?? "0",
      totalRawUsd,
    },
    crossMaintenanceMarginUsed: rest.crossMaintenanceMarginUsed ?? "0",
    withdrawable: rest.withdrawable ?? "0",
    assetPositions: rest.assetPositions ?? [],
  });

  const position = (
    coin: string,
    overrides: Record<string, unknown> = {},
  ): RawAssetPosition => ({
    type: "oneWay",
    position: {
      coin,
      szi: "1",
      leverage: { type: "cross", value: "5" },
      entryPx: "100",
      liquidationPx: "50",
      marginUsed: "20",
      maxLeverage: "20",
      positionValue: "100",
      returnOnEquity: "0.1",
      unrealizedPnl: "10",
      ...overrides,
    },
  });

  const build = (overrides: Partial<Parameters<typeof buildAccountState>[0]>) =>
    buildAccountState({
      baseState: perpState(),
      spotState: null,
      abstraction: null,
      hip3DexAbstractionEnabled: false,
      perpDexs: [],
      dexStates: [],
      ...overrides,
    });

  it("reads the base perp account as USDC collateral", () => {
    const state = build({
      baseState: perpState({
        totalRawUsd: "1000",
        totalMarginUsed: "200",
        totalNtlPos: "500",
        accountValue: "1000",
        withdrawable: "800",
        crossMaintenanceMarginUsed: "25",
      }),
    });

    expect(state.abstractionMode).toBe("standard");
    expect(state.stableBalances).toEqual({
      USDC: {
        total: 1000,
        hold: 200,
        available: 800,
        perp: { total: 1000, hold: 200, available: 800 },
      },
    });
    expect(state.availableBalance).toBe(800);
    expect(state.withdrawableBalance).toBe(800);
    expect(state.withdrawable).toBe(800);
    expect(state.crossMaintenanceMarginUsed).toBe(25);
    expect(state.crossMarginSummary).toEqual({
      accountValue: 1000,
      totalMarginUsed: 200,
      totalNtlPos: 500,
      totalRawUsd: 1000,
    });
  });

  // This test used to assert the opposite, in as many words: "800 idle plus a
  // 1500 position is the number the app shows". It was a deliberate choice and
  // it was wrong -- a 1500 notional position held on 200 of margin is exposure,
  // not money, and counting it made the hero figure grow with leverage. The
  // exchange's own accountValue said 1000.
  it("reports equity as collateral plus unrealised PnL, not notional", () => {
    const state = build({
      baseState: perpState({
        totalRawUsd: "1000",
        totalMarginUsed: "200",
        accountValue: "1000",
        assetPositions: [
          position("BTC", {
            positionValue: "1500",
            marginUsed: "200",
            unrealizedPnl: "0",
          }),
        ],
      }),
    });

    // 800 idle + 200 margin + 0 PnL, which is what the exchange reports too.
    expect(state.marginSummary.accountValue).toBe(1000);
    expect(state.marginSummary.totalMarginUsed).toBe(200);
  });

  it("falls back to withdrawable when no stable balance is visible", () => {
    const state = build({ baseState: perpState({ withdrawable: "42" }) });

    expect(state.visibleStableBalances).toEqual([]);
    expect(state.availableBalance).toBe(42);
    expect(state.withdrawableBalance).toBe(42);
  });

  it("ignores withdrawable once a stable balance is visible", () => {
    const state = build({
      baseState: perpState({
        totalRawUsd: "300",
        totalMarginUsed: "100",
        withdrawable: "999",
      }),
    });

    expect(state.availableBalance).toBe(200);
    expect(state.withdrawableBalance).toBe(200);
    expect(state.withdrawable).toBe(999);
  });

  it("attributes each dex state to the collateral asset at its own index", () => {
    const state = build({
      perpDexs: [
        { dex: "vntls", collateralAsset: "USDT" },
        { dex: "felix", collateralAsset: "USDH" },
      ],
      dexStates: [
        perpState({ totalRawUsd: "300", totalMarginUsed: "100" }),
        perpState({ totalRawUsd: "70", totalMarginUsed: "20" }),
      ],
    });

    expect(state.stableBalances.USDT).toMatchObject({
      total: 300,
      hold: 100,
      available: 200,
    });
    expect(state.stableBalances.USDH).toMatchObject({
      total: 70,
      hold: 20,
      available: 50,
    });
  });

  it("follows the dex states when their order changes", () => {
    // The alignment is positional, so the same balances swap assets when the
    // responses arrive in the other order.
    const state = build({
      perpDexs: [
        { dex: "vntls", collateralAsset: "USDT" },
        { dex: "felix", collateralAsset: "USDH" },
      ],
      dexStates: [
        perpState({ totalRawUsd: "70", totalMarginUsed: "20" }),
        perpState({ totalRawUsd: "300", totalMarginUsed: "100" }),
      ],
    });

    expect(state.stableBalances.USDT).toMatchObject({ total: 70 });
    expect(state.stableBalances.USDH).toMatchObject({ total: 300 });
  });

  it("sums dexes that share a collateral asset", () => {
    const state = build({
      perpDexs: [
        { dex: "vntls", collateralAsset: "USDT" },
        { dex: "felix", collateralAsset: "USDT" },
      ],
      dexStates: [
        perpState({ totalRawUsd: "300", totalMarginUsed: "100" }),
        perpState({ totalRawUsd: "200", totalMarginUsed: "50" }),
      ],
    });

    expect(state.stableBalances.USDT).toMatchObject({
      total: 500,
      hold: 150,
      available: 350,
      perp: { total: 500, hold: 150, available: 350 },
    });
  });

  it("skips the balance of a dex with no known collateral asset", () => {
    const state = build({
      perpDexs: [{ dex: "mystery" }],
      dexStates: [
        perpState({
          totalRawUsd: "300",
          totalMarginUsed: "100",
          assetPositions: [position("XYZ")],
        }),
      ],
    });

    expect(state.stableBalances.USDT).toBeUndefined();
    // Only the empty base account is left, so its 300 lands nowhere.
    expect(state.stableBalances.USDC).toMatchObject({ total: 0, available: 0 });
    // The position still shows, so an unattributable dex does not hide a trade.
    expect(state.assetPositions.map((entry) => entry.position.coin)).toEqual([
      "mystery:XYZ",
    ]);
  });

  it("qualifies HIP-3 position coins with their dex and leaves qualified ones alone", () => {
    const state = build({
      baseState: perpState({ assetPositions: [position("BTC")] }),
      perpDexs: [{ dex: "felix", collateralAsset: "USDH" }],
      dexStates: [
        perpState({ assetPositions: [position("ETH"), position("felix:SOL")] }),
      ],
    });

    expect(state.assetPositions.map((entry) => entry.position.coin)).toEqual([
      "BTC",
      "felix:ETH",
      "felix:SOL",
    ]);
  });

  it("parses position numbers and keeps a missing liquidation price null", () => {
    const state = build({
      baseState: perpState({
        assetPositions: [
          position("BTC", {
            szi: "-0.5",
            entryPx: "64000.5",
            marginUsed: "320.25",
            maxLeverage: "40",
            positionValue: "32000.25",
            returnOnEquity: "-0.125",
            unrealizedPnl: "-40.5",
          }),
          position("ETH", { liquidationPx: null }),
        ],
      }),
    });

    expect(state.assetPositions[0]).toEqual({
      type: "oneWay",
      position: {
        coin: "BTC",
        szi: -0.5,
        leverage: { type: "cross", value: 5 },
        entryPx: 64000.5,
        liquidationPx: 50,
        marginUsed: 320.25,
        maxLeverage: 40,
        positionValue: 32000.25,
        returnOnEquity: -0.125,
        unrealizedPnl: -40.5,
      },
    });
    expect(state.assetPositions[1]?.position.liquidationPx).toBeNull();
  });

  it("merges spot balances with perp balances in standard mode", () => {
    const state = build({
      baseState: perpState({ totalRawUsd: "1000", totalMarginUsed: "200" }),
      spotState: { balances: [{ coin: "USDC", total: "100", hold: "10" }] },
    });

    expect(state.stableBalances.USDC).toEqual({
      total: 1100,
      hold: 210,
      available: 890,
      spot: { total: 100, hold: 10, available: 90 },
      perp: { total: 1000, hold: 200, available: 800 },
    });
  });

  it("counts only spot balances under a unified account", () => {
    const state = build({
      baseState: perpState({ totalRawUsd: "1000", totalMarginUsed: "200" }),
      spotState: { balances: [{ coin: "USDC", total: "100", hold: "10" }] },
      abstraction: "unifiedAccount",
    });

    expect(state.abstractionMode).toBe("unifiedAccount");
    expect(state.stableBalances.USDC).toEqual({
      total: 100,
      hold: 10,
      available: 90,
      spot: { total: 100, hold: 10, available: 90 },
    });
    expect(state.availableBalance).toBe(90);
  });

  it("reports dex abstraction when the flag is on, and carries the flag through", () => {
    expect(build({ hip3DexAbstractionEnabled: true })).toMatchObject({
      abstractionMode: "dexAbstraction",
      hip3DexAbstractionEnabled: true,
    });
    expect(build({ hip3DexAbstractionEnabled: null })).toMatchObject({
      abstractionMode: "standard",
      hip3DexAbstractionEnabled: null,
    });
  });

  it("tolerates missing states rather than throwing on the account screen", () => {
    const state = build({
      baseState: null,
      spotState: null,
      perpDexs: [{ dex: "felix", collateralAsset: "USDH" }],
      dexStates: [null],
    });

    expect(state.assetPositions).toEqual([]);
    expect(state.marginSummary).toEqual({
      accountValue: 0,
      totalMarginUsed: 0,
      totalNtlPos: 0,
      totalRawUsd: 0,
    });
    expect(state.withdrawable).toBe(0);
    expect(state.availableBalance).toBe(0);
    expect(state.visibleStableBalances).toEqual([]);
  });

  it("keeps a malformed number visible as NaN instead of reading it as zero", () => {
    const state = build({
      baseState: perpState({ withdrawable: "not-a-number" }),
    });

    expect(state.withdrawable).toBeNaN();
  });
});
