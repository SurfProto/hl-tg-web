import { redisIncrWithTtl } from "./redis";
import { HttpError } from "./response";

function sanitizeKey(value: string) {
  return value.replace(/[^a-zA-Z0-9:._-]/g, "_").slice(0, 160);
}

export function getRequestIp(request: any) {
  const forwarded = request.headers?.["x-forwarded-for"] ?? request.headers?.["X-Forwarded-For"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return typeof value === "string" && value.trim()
    ? value.split(",")[0].trim()
    : "unknown";
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
