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
  code: 60,
  action: 60,
  buildId: 40,
  agentAddress: 24,
} as const;

/** The only two networks a report may claim to come from. */
const NETWORKS = ["mainnet", "testnet"] as const;
const EXCHANGE_ERROR_CODES = ["AGENT_AUTHORIZATION_REJECTED"] as const;
const TRADING_ACTIONS = [
  "cancelAllOrders",
  "cancelPositionProtection",
  "cancelOrder",
  "closePosition",
  "modifyOrder",
  "placeOrder",
  "placeSpotOrder",
  "placeTriggerOrder",
  "upsertPositionProtection",
  "updateIsolatedMargin",
  "updateLeverage",
] as const;

/**
 * The fields an `exchange-action` report may add, and nothing else.
 *
 * Built by picking rather than by spreading, deliberately. This endpoint takes
 * unauthenticated input from a client that can send whatever it likes, and a
 * pass-through would put whatever that is into the logs — an order size, a
 * balance, a master wallet address, a key. Anything not named here is dropped,
 * including an agent address that arrived unmasked: the client masks it, and
 * a value that still looks like a full address is not trusted to be one that
 * should be kept.
 */
function parseExchangeActionDetail(value: unknown) {
  if (value == null || typeof value !== "object") return null;
  const detail = value as Record<string, unknown>;

  const network = NETWORKS.find((candidate) => candidate === detail.network);

  const rawAgentAddress =
    typeof detail.agentAddress === "string" ? detail.agentAddress.trim() : null;
  const agentAddress =
    rawAgentAddress && /^0x[a-fA-F0-9]{4}…[a-fA-F0-9]{4}$/.test(rawAgentAddress)
      ? rawAgentAddress
      : null;
  const code = EXCHANGE_ERROR_CODES.find(
    (candidate) => candidate === detail.code,
  );
  const action = TRADING_ACTIONS.find(
    (candidate) => candidate === detail.action,
  );
  const rawBuildId =
    typeof detail.buildId === "string" ? detail.buildId.trim() : "";
  const buildId = /^[A-Za-z0-9._-]{1,40}$/.test(rawBuildId) ? rawBuildId : null;

  return {
    code: code ?? null,
    action: action ?? null,
    network: network ?? null,
    buildId,
    agentAddress,
  };
}

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
  return trimmed.length > max
    ? `${trimmed.slice(0, max)}…[truncated]`
    : trimmed;
}

/** Defense in depth: no caller-controlled log string may retain keys/wallets. */
function sanitizeLogText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const redacted = value
    // Keys before addresses: the first 40 hex characters of a key must never
    // be mistaken for an address and leave its remainder behind.
    .replace(/(?:0x)?[a-fA-F0-9]{64}\b/g, "[redacted-secret]")
    .replace(/0x[a-fA-F0-9]{40}\b/g, "[redacted-address]");
  return truncate(redacted, max);
}

function sanitizeReportUrl(value: unknown): string | null {
  // Redact before truncating so a long key cannot be cut into a fragment that
  // no longer matches the secret pattern.
  const raw = sanitizeLogText(value, LIMITS.url);
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return sanitizeLogText(`${parsed.origin}${parsed.pathname}`, LIMITS.url);
  } catch {
    // A relative path is still useful, but no untrusted query or fragment is.
    return sanitizeLogText(raw.split(/[?#]/, 1)[0], LIMITS.url);
  }
}

function getClientIp(request: any): string {
  const forwarded = request.headers?.["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (
    String(first ?? "unknown")
      .split(",")[0]!
      .trim() || "unknown"
  );
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

  const message = sanitizeLogText(body.message, LIMITS.message);
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
    kind: sanitizeLogText(body.kind, LIMITS.kind) ?? "unknown",
    message,
    detail: parseExchangeActionDetail(body.detail),
    stack: sanitizeLogText(body.stack, LIMITS.stack),
    componentStack: sanitizeLogText(body.componentStack, LIMITS.componentStack),
    // Treat this as untrusted even though the app strips it too. A crafted
    // unauthenticated report must not smuggle session data into runtime logs.
    url: sanitizeReportUrl(body.url),
    userAgent:
      sanitizeLogText(body.userAgent, LIMITS.userAgent) ??
      sanitizeLogText(request.headers?.["user-agent"], LIMITS.userAgent),
    reportedAt: new Date().toISOString(),
  });

  response.status(204).end();
}
