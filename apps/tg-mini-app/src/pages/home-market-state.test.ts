import { describe, expect, it } from "vitest";
import { getHomeMarketDisplayState } from "./home-market-state";

describe("getHomeMarketDisplayState", () => {
  it("returns a loading state while market stats are still pending", () => {
    expect(
      getHomeMarketDisplayState({
        stats: undefined,
        marketStatsFailed: false,
      }),
    ).toEqual({
      dataState: "loading",
      price: null,
      change24h: null,
      volume: null,
    });
  });

  it("returns an unavailable state when market stats fail", () => {
    expect(
      getHomeMarketDisplayState({
        stats: undefined,
        marketStatsFailed: true,
      }),
    ).toEqual({
      dataState: "error",
      price: null,
      change24h: null,
      volume: null,
    });
  });

  it("returns formatted market values once stats are ready", () => {
    expect(
      getHomeMarketDisplayState({
        stats: {
          coin: "BTC",
          markPx: 103456.12,
          prevDayPx: 100000,
          dayNtlVlm: 456700000,
          openInterest: 0,
          funding: 0,
          oraclePx: 103450,
          change24h: 3.456,
        },
        marketStatsFailed: false,
      }),
    ).toEqual({
      dataState: "ready",
      price: "$103,456.12",
      change24h: 3.456,
      volume: "$456.7M",
    });
  });
});
