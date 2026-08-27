import { fetchWithTimeout } from "./fetch-with-timeout";

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
  const response = await fetchWithTimeout(
    `${config.supabaseUrl}/rest/v1/${path}`,
    init,
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${body}`);
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
  if (rawBody.length === 0) {
    return null as T;
  }

  if (contentType.includes("text/html") || looksLikeHtml(rawBody)) {
    throw new Error(`Supabase returned HTML for ${path}`);
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new Error(`Supabase returned invalid JSON for ${path}`);
  }
}
