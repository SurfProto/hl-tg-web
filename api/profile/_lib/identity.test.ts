import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchPrivyUser,
  identityFromPrivyUser,
  resolveAuthoritativeProfileIdentity,
} from "./identity";

const config = {
  privyAppId: "app-id",
  privyAppSecret: "app-secret",
} as any;

const PRIVY_USER_ID = "did:privy:cmsvopij600rw0blcrwmhmjcl";

const embeddedWalletUser = {
  linked_accounts: [
    {
      type: "wallet",
      chain_type: "ethereum",
      wallet_client_type: "privy",
      connector_type: "embedded",
      address: "0xembedded",
    },
  ],
};

function stubFetch(
  responses: Array<
    | { ok?: boolean; status?: number; body?: string }
    | { throws: Error }
  >,
) {
  let call = 0;
  const fetchMock = vi.fn().mockImplementation(async () => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if ("throws" in next) throw next.throws;
    const status = next.status ?? 200;
    return {
      ok: next.ok ?? status < 400,
      status,
      text: async () => next.body ?? "{}",
      headers: { get: () => "application/json" },
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("identityFromPrivyUser", () => {
  it("selects only the Privy-managed embedded Ethereum wallet and verified email", () => {
    expect(
      identityFromPrivyUser({
        linked_accounts: [
          {
            type: "wallet",
            chain_type: "ethereum",
            wallet_client_type: "metamask",
            connector_type: "embedded",
            address: "0xexternal",
          },
          {
            type: "wallet",
            chain_type: "ethereum",
            wallet_client_type: "privy",
            connector_type: "injected",
            address: "0xnotembedded",
          },
          {
            type: "wallet",
            chain_type: "ethereum",
            wallet_client_type: "privy",
            connector_type: "embedded",
            address: "0xembedded",
          },
          {
            type: "email",
            address: " Alice@Example.com ",
            verified_at: "not-verified",
          },
          {
            type: "email",
            address: " Verified@Example.com ",
            verified_at: 1,
          },
        ],
      }),
    ).toEqual({
      walletAddress: "0xembedded",
      email: "verified@example.com",
    });
  });

  it("requires an embedded Ethereum wallet", () => {
    expect(() => identityFromPrivyUser({ linked_accounts: [] })).toThrowError(
      expect.objectContaining({ code: "EMBEDDED_WALLET_REQUIRED" }),
    );
  });
});

describe("fetchPrivyUser", () => {
  it("sends the request the SDK sent", async () => {
    const fetchMock = stubFetch([{ body: JSON.stringify(embeddedWalletUser) }]);

    await fetchPrivyUser(config, PRIVY_USER_ID, { retryDelayMs: 0 });

    const [url, init] = fetchMock.mock.calls[0];
    // Colons stay literal: the SDK's path encoder leaves them alone, and
    // percent-encoding them would change the URL being requested.
    expect(url).toBe(`https://api.privy.io/v1/users/${PRIVY_USER_ID}`);
    expect(init.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("app-id:app-secret").toString("base64")}`,
      "privy-app-id": "app-id",
    });
  });

  it("escapes a segment that is not URL-safe", async () => {
    const fetchMock = stubFetch([{ body: "{}" }]);

    await fetchPrivyUser(config, "did:privy:a b/c", { retryDelayMs: 0 });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.privy.io/v1/users/did:privy:a%20b%2Fc",
    );
  });

  it("returns the parsed user", async () => {
    stubFetch([{ body: JSON.stringify(embeddedWalletUser) }]);

    await expect(
      fetchPrivyUser(config, PRIVY_USER_ID, { retryDelayMs: 0 }),
    ).resolves.toEqual(embeddedWalletUser);
  });

  it("rejects an empty user id before making a request", async () => {
    const fetchMock = stubFetch([{ body: "{}" }]);

    await expect(fetchPrivyUser(config, "")).rejects.toThrow(
      /must not be empty/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the status and body of a failure", async () => {
    stubFetch([{ status: 404, body: '{"error":"User not found"}' }]);

    await expect(
      fetchPrivyUser(config, PRIVY_USER_ID, { retryDelayMs: 0 }),
    ).rejects.toThrow(/Privy user lookup failed: 404 .*User not found/);
  });

  it("does not retry a failure that will not change", async () => {
    const fetchMock = stubFetch([{ status: 401, body: "unauthorized" }]);

    await expect(
      fetchPrivyUser(config, PRIVY_USER_ID, { retryDelayMs: 0 }),
    ).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a rate limit and a server error, as the SDK did", async () => {
    const fetchMock = stubFetch([
      { status: 429, body: "slow down" },
      { status: 503, body: "unavailable" },
      { body: JSON.stringify(embeddedWalletUser) },
    ]);

    await expect(
      fetchPrivyUser(config, PRIVY_USER_ID, { retryDelayMs: 0 }),
    ).resolves.toEqual(embeddedWalletUser);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after the retries and reports the last failure", async () => {
    const fetchMock = stubFetch([{ status: 500, body: "boom" }]);

    await expect(
      fetchPrivyUser(config, PRIVY_USER_ID, { maxRetries: 2, retryDelayMs: 0 }),
    ).rejects.toThrow(/Privy user lookup failed: 500 boom/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a dropped connection", async () => {
    const fetchMock = stubFetch([
      { throws: new Error("fetch failed") },
      { body: JSON.stringify(embeddedWalletUser) },
    ]);

    await expect(
      fetchPrivyUser(config, PRIVY_USER_ID, { retryDelayMs: 0 }),
    ).resolves.toEqual(embeddedWalletUser);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a connection failure that never recovers", async () => {
    stubFetch([{ throws: new Error("fetch failed") }]);

    await expect(
      fetchPrivyUser(config, PRIVY_USER_ID, { maxRetries: 1, retryDelayMs: 0 }),
    ).rejects.toThrow(/fetch failed/);
  });

  it("names the endpoint when the body is not JSON", async () => {
    stubFetch([{ body: "<!doctype html><html></html>" }]);

    await expect(
      fetchPrivyUser(config, PRIVY_USER_ID, { retryDelayMs: 0 }),
    ).rejects.toThrow(/Privy returned invalid JSON/);
  });
});

describe("resolveAuthoritativeProfileIdentity", () => {
  it("reads the identity out of the fetched user", async () => {
    stubFetch([
      {
        body: JSON.stringify({
          linked_accounts: [
            ...embeddedWalletUser.linked_accounts,
            { type: "email", address: " Verified@Example.com ", verified_at: 1 },
          ],
        }),
      },
    ]);

    await expect(
      resolveAuthoritativeProfileIdentity(config, PRIVY_USER_ID),
    ).resolves.toEqual({
      walletAddress: "0xembedded",
      email: "verified@example.com",
    });
  });

  it("still refuses an account with no embedded wallet", async () => {
    stubFetch([{ body: JSON.stringify({ linked_accounts: [] }) }]);

    await expect(
      resolveAuthoritativeProfileIdentity(config, PRIVY_USER_ID),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "EMBEDDED_WALLET_REQUIRED" }),
    );
  });
});
