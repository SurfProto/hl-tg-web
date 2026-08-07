export type CacheState = "hit" | "miss" | "stale";
export type CacheSource = "memory" | "redis" | "upstream";

export interface ResponseMeta {
  cache: CacheState;
  source: CacheSource;
  fetchedAt: number;
  ttlSeconds: number;
}

export class HttpError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

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
  if (error instanceof HttpError) {
    response.status(error.statusCode).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details ?? null,
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected server error";
  response.status(500).json({
    success: false,
    error: message,
    code: "INTERNAL_ERROR",
    details: null,
  });
}

export async function withRoute(response: any, handler: () => Promise<void>) {
  try {
    await handler();
  } catch (error) {
    jsonError(response, error);
  }
}
