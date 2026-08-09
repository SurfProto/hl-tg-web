import { getMarketPolicy } from "../market/_lib/config";
import { handleCachedAccountRoute, isTestnet } from "./_lib/route";
import { getAccountSnapshot } from "./_lib/upstream";

export default async function handler(request: any, response: any) {
  const policy = getMarketPolicy();
  await handleCachedAccountRoute(request, response, {
    cacheKey: (walletAddress) => `account:snapshot:${walletAddress}`,
    ttlSeconds: policy.ttlSeconds.accountSnapshot,
    fetchFresh: (walletAddress) =>
      getAccountSnapshot({
        walletAddress,
        testnet: isTestnet(),
      }),
  });
}
