import { HyperliquidClient } from "../../../packages/hyperliquid-sdk/src/client";
import type { MarketDataService } from "./types";

export function createHyperliquidMarketDataService(
  testnet: boolean,
): MarketDataService {
  const clients = new Map<string, HyperliquidClient>();

  function getClient(walletAddress: string): HyperliquidClient {
    const existing = clients.get(walletAddress);
    if (existing) {
      return existing;
    }

    const client = new HyperliquidClient({
      walletAddress,
      testnet,
    });
    clients.set(walletAddress, client);
    return client;
  }

  return {
    async getFills(walletAddress) {
      return getClient(walletAddress).getFills();
    },
    async getPositions(walletAddress) {
      // The SDK fans user state out to loaded dexes only — right for the
      // app, which enumerates markets at startup, but this worker never
      // does, so without loading them here HIP-3 positions are invisible
      // to liquidation detection. Idempotent and cached per client.
      const client = getClient(walletAddress);
      await client.loadAllHip3Dexes();
      const state = await client.getUserState({ fresh: true });
      return state.assetPositions.map(({ position }) => ({
        coin: position.coin,
        szi: position.szi,
        entryPx: position.entryPx,
        liquidationPx: position.liquidationPx,
      }));
    },
    async getMids(coins) {
      if (coins.length === 0) {
        return {};
      }

      // Same reason as getPositions: a HIP-3 position's mid only exists once
      // its dex's universe is loaded, and without the mid the detector
      // silently skipped the position — no alert, no log.
      const client = getClient("0x0000000000000000000000000000000000000000");
      await client.loadAllHip3Dexes();
      const mids = await client.getMids();
      return coins.reduce<Record<string, number>>((result, coin) => {
        const value = mids[coin];
        if (value != null) {
          result[coin] = Number(value);
        } else {
          // A position with no mid gets no liquidation alerts. That must be
          // visible, not a quiet continue in the detector.
          console.warn(`[notifications] no mid for position coin ${coin}`);
        }
        return result;
      }, {});
    },
  };
}
