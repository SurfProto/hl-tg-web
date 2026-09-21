import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpstreamTimeoutError } from "../_lib/fetch-with-timeout";
import { SupabaseRequestError } from "../_lib/supabase";
import { HttpError } from "../onramp/_lib/http";

const mocks = vi.hoisted(() => ({ supabaseRequest: vi.fn(), enforceRateLimit: vi.fn() }));

vi.mock("../_lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_lib/supabase")>()),
  supabaseRequest: mocks.supabaseRequest,
  buildHeaders: () => ({}),
}));
vi.mock("../market/_lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../market/_lib/rate-limit")>()),
  enforceRateLimit: mocks.enforceRateLimit,
}));
vi.mock("../profile/_lib/config", () => ({
  getSupabaseConfig: () => ({ supabaseUrl: "https://supabase.example", supabaseServiceRoleKey: "k" }),
}));

function makeResponse() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = (n: string, v: string) => { res.headers[n] = v; };
  return res;
}
async function probe(request: any = { headers: {}, method: "GET" }) {
  const { default: handler } = await import("./db");
  const response = makeResponse();
  await handler(request, response);
  return response;
}
const down = (status: number) =>
  new SupabaseRequestError(`Supabase request failed: ${status} <!DOCTYPE html>tdltptrpgxweyulkenza.supabase.co`, "http", status);

describe("GET /api/health/db", () => {
  let logged: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    mocks.supabaseRequest.mockReset();
    mocks.enforceRateLimit.mockReset().mockResolvedValue(undefined);
    logged = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each([["GET"], ["HEAD"]])("%s answers 200 up after one HEAD probe that returns no row", async (method) => {
    mocks.supabaseRequest.mockResolvedValue(null);
    const res = await probe({ headers: {}, method });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { ok: true } });
    expect(typeof res.body.data.latencyMs).toBe("number");
    expect(res.headers["Cache-Control"]).toBe("no-store");
    const [, path, init] = mocks.supabaseRequest.mock.calls[0]!;
    expect(path).toBe("users?select=id&limit=1");
    expect(init.method).toBe("HEAD");
  });

  it.each([
    ["timeout", new UpstreamTimeoutError("https://supabase.example", 4000)],
    ["unreachable", down(522)],
    ["unreachable", new SupabaseRequestError("Supabase request failed: fetch failed", "network", null)],
    ["error", new SupabaseRequestError("Supabase returned HTML for users", "html", 200)],
    ["error", down(401)],
    ["error", new Error("permission denied for table users")],
  ])("answers 503 down with reason %s, uncacheable, with a latency", async (reason, error) => {
    mocks.supabaseRequest.mockRejectedValue(error);
    const res = await probe();
    expect(res.statusCode).toBe(503);
    expect(res.body.data).toMatchObject({ ok: false, reason });
    expect(typeof res.body.data.latencyMs).toBe("number");
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("never repeats the backend's error text, status body or hostname", async () => {
    mocks.supabaseRequest.mockRejectedValue(down(522));
    const text = JSON.stringify((await probe()).body).toLowerCase();
    for (const leak of ["doctype", "html", "supabase", "tdltptrpgxweyulkenza", "failed"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("logs a compact record - kind, status, at most 200 characters - never the page", async () => {
    const page = "Supabase request failed: 522 " + "<!DOCTYPE html>".repeat(400) + "END_MARKER";
    mocks.supabaseRequest.mockRejectedValue(new SupabaseRequestError(page, "http", 522));
    await probe();
    const record = logged.mock.calls[0]?.[1] as { message: string };
    expect(record).toMatchObject({ reason: "unreachable", kind: "http", status: 522 });
    expect(record.message.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(logged.mock.calls[0])).not.toContain("END_MARKER");
  });

  it("keys the limit on x-real-ip, else the LAST forwarded hop - never the first", async () => {
    await probe({ headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" }, method: "GET" });
    expect(mocks.enforceRateLimit).toHaveBeenLastCalledWith({ scope: "health-db", id: "10.0.0.1", limit: 30 });
    await probe({ headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4" }, method: "GET" });
    expect(mocks.enforceRateLimit).toHaveBeenLastCalledWith({ scope: "health-db", id: "9.9.9.9", limit: 30 });
  });

  it("answers 429, uncacheable, without touching the database once over the limit", async () => {
    mocks.enforceRateLimit.mockRejectedValue(new HttpError(429, "RATE_LIMITED", "Too many requests"));
    const res = await probe();
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe("RATE_LIMITED");
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(mocks.supabaseRequest).not.toHaveBeenCalled();
  });

  it("still probes when the limiter throws something other than a refusal", async () => {
    mocks.enforceRateLimit.mockRejectedValue(new Error("malformed upstash payload"));
    mocks.supabaseRequest.mockResolvedValue(null);
    expect((await probe()).statusCode).toBe(200);
    expect(mocks.supabaseRequest).toHaveBeenCalledTimes(1);
  });

  it("refuses other methods with 405, still uncacheable, before probing", async () => {
    const res = await probe({ headers: {}, method: "POST" });
    expect(res.statusCode).toBe(405);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(mocks.supabaseRequest).not.toHaveBeenCalled();
  });
});
