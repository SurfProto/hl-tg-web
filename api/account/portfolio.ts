import { getMarketPolicy } from "../market/_lib/config";
import { getQueryValue } from "../market/_lib/response";
import { handleCachedAccountRoute, isTestnet } from "./_lib/route";
import { getAccountPortfolio } from "./_lib/upstream";

function normalizePeriod(value: string | null) {
  return value === "1d" || value === "30d" ? value : "7d";
}

export default async function handler(request: any, response: any) {
  const policy = getMarketPolicy();
  const period = normalizePeriod(getQueryValue(request, "period"));
  await handleCachedAccountRoute(request, response, {
    cacheKey: (walletAddress) => `account:portfolio:${walletAddress}:${period}`,
    ttlSeconds: policy.ttlSeconds.accountPortfolio,
    fetchFresh: (walletAddress) =>
      getAccountPortfolio({
        walletAddress,
        period,
        testnet: isTestnet(),
      }),
  });
}
