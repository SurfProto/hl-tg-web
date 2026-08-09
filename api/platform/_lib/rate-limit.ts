import { enforceRateLimit, getRequestIp } from "../../market/_lib/rate-limit";

/**
 * The platform routes had no rate limiting at all, unlike the market and
 * account routes, while each quote hit Supabase several times.
 */
const PLATFORM_PER_MINUTE = 30;

export async function rateLimitPlatform(request: any, principalId: string) {
  await enforceRateLimit({
    scope: "platform:principal",
    id: principalId,
    limit: PLATFORM_PER_MINUTE,
  });
  await enforceRateLimit({
    scope: "platform:ip",
    id: getRequestIp(request),
    limit: PLATFORM_PER_MINUTE * 2,
  });
}
