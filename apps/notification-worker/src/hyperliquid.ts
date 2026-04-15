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
      const state = await getClient(walletAddress).getUserState({ fresh: true });
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

      const mids = await getClient("0x0000000000000000000000000000000000000000").getMids();
      return coins.reduce<Record<string, number>>((result, coin) => {
        const value = mids[coin];
        if (value != null) {
          result[coin] = Number(value);
        }
        return result;
      }, {});
    },
  };
}
