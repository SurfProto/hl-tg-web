import { normalizeOrderState } from "./normalize";
import type { OnrampAppState, OnrampKycStatus, OnrampLimits, OnrampOrderStatus } from "./types";

const KYC_VERIFIED_STATUSES = new Set(["approved", "complete", "completed", "success", "verified", "passed"]);

interface BuildBootstrapStateInput {
  email: string | null;
  walletAddress: string | null;
  hasVerifiedEmailMatch: boolean;
  storedKycId: string | null;
  storedKycStatus: string | null;
  activeOrder: OnrampOrderStatus | null;
  recentOrders: OnrampOrderStatus[];
  limits: OnrampLimits | null;
}

interface BootstrapState {
  allowed: boolean;
  state: OnrampAppState;
  kycStatus: OnrampKycStatus;
  isVerified: boolean;
  email: string | null;
  walletAddress: string | null;
  activeOrder: OnrampOrderStatus | null;
  recentOrders: OnrampOrderStatus[];
  limits: OnrampLimits | null;
}

function isTerminalOrder(order: OnrampOrderStatus | null): boolean {
  return order?.appState === "success" || order?.appState === "failed" || order?.appState === "expired";
}

export function hasStoredKycVerification(kycId: string | null | undefined, kycStatus: string | null | undefined): boolean {
  if (kycId?.trim()) {
    return true;
  }

  return kycStatus ? KYC_VERIFIED_STATUSES.has(kycStatus.trim().toLowerCase()) : false;
}

export function getBootstrapKycStatus(input: {
  email: string | null;
  hasVerifiedEmailMatch: boolean;
  storedKycId: string | null;
  storedKycStatus: string | null;
}): OnrampKycStatus {
  if (!input.email) {
    return "email_missing";
  }

  if (input.hasVerifiedEmailMatch) {
    return "verified_local";
  }

  if (hasStoredKycVerification(input.storedKycId, input.storedKycStatus)) {
    return "verified_kyc";
  }

  return "unknown";
}

export function buildBootstrapState(input: BuildBootstrapStateInput): BootstrapState {
  const recentOrders = input.recentOrders;

  if (!input.email) {
    return {
      allowed: false,
      state: "email_required",
      kycStatus: "email_missing",
      isVerified: false,
      email: null,
      walletAddress: input.walletAddress,
      activeOrder: null,
      recentOrders,
      limits: input.limits,
    };
  }

  const kycStatus = getBootstrapKycStatus(input);
  const activeOrder = isTerminalOrder(input.activeOrder) ? null : input.activeOrder;

  return {
    allowed: true,
    state: activeOrder ? normalizeOrderState(activeOrder.providerState) : "ready",
    kycStatus,
    isVerified: kycStatus === "verified_local" || kycStatus === "verified_kyc",
    email: input.email,
    walletAddress: input.walletAddress,
    activeOrder,
    recentOrders,
    limits: input.limits,
  };
}
