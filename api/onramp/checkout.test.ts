import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrivySession: vi.fn(),
  createAndPersistOrder: vi.fn(),
  getOnrampConfig: vi.fn(),
  assertAmountWithinOnrampLimits: vi.fn(),
  getUserByPrivyUserId: vi.fn(),
}));

vi.mock("./_lib/auth", () => ({ requirePrivySession: mocks.requirePrivySession }));
vi.mock("./_lib/checkout", () => ({ createAndPersistOrder: mocks.createAndPersistOrder }));
vi.mock("./_lib/config", () => ({ getOnrampConfig: mocks.getOnrampConfig }));
vi.mock("./_lib/provider", () => ({ assertAmountWithinOnrampLimits: mocks.assertAmountWithinOnrampLimits }));
vi.mock("./_lib/supabase-admin", () => ({ getUserByPrivyUserId: mocks.getUserByPrivyUserId }));

import handler from "./checkout";

function createResponse() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

describe("POST /api/onramp/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOnrampConfig.mockReturnValue({ privyAppId: "app-id", network: "TRC20" });
    mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:user:1" });
    mocks.getUserByPrivyUserId.mockResolvedValue({
      id: "user-1",
      email: "canonical@example.com",
      wallet_address: "0xcanonical",
      kyc_id: null,
    });
    mocks.createAndPersistOrder.mockResolvedValue({ appState: "payment_pending" });
  });

  it("sends a valid external TRC20 payout only to the new order", async () => {
    const response = createResponse();
    const payoutAddress = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";

    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: { amount: 1000, idempotencyKey: "key-1", payoutAddress },
      },
      response,
    );

    expect(mocks.createAndPersistOrder).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "key-1", payoutAddress }),
    );
  });

  // Without a key a retry starts a second real payment order, so the request is
  // refused rather than defaulted.
  it("refuses a checkout with no idempotency key", async () => {
    const response = createResponse();

    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: { amount: 1000, payoutAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE" },
      },
      response,
    );

    expect(mocks.createAndPersistOrder).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "IDEMPOTENCY_KEY_REQUIRED" }),
    );
  });

  it("rejects an invalid TRC20 payout before creating an order", async () => {
    const response = createResponse();

    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: {
          amount: 1000,
          idempotencyKey: "key-1",
          payoutAddress: "TNotAValidTronAddress",
        },
      },
      response,
    );

    expect(mocks.createAndPersistOrder).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INVALID_PAYOUT_ADDRESS" }),
    );
  });

  // Off TRC20 the provider settles to an EVM address, and the only one we will
  // pay is the wallet already on the account. These three cover the whole rule,
  // because the previous one — a non-empty string — accepted all of them.
  describe("on a network that settles to an EVM address", () => {
    const wallet = "0x1111111111111111111111111111111111111111";

    beforeEach(() => {
      mocks.getOnrampConfig.mockReturnValue({ privyAppId: "app-id", network: "ARBITRUM" });
      mocks.getUserByPrivyUserId.mockResolvedValue({
        id: "user-1",
        email: "canonical@example.com",
        wallet_address: wallet,
        kyc_id: null,
      });
    });

    async function checkout(payoutAddress: string) {
      const response = createResponse();
      await handler(
        {
          method: "POST",
          headers: { authorization: "Bearer token" },
          body: { amount: 1000, idempotencyKey: "key-1", payoutAddress },
        },
        response,
      );
      return response;
    }

    it("pays out to the wallet on the account, whatever case it is written in", async () => {
      await checkout(wallet.toUpperCase().replace("0X", "0x"));

      expect(mocks.createAndPersistOrder).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: "key-1" }),
      );
    });

    it("refuses a well-formed address belonging to somebody else", async () => {
      const response = await checkout("0x2222222222222222222222222222222222222222");

      expect(mocks.createAndPersistOrder).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "PAYOUT_ADDRESS_MISMATCH" }),
      );
    });

    it("refuses a malformed address, which the old length check accepted", async () => {
      const response = await checkout("not-an-address");

      expect(mocks.createAndPersistOrder).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "INVALID_PAYOUT_ADDRESS" }),
      );
    });
  });
});
