// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./edge-proxy";
import { accountQueryRetry, useAccountSnapshot, useFills, useOpenOrders } from "./hooks";

const mocks = vi.hoisted(() => ({
  fetchAccountSnapshot: vi.fn(),
  fetchAccountOrders: vi.fn(),
  fetchAccountFills: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, user: { id: "privy-user" } }),
  useWallets: () => ({ wallets: [] }),
  useToken: () => ({ getAccessToken: async () => "token" }),
}));
vi.mock("./edge-proxy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./edge-proxy")>()),
  ...mocks,
}));

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  vi.restoreAllMocks();
});

function render<T>(hook: () => T) {
  // retryDelay 0 keeps the test fast; the hooks still supply their own `retry`.
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(hook, { wrapper });
}
const snapshot = { userState: { availableBalance: 275 }, spotBalance: { balances: [] } };

describe("accountQueryRetry", () => {
  it.each([
    ["401", new ApiError("x", 401), 0, false],
    ["403", new ApiError("x", 403), 0, false],
    ["429 inside its own window", new ApiError("x", 429), 0, false],
    ["503 CACHE_WARMING, third retry", new ApiError("x", 503, "CACHE_WARMING"), 2, true],
    ["503 CACHE_WARMING, fourth", new ApiError("x", 503, "CACHE_WARMING"), 3, false],
    ["503 PROFILE_LOOKUP_UNAVAILABLE, once", new ApiError("x", 503, "PROFILE_LOOKUP_UNAVAILABLE"), 0, true],
    ["503 PROFILE_LOOKUP_UNAVAILABLE, not twice", new ApiError("x", 503, "PROFILE_LOOKUP_UNAVAILABLE"), 1, false],
    ["500, once", new ApiError("x", 500), 0, true],
    ["500, not twice", new ApiError("x", 500), 1, false],
    ["network error, once", new Error("fetch failed"), 0, true],
    ["network error, not twice", new Error("fetch failed"), 1, false],
  ])("%s -> %s", (_label, error, failureCount, expected) => {
    expect(accountQueryRetry(failureCount, error)).toBe(expected);
  });
});

describe("account queries", () => {
  it("snapshot surfaces isError after exactly one retry against a dead backend", async () => {
    mocks.fetchAccountSnapshot.mockRejectedValue(new Error("Supabase request failed: 522"));
    const { result } = render(() => useAccountSnapshot());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mocks.fetchAccountSnapshot).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBeUndefined();
  });

  it("snapshot keeps the last-known data when a later refetch fails - the hero's contract", async () => {
    mocks.fetchAccountSnapshot.mockResolvedValue(snapshot);
    const { result } = render(() => useAccountSnapshot());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    mocks.fetchAccountSnapshot.mockRejectedValue(new Error("boom"));
    await act(async () => {
      await result.current.refetch();
    });
    // notifyManager delivers through setTimeout(0), which act() does not await.
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toMatchObject({ userState: { availableBalance: 275 } });
  });

  it.each([
    ["snapshot", () => useAccountSnapshot(), mocks.fetchAccountSnapshot, snapshot],
    ["orders", () => useOpenOrders(), mocks.fetchAccountOrders, []],
    ["fills", () => useFills(), mocks.fetchAccountFills, []],
  ])("%s passes the query's abort signal and retries once on failure", async (_label, hook, fetcher, value) => {
    fetcher.mockResolvedValue(value);
    const first = render(hook);
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    fetcher.mockReset().mockRejectedValue(new Error("Supabase request failed: 522"));
    const second = render(hook);
    await waitFor(() => expect(second.result.current.isError).toBe(true));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
