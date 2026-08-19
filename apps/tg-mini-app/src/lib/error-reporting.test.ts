import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetErrorReportingForTests,
  reportClientError,
  toReportableError,
} from "./error-reporting";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetErrorReportingForTests();
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function bodyOf(call: number) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

describe("reportClientError", () => {
  it("posts the crash to the reporting endpoint", async () => {
    reportClientError({
      kind: "error-boundary",
      message: "a is not a function",
      stack: "TypeError\n  at r (index-abc.js:1:2)",
      componentStack: "in TradePage",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/client-errors");
    expect(init.method).toBe("POST");
    // keepalive, so a crash that takes the page down still gets the report out.
    expect(init.keepalive).toBe(true);
    expect(bodyOf(0)).toMatchObject({
      kind: "error-boundary",
      message: "a is not a function",
      componentStack: "in TradePage",
    });
  });

  it("includes the page and user agent for context", async () => {
    reportClientError({ kind: "window-error", message: "boom" });

    const body = bodyOf(0);
    expect(typeof body.url).toBe("string");
    expect(typeof body.userAgent).toBe("string");
  });

  it("sends one report for a crash that repeats", async () => {
    // A render loop throws the same error continuously; one report is the
    // information, the rest is noise.
    for (let i = 0; i < 50; i += 1) {
      await Promise.resolve();
      reportClientError({
        kind: "error-boundary",
        message: "a is not a function",
        stack: "TypeError\n  at r (index-abc.js:1:2)",
      });
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still reports a genuinely different crash", async () => {
    reportClientError({ kind: "error-boundary", message: "first" });
    await Promise.resolve();
    reportClientError({ kind: "error-boundary", message: "second" });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caps how much one session can send", async () => {
    for (let i = 0; i < 40; i += 1) {
      reportClientError({ kind: "window-error", message: `unique ${i}` });
      await Promise.resolve();
    }

    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it("does not report a failure of its own reporting", async () => {
    // The window.error handler fires for the failed request too. Reporting
    // that would be an unbounded loop against a broken endpoint.
    fetchMock.mockImplementation(() => {
      reportClientError({ kind: "window-error", message: "reporting failed" });
      return Promise.reject(new Error("network down"));
    });

    reportClientError({ kind: "error-boundary", message: "original" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(0).message).toBe("original");
  });

  it("never throws into the caller when the network is gone", () => {
    fetchMock.mockImplementation(() => {
      throw new Error("fetch unavailable");
    });

    expect(() =>
      reportClientError({ kind: "window-error", message: "boom" }),
    ).not.toThrow();
  });

  it("recovers after a failed report so the next crash is still sent", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    reportClientError({ kind: "error-boundary", message: "first" });
    await Promise.resolve();
    await Promise.resolve();

    reportClientError({ kind: "error-boundary", message: "second" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("toReportableError", () => {
  it("reads message and stack off an Error", () => {
    const error = new Error("boom");
    expect(toReportableError(error)).toMatchObject({ message: "boom" });
    expect(toReportableError(error).stack).toContain("Error");
  });

  it("falls back to the name when an Error has no message", () => {
    expect(toReportableError(new TypeError()).message).toBe("TypeError");
  });

  it("handles the things that get thrown that are not Errors", () => {
    expect(toReportableError("just a string")).toEqual({
      message: "just a string",
      stack: null,
    });
    expect(toReportableError({ code: 42 })).toEqual({
      message: '{"code":42}',
      stack: null,
    });
  });

  it("survives a value that cannot be serialised", () => {
    const circular: any = {};
    circular.self = circular;
    expect(toReportableError(circular)).toEqual({
      message: "Unknown error",
      stack: null,
    });
  });
});
