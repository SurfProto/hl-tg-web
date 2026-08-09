import { redisIncrWithTtl } from "./redis";
import { HttpError } from "./response";

function sanitizeKey(value: string) {
  return value.replace(/[^a-zA-Z0-9:._-]/g, "_").slice(0, 160);
}

function headerValue(request: any, name: string): string | undefined {
  const raw = request.headers?.[name] ?? request.headers?.[name.toUpperCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Resolve the client IP for rate limiting.
 *
 * Never take the *first* X-Forwarded-For entry: a client can send its own XFF
 * header and the proxy appends the real address to the end, so the first entry
 * is attacker-controlled and rotating it defeats the limit entirely. Prefer
 * x-real-ip, which Vercel sets itself, and fall back to the last XFF hop.
 */
export function getRequestIp(request: any) {
  const realIp = headerValue(request, "x-real-ip");
  if (realIp) {
    return realIp;
  }

  const forwarded = headerValue(request, "x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
    if (hops.length > 0) {
      return hops[hops.length - 1];
    }
  }

  return "unknown";
}

export async function enforceRateLimit(args: {
  scope: string;
  id: string;
  limit: number;
  windowSeconds?: number;
}) {
  const windowSeconds = args.windowSeconds ?? 60;
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `rl:${sanitizeKey(args.scope)}:${bucket}:${sanitizeKey(args.id)}`;
  const count = await redisIncrWithTtl(key, windowSeconds + 5);
  if (count > args.limit) {
    throw new HttpError(429, "RATE_LIMITED", "Too many requests");
  }
}
