import { UpstreamTimeoutError } from "./fetch-with-timeout";
import { SupabaseRequestError } from "./supabase";

/** Which shape an unavailability took, for a log line — never its body. */
export function describeUnavailability(error: unknown): { kind: string; status: number | null } {
  if (error instanceof UpstreamTimeoutError) return { kind: "timeout", status: null };
  if (error instanceof SupabaseRequestError) return { kind: error.kind, status: error.status };
  return { kind: "other", status: null };
}

// Per-instance, per-scope counters: the first few occurrences are logged and
// then one in a hundred, the way redis.ts caps its own failure noise. During an
// outage every account read from every active user comes through here, and a
// multi-kilobyte page per request is what buried the last incident.
const counts = new Map<string, number>();

/**
 * Record that Supabase was unavailable to `scope` — compact and throttled.
 * The response bodies say 503; this line is what lets the runtime log say
 * which layer failed, and stay readable while it does.
 */
export function noteSupabaseUnavailable(scope: string, error: unknown) {
  const count = (counts.get(scope) ?? 0) + 1;
  counts.set(scope, count);
  if (count > 3 && count % 100 !== 0) return;
  console.warn(`[supabase] unavailable (${scope})`, {
    scope,
    count,
    ...describeUnavailability(error),
  });
}

export function __resetSupabaseUnavailableTelemetryForTests() {
  counts.clear();
}
