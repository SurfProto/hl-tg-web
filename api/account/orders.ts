import { getMarketPolicy } from "../market/_lib/config";
import { handleCachedAccountRoute, isTestnet } from "./_lib/route";
import { getAccountOrders } from "./_lib/upstream";

export default async function handler(request: any, response: any) {
  const policy = getMarketPolicy();
  await handleCachedAccountRoute(request, response, {
    cacheKey: (walletAddress) => `account:orders:${walletAddress}`,
    ttlSeconds: policy.ttlSeconds.accountOrders,
    fetchFresh: (walletAddress) =>
      getAccountOrders({
        walletAddress,
        testnet: isTestnet(),
      }),
  });
}
