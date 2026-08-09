import { getMarketPolicy } from "../market/_lib/config";
import { handleCachedAccountRoute, isTestnet } from "./_lib/route";
import { getAccountFills } from "./_lib/upstream";

export default async function handler(request: any, response: any) {
  const policy = getMarketPolicy();
  await handleCachedAccountRoute(request, response, {
    cacheKey: (walletAddress) => `account:fills:${walletAddress}`,
    ttlSeconds: policy.ttlSeconds.accountFills,
    fetchFresh: (walletAddress) =>
      getAccountFills({
        walletAddress,
        testnet: isTestnet(),
      }),
  });
}
