import { UpstreamTimeoutError } from "../_lib/fetch-with-timeout";
import {
  SupabaseRequestError,
  buildHeaders,
  isSupabaseUnavailable,
  supabaseRequest,
} from "../_lib/supabase";
import { enforceRateLimit, getRequestIp } from "../market/_lib/rate-limit";
import { HttpError, json, withJsonRoute } from "../onramp/_lib/http";
import { getSupabaseConfig } from "../profile/_lib/config";

/**
 * Is the database actually answering?
 *
 * `/api/health/deps` proves the code *loads*; it never opens a connection, and
 * on 2026-09-18 it reported eleven green modules through a full database
 * outage — every account read failing on a Cloudflare 522 from Supabase, and
 * the only place that was visible the runtime log. This is the round trip that
 * check never made: one real PostgREST request, bounded by the shared fetch
 * deadline, answered as up or down.
 *
 * Public on purpose: the point is a probe that needs no secret — an uptime
 * monitor, the smoke check, a browser during an incident. What keeps a public
 * database probe from becoming a lever against the database: the request is
 * the cheapest PostgREST can serve and returns no row, and each IP gets a
 * handful of probes a minute. It says up or down and how long that took; it
 * repeats no error text, status body or hostname, because a public route must
 * not narrate the backend's failures.
 */

/** Room for a few monitor regions plus the smoke check inside one minute. */
const RATE_LIMIT_PER_MINUTE = 30;

/**
 * HEAD against a table every deployment has: PostgREST runs the same plan on
 * the same connection as a GET and returns no body, so no user's row ever
 * transits this function.
 */
const PROBE_PATH = "users?select=id&limit=1";

type DownReason = "timeout" | "unreachable" | "error";

function classify(error: unknown): DownReason {
  if (error instanceof UpstreamTimeoutError) return "timeout";
  if (isSupabaseUnavailable(error)) return "unreachable";
  return "error";
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    // Every branch, refusals included, must say it is not cacheable.
    if (typeof response.setHeader === "function") {
      response.setHeader("Cache-Control", "no-store");
    }
    // HEAD too: hosted monitors commonly probe with HEAD, and a 405 there reads
    // as "down" — or, configured leniently, as "up" through a real outage.
    if (request.method !== "GET" && request.method !== "HEAD") {
      json(response, 405, { success: false, code: "METHOD_NOT_ALLOWED" });
      return;
    }

    try {
      await enforceRateLimit({
        scope: "health-db",
        id: getRequestIp(request),
        limit: RATE_LIMIT_PER_MINUTE,
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // redisIncrWithTtl already fails open (a count of 0) when Redis is down;
      // this catches only a non-Redis throw. Either way the probe must run —
      // it is the route you reach for precisely when infrastructure is failing.
    }

    const config = getSupabaseConfig();
    const startedAt = Date.now();
    try {
      await supabaseRequest<null>(config, PROBE_PATH, {
        method: "HEAD",
        headers: buildHeaders(config),
      });
      json(response, 200, {
        success: true,
        data: { ok: true, latencyMs: Date.now() - startedAt },
      });
    } catch (error) {
      const reason = classify(error);
      // A compact record for the runtime log — never the multi-kilobyte page
      // an outage returns, and never anything in the public response.
      console.error("[health/db] probe failed", {
        reason,
        kind:
          error instanceof SupabaseRequestError
            ? error.kind
            : error instanceof UpstreamTimeoutError
              ? "timeout"
              : "other",
        status: error instanceof SupabaseRequestError ? error.status : null,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      });
      json(response, 503, {
        success: false,
        data: { ok: false, reason, latencyMs: Date.now() - startedAt },
      });
    }
  });
}
