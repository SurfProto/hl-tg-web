import { toErrorBody } from "../../_lib/error-response";
import { HttpError } from "../../_lib/http-error";

export type CacheState = "hit" | "miss" | "stale";
export type CacheSource = "memory" | "redis" | "upstream";

export interface ResponseMeta {
  cache: CacheState;
  source: CacheSource;
  fetchedAt: number;
  ttlSeconds: number;
  /**
   * Where a request's time went, in milliseconds. Present so latency work is
   * measured rather than guessed: market:stats holds ~157KB, and a cache hit
   * still pays a Redis round trip plus a JSON.parse of all of it.
   */
  timings?: {
    redisMs: number;
    parseMs: number;
    upstreamMs?: number;
    cachedBytes?: number;
  };
}

export { HttpError };

export function ensureGet(request: any) {
  if (request.method !== "GET") {
    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Expected GET");
  }
}

export function getQueryValue(request: any, key: string): string | null {
  const value = request.query?.[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return typeof value === "string" ? value : null;
}

export function getRequiredQueryValue(request: any, key: string): string {
  const value = getQueryValue(request, key)?.trim();
  if (!value) {
    throw new HttpError(400, "INVALID_REQUEST", `Missing required query parameter: ${key}`);
  }

  return value;
}

export function jsonSuccess<T>(
  response: any,
  data: T,
  meta: ResponseMeta,
  options: { private?: boolean } = {},
) {
  if (options.private) {
    response.setHeader?.("Cache-Control", "private, no-store");
  } else {
    response.setHeader?.(
      "Cache-Control",
      `public, max-age=0, s-maxage=${Math.max(0, meta.ttlSeconds)}`,
    );
  }

  response.status(200).json({
    success: true,
    data,
    meta,
  });
}

export function jsonError(response: any, error: unknown) {
  const { statusCode, body } = toErrorBody(error);
  response.status(statusCode).json(body);
}

export async function withRoute(response: any, handler: () => Promise<void>) {
  try {
    await handler();
  } catch (error) {
    jsonError(response, error);
  }
}
