import { describe, expect, it } from "vitest";
import { buildBootstrapState } from "./bootstrap";
import type { OnrampOrderStatus } from "./types";

describe("buildBootstrapState", () => {
  it("blocks users without a linked email", () => {
    const result = buildBootstrapState({
      email: null,
      walletAddress: "0xabc",
      hasVerifiedEmailMatch: false,
      storedKycId: null,
      storedKycStatus: null,
      activeOrder: null,
      recentOrders: [],
      limits: null,
    });

    expect(result.state).toBe("email_required");
    expect(result.allowed).toBe(false);
    expect(result.kycStatus).toBe("email_missing");
  });

  it("marks locally verified emails and allows onramp", () => {
    const result = buildBootstrapState({
      email: "verified@example.com",
      walletAddress: "0xabc",
      hasVerifiedEmailMatch: true,
      storedKycId: null,
      storedKycStatus: null,
      activeOrder: null,
      recentOrders: [],
      limits: {
        minAmount: 600,
        maxAmount: 50000,
        currency: "RUB",
      },
    });

    expect(result.state).toBe("ready");
    expect(result.allowed).toBe(true);
    expect(result.kycStatus).toBe("verified_local");
    expect(result.limits).toEqual({
      minAmount: 600,
      maxAmount: 50000,
      currency: "RUB",
    });
  });

  it("allows unknown emails in v1 but keeps the KYC harness state", () => {
    const activeOrder: OnrampOrderStatus = {
      id: "ord_123",
      externalOrderId: "ext_123",
      providerState: "PENDING",
      appState: "payment_pending",
      payinAmount: "5000.00",
      payinCurrency: "RUB",
      payoutAmount: "50.10",
      payoutCurrency: "USDC",
      invoiceUrl: "https://invoice.example/pay",
      invoiceUrlExpiresAt: "2026-04-08T12:00:00.000Z",
      errorCode: null,
      errorMessage: null,
      lastSyncedAt: "2026-04-08T10:00:00.000Z",
    };

    const result = buildBootstrapState({
      email: "pending@example.com",
      walletAddress: "0xabc",
      hasVerifiedEmailMatch: false,
      storedKycId: null,
      storedKycStatus: null,
      activeOrder,
      recentOrders: [],
      limits: null,
    });

    expect(result.state).toBe("payment_pending");
    expect(result.allowed).toBe(true);
    expect(result.kycStatus).toBe("unknown");
    expect(result.activeOrder?.id).toBe("ord_123");
  });

  it("keeps terminal orders in recent history without blocking new quotes", () => {
    const terminalOrder: OnrampOrderStatus = {
      id: "ord_done",
      externalOrderId: "ext_done",
      providerState: "SUCCESS",
      appState: "success",
      payinAmount: "5000.00",
      payinCurrency: "RUB",
      payoutAmount: "50.10",
      payoutCurrency: "USDC",
      invoiceUrl: "https://invoice.example/pay",
      invoiceUrlExpiresAt: "2026-04-08T12:00:00.000Z",
      errorCode: null,
      errorMessage: null,
      lastSyncedAt: "2026-04-08T10:00:00.000Z",
    };

    const result = buildBootstrapState({
      email: "verified@example.com",
      walletAddress: "0xabc",
      hasVerifiedEmailMatch: true,
      storedKycId: null,
      storedKycStatus: null,
      activeOrder: terminalOrder,
      recentOrders: [terminalOrder],
      limits: null,
    });

    expect(result.state).toBe("ready");
    expect(result.activeOrder).toBeNull();
    expect(result.recentOrders).toEqual([terminalOrder]);
  });

  it("marks stored KYC users as verified", () => {
    const result = buildBootstrapState({
      email: "kyc@example.com",
      walletAddress: "0xabc",
      hasVerifiedEmailMatch: false,
      storedKycId: "kyc_123",
      storedKycStatus: "approved",
      activeOrder: null,
      recentOrders: [],
      limits: null,
    });

    expect(result.kycStatus).toBe("verified_kyc");
    expect(result.isVerified).toBe(true);
  });
});
