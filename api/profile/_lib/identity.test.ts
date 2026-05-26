import { describe, expect, it } from "vitest";

import { identityFromPrivyUser } from "./identity";

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
