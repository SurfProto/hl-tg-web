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
});
