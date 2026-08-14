import { afterEach, describe, expect, it, vi } from "vitest";

import { buildHeaders, looksLikeHtml, supabaseRequest } from "./supabase";

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
