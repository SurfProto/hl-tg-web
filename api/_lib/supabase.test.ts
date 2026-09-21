import { afterEach, describe, expect, it, vi } from "vitest";

import { UpstreamTimeoutError } from "./fetch-with-timeout";
import {
  SupabaseRequestError,
  buildHeaders,
  isSupabaseUnavailable,
  looksLikeHtml,
  supabaseRequest,
} from "./supabase";

const config = {
  supabaseUrl: "https://project.supabase.co",
  supabaseServiceRoleKey: "service-role-key",
};

function stubResponse({
  ok = true,
  status = 200,
  body = "[]",
  contentType = "application/json",
}: {
  ok?: boolean;
  status?: number;
  body?: string;
  contentType?: string | null;
} = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => body,
    headers: { get: () => contentType },
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildHeaders", () => {
  it("sends the service role key as both apikey and bearer token", () => {
    expect(buildHeaders(config)).toEqual({
      apikey: "service-role-key",
      Authorization: "Bearer service-role-key",
      "Content-Type": "application/json",
    });
  });

  it("merges caller headers such as Prefer", () => {
    expect(buildHeaders(config, { Prefer: "return=representation" })).toMatchObject({
      apikey: "service-role-key",
      Prefer: "return=representation",
    });
  });
});

describe("supabaseRequest", () => {
  it("addresses PostgREST under the project's rest/v1 path", async () => {
    const fetchMock = stubResponse({ body: '[{"id":"user-1"}]' });

    const rows = await supabaseRequest<Array<{ id: string }>>(
      config,
      "users?select=id&limit=1",
      { headers: buildHeaders(config) },
    );

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://project.supabase.co/rest/v1/users?select=id&limit=1",
    );
    expect(rows).toEqual([{ id: "user-1" }]);
  });

  it("reports the status and body of a failed request", async () => {
    stubResponse({
      ok: false,
      status: 409,
      body: 'duplicate key value violates unique constraint "users_pkey"',
    });

    await expect(supabaseRequest(config, "users")).rejects.toThrow(
      /Supabase request failed: 409 duplicate key/,
    );
  });

  it("returns null for a 204, which is what a successful delete sends", async () => {
    stubResponse({ status: 204, body: "" });

    await expect(supabaseRequest(config, "users?id=eq.1")).resolves.toBeNull();
  });

  /**
   * `Prefer: return=minimal` answers a PATCH with 204 but an insert with 201
   * and an empty body. Parsing that threw "invalid JSON", so a write that had
   * succeeded was reported to its caller as a failure — which is exactly what
   * happened on the deposit worker's first production run: the rows landed and
   * the checkpoint recorded LEDGER_WRITE_FAILED.
   */
  it("returns null for a 201 with no body, which is what a minimal insert sends", async () => {
    stubResponse({ status: 201, body: "" });

    await expect(supabaseRequest(config, "hl_deposits")).resolves.toBeNull();
  });

  it("rejects an HTML body even when the content type claims JSON", async () => {
    // vercel.json routes an unknown /api/* path to index.html, so a mistyped
    // path can come back as a 200 page of markup.
    stubResponse({ body: "<!doctype html><html><body>app</body></html>" });

    await expect(supabaseRequest(config, "typo")).rejects.toThrow(
      /Supabase returned HTML for typo/,
    );
  });

  it("rejects an HTML content type whatever the body looks like", async () => {
    stubResponse({ body: "not markup", contentType: "text/html; charset=utf-8" });

    await expect(supabaseRequest(config, "users")).rejects.toThrow(
      /Supabase returned HTML for users/,
    );
  });

  it("names the path when the body is not JSON at all", async () => {
    stubResponse({ body: "{oops" });

    await expect(supabaseRequest(config, "users")).rejects.toThrow(
      /Supabase returned invalid JSON for users/,
    );
  });

  it("tolerates a response with no content type", async () => {
    stubResponse({ body: '{"ok":true}', contentType: null });

    await expect(supabaseRequest(config, "users")).resolves.toEqual({ ok: true });
  });
});

describe("looksLikeHtml", () => {
  it("detects markup regardless of case and leading whitespace", () => {
    expect(looksLikeHtml("  <!DOCTYPE HTML><html>")).toBe(true);
    expect(looksLikeHtml("\n<html lang=\"en\">")).toBe(true);
  });

  it("does not mistake JSON for markup", () => {
    expect(looksLikeHtml('{"html":"<html>"}')).toBe(false);
    expect(looksLikeHtml("[]")).toBe(false);
  });
});

describe("SupabaseRequestError typing", () => {
  it("carries kind http and the status for a refused request", async () => {
    stubResponse({ ok: false, status: 409, body: "duplicate" });
    await expect(supabaseRequest(config, "users")).rejects.toMatchObject({ kind: "http", status: 409 });
  });

  it("caps the body in the message at 200 characters", async () => {
    stubResponse({ ok: false, status: 522, body: "<!DOCTYPE html>" + "x".repeat(5000) });
    await expect(supabaseRequest(config, "users")).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.message.startsWith("Supabase request failed: 522 <!DOCTYPE html>") &&
        e.message.length < 260,
    );
  });

  it("carries kind html for a 200 text/html even with an empty body, as a HEAD is answered", async () => {
    stubResponse({ status: 200, body: "", contentType: "text/html" });
    await expect(supabaseRequest(config, "users", { method: "HEAD" })).rejects.toMatchObject({ kind: "html", status: 200 });
  });

  it("carries kind invalid-json for a body that will not parse", async () => {
    stubResponse({ body: "{oops" });
    await expect(supabaseRequest(config, "users")).rejects.toMatchObject({ kind: "invalid-json" });
  });

  it("wraps a connection that never opened as kind network", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(supabaseRequest(config, "users")).rejects.toMatchObject({ kind: "network", status: null });
  });

  it("lets the deadline and a caller's own abort through untouched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new UpstreamTimeoutError("u", 4000)));
    await expect(supabaseRequest(config, "users")).rejects.toBeInstanceOf(UpstreamTimeoutError);
    const abort = new Error("aborted");
    abort.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(supabaseRequest(config, "users")).rejects.toBe(abort);
  });
});

describe("isSupabaseUnavailable", () => {
  const http = (status: number) => new SupabaseRequestError("x", "http", status);
  it.each([
    ["the 4s deadline", new UpstreamTimeoutError("u", 4000), true],
    ["a connection that never opened", new SupabaseRequestError("x", "network", null), true],
    ["http 500", http(500), true],
    ["http 502", http(502), true],
    ["http 503", http(503), true],
    ["http 522", http(522), true],
    ["http 499", http(499), false],
    ["http 429", http(429), false],
    ["http 401", http(401), false],
    ["http 409", http(409), false],
    ["http with no status", new SupabaseRequestError("x", "http", null), false],
    ["html at 200 - a misrouted URL, not an outage", new SupabaseRequestError("x", "html", 200), false],
    ["invalid json", new SupabaseRequestError("x", "invalid-json", 200), false],
    ["a plain Error", new Error("x"), false],
  ])("%s -> %s", (_label, error, expected) => {
    expect(isSupabaseUnavailable(error)).toBe(expected);
  });
});
