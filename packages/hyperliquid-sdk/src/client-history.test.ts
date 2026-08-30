import { describe, expect, it } from "vitest";
import { HyperliquidClient } from "./client";

describe("HyperliquidClient.getHistoricalOrders", () => {
  it("normalizes exchange rows and derives the filled fraction", async () => {
    const client = new HyperliquidClient({
      testnet: true,
      walletAddress: "0xabc",
    });
    (client as any).getPublicClient = async () => ({
      historicalOrders: async () => [
        {
          order: {
            oid: 1,
            coin: "BTC",
            side: "B",
            limitPx: "104256",
            sz: "0.0",
            origSz: "0.5",
            timestamp: 1_700_000_000_000,
            isTrigger: false,
            reduceOnly: false,
          },
          status: "filled",
          statusTimestamp: 1_700_000_060_000,
        },
        {
          order: {
            oid: 2,
            coin: "ETH",
            side: "A",
            limitPx: "2500.5",
            sz: "1.5",
            origSz: "2.0",
            timestamp: 1,
            isTrigger: false,
            reduceOnly: false,
          },
          status: "canceled",
          statusTimestamp: 2,
        },
      ],
    });

    const orders = await client.getHistoricalOrders();

    expect(orders[0]).toMatchObject({
      oid: 1,
      side: "buy",
      limitPx: 104256,
      origSz: 0.5,
      filledSz: 0.5,
      status: "filled",
      statusTimestamp: 1_700_000_060_000,
    });
    // The exchange reports remaining size; the canceled order still shows the
    // half of it that executed rather than looking untouched.
    expect(orders[1]).toMatchObject({
      side: "sell",
      origSz: 2,
      filledSz: 0.5,
      status: "canceled",
    });
  });
});
