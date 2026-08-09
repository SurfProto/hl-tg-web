import { getMarketPolicy } from "../../market/_lib/config";
import { enforceRateLimit, getRequestIp } from "../../market/_lib/rate-limit";

export async function rateLimitAccount(request: any, privyUserId: string) {
  const policy = getMarketPolicy();
  await enforceRateLimit({
    scope: "account:user",
    id: privyUserId,
    limit: policy.rateLimit.accountPerMinute,
  });
  await enforceRateLimit({
    scope: "account:ip",
    id: getRequestIp(request),
    limit: policy.rateLimit.accountPerMinute * 2,
  });
}
