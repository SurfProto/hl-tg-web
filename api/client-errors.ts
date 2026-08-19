import { redisIncrWithTtl } from "./market/_lib/redis";

/**
 * Where a crash in the mini app goes to be seen.
 *
 * The app had nowhere to report to: its logger writes to console, and a
 * console on someone's phone inside Telegram is not reachable. A user-reported
 * "a is not a function" on 2026-08-16 could not be diagnosed at all for that
 * reason, while the server-side half of the same incident was found in minutes
 * because Vercel had the logs.
 *
 * So this writes to the same place. `console.error` here becomes a runtime log
 * line, which means client crashes group under `get_runtime_errors` next to
 * server ones, with no new vendor, no new secret and no schema to migrate.
 * Retention is Vercel's; if these need to outlive that, this is the one place
 * that has to change.
 */

/** Deliberately generous for a stack, and hard-capped so a loop cannot flood. */
const LIMITS = {
  message: 500,
  stack: 4_000,
  componentStack: 2_000,
  url: 500,
  userAgent: 300,
  kind: 40,
} as const;

/**
 * Per-IP ceiling. A crash inside a render loop can fire continuously, and the
 * point is to learn that it happened, not to log every repetition.
 */
const RATE_LIMIT_PER_MINUTE = 30;

/** Anything past this is not a report worth reading. */
const MAX_BODY_BYTES = 16_000;

function truncate(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…[truncated]` : trimmed;
}

function getClientIp(request: any): string {
  const forwarded = request.headers?.["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return String(first ?? "unknown").split(",")[0]!.trim() || "unknown";
}

function parseBody(request: any): Record<string, unknown> {
  if (request.body == null || request.body === "") return {};
  if (typeof request.body === "string") {
    if (Buffer.byteLength(request.body, "utf8") > MAX_BODY_BYTES) {
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    try {
      return JSON.parse(request.body) as Record<string, unknown>;
    } catch {
      throw new Error("INVALID_JSON");
    }
  }
  return request.body as Record<string, unknown>;
}

export default async function handler(request: any, response: any) {
  // No auth: a session that is broken enough to crash may not have a usable
  // token, and an error that only reports itself when everything works is not
  // worth having.
  if (request.method !== "POST") {
    response.status(405).json({ success: false, code: "METHOD_NOT_ALLOWED" });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = parseBody(request);
  } catch (error) {
    const code =
      error instanceof Error && error.message === "PAYLOAD_TOO_LARGE"
        ? "PAYLOAD_TOO_LARGE"
        : "INVALID_JSON";
    response.status(400).json({ success: false, code });
    return;
  }

  const message = truncate(body.message, LIMITS.message);
  if (!message) {
    response.status(400).json({ success: false, code: "MESSAGE_REQUIRED" });
    return;
  }

  const ip = getClientIp(request);
  try {
    const count = await redisIncrWithTtl(`client-errors:${ip}`, 60);
    if (count > RATE_LIMIT_PER_MINUTE) {
      response.status(429).json({ success: false, code: "RATE_LIMITED" });
      return;
    }
  } catch {
    // Redis being unreachable must not swallow the report. Degrading to
    // unlimited logging is the safer failure here — the same call in
    // market/_lib/redis.ts already degrades rather than throws.
  }

  console.error("[client-error]", {
    kind: truncate(body.kind, LIMITS.kind) ?? "unknown",
    message,
    stack: truncate(body.stack, LIMITS.stack),
    componentStack: truncate(body.componentStack, LIMITS.componentStack),
    url: truncate(body.url, LIMITS.url),
    userAgent:
      truncate(body.userAgent, LIMITS.userAgent) ??
      truncate(request.headers?.["user-agent"], LIMITS.userAgent),
    reportedAt: new Date().toISOString(),
  });

  response.status(204).end();
}
