import { UpstreamTimeoutError, fetchWithTimeout } from "./fetch-with-timeout";

/**
 * One PostgREST client for every `_lib/supabase-admin.ts`.
 *
 * There were four character-identical copies of the three functions below — in
 * onramp, profile, rewards and the parked platform layer. That is the same
 * duplication class as the two `HttpError` declarations that took production's
 * API down: copies drift, and the ones that drift silently are the expensive
 * ones. A route module keeps its own row types and queries; only the transport
 * lives here.
 */

/** The part of every route group's config that names a Supabase project. */
export interface SupabaseConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

/**
 * A PostgREST answer this transport could not accept, typed so a caller can
 * tell an availability failure from a verdict. `http` is any non-2xx and the
 * status says which: a 522 is Cloudflare failing to reach Supabase, a 401 a bad
 * service key. `html` is a page where JSON should be; `invalid-json` a body
 * that would not parse; `network` is no answer at all — DNS, a refused or reset
 * connection, a TLS failure. Each message's status prefix is unchanged, so
 * anything matching on it still does; the body is capped at 200 characters.
 */
export class SupabaseRequestError extends Error {
  constructor(
    message: string,
    readonly kind: "http" | "html" | "invalid-json" | "network",
    readonly status: number | null,
  ) {
    super(message);
    this.name = "SupabaseRequestError";
  }
}

/**
 * Did Supabase fail to *answer*, as opposed to answering with a refusal?
 *
 * The shapes an outage takes: the 4s deadline firing, a connection that never
 * opened (DNS, refused, reset, TLS), and a 5xx — on 2026-09-18 Cloudflare's
 * 522 page for over an hour. Everything else is Supabase, or something standing
 * where Supabase should be, *speaking*: a 4xx is a rotated key, a dropped
 * column or a bad path; a 2xx HTML page is a misrouted URL or Vercel's SPA
 * fallback (Cloudflare's error pages arrive as 5xx, never 2xx); invalid JSON is
 * a body from the wrong service. Treating any of those as an outage would hide
 * a broken deploy behind reads that appear to work.
 */
export function isSupabaseUnavailable(error: unknown): boolean {
  if (error instanceof UpstreamTimeoutError) return true;
  if (error instanceof SupabaseRequestError) {
    if (error.kind === "network") return true;
    if (error.kind === "http") return error.status != null && error.status >= 500;
  }
  return false;
}

/**
 * `vercel.json` routes an unknown `/api/*` path to `index.html` rather than a
 * 404, so a mistyped PostgREST path can come back as a 200 page of markup.
 * Parsing that as JSON would fail somewhere much further from the cause.
 */
export function looksLikeHtml(body: string): boolean {
  const trimmed = body.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

export function buildHeaders(
  config: SupabaseConfig,
  extra?: Record<string, string>,
) {
  return {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function supabaseRequest<T>(
  config: SupabaseConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${config.supabaseUrl}/rest/v1/${path}`, init);
  } catch (error) {
    // The deadline keeps its own type, and a caller's own abort is theirs to
    // handle. Anything else here is undici's bare `TypeError: fetch failed`
    // with the reason on `cause` — a connection that never opened.
    if (error instanceof UpstreamTimeoutError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new SupabaseRequestError(
      `Supabase request failed: ${reason.slice(0, 200)}`,
      "network",
      null,
    );
  }
  if (!response.ok) {
    const body = await response.text();
    throw new SupabaseRequestError(
      `Supabase request failed: ${response.status} ${body.slice(0, 200)}`,
      "http",
      response.status,
    );
  }

  if (response.status === 204) {
    return null as T;
  }

  const rawBody = await response.text();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  // `Prefer: return=minimal` answers a PATCH with 204 but an insert with 201
  // and an empty body, which the check above does not cover. Parsing that threw
  // "invalid JSON", so a write that had in fact succeeded was reported to its
  // caller as a failure — which cost the deposit worker its first production
  // run: seventeen rows landed, the checkpoint recorded LEDGER_WRITE_FAILED,
  // and the cursor was left behind data that was already written.
  //
  // An empty body is never valid JSON, so nothing that used to succeed changes
  // meaning here; a response with no content is reported as no content.
  // The header check comes before the empty-body return: a HEAD answered by a
  // web page has no body to sniff, and the probe that relies on HEAD must not
  // read "200 text/html, nothing to parse" as the database answering.
  if (contentType.includes("text/html")) {
    throw new SupabaseRequestError(`Supabase returned HTML for ${path}`, "html", response.status);
  }

  if (rawBody.length === 0) {
    return null as T;
  }

  if (looksLikeHtml(rawBody)) {
    throw new SupabaseRequestError(`Supabase returned HTML for ${path}`, "html", response.status);
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new SupabaseRequestError(
      `Supabase returned invalid JSON for ${path}`,
      "invalid-json",
      response.status,
    );
  }
}
