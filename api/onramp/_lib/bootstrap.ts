import { normalizeOrderState } from "./normalize";
import type { OnrampAppState, OnrampKycStatus, OnrampOrderStatus } from "./types";

interface BuildBootstrapStateInput {
  email: string | null;
  walletAddress: string | null;
  hasVerifiedEmailMatch: boolean;
  activeOrder: OnrampOrderStatus | null;
}

interface BootstrapState {
  allowed: boolean;
  state: OnrampAppState;
  kycStatus: OnrampKycStatus;
  email: string | null;
  walletAddress: string | null;
  activeOrder: OnrampOrderStatus | null;
}

export function buildBootstrapState(input: BuildBootstrapStateInput): BootstrapState {
  if (!input.email) {
    return {
      allowed: false,
      state: "email_required",
      kycStatus: "email_missing",
      email: null,
      walletAddress: input.walletAddress,
      activeOrder: input.activeOrder,
    };
  }

  const kycStatus: OnrampKycStatus = input.hasVerifiedEmailMatch
    ? "verified_local"
    : "unknown";

  return {
    allowed: true,
    state: input.activeOrder ? normalizeOrderState(input.activeOrder.providerState) : "ready",
    kycStatus,
    email: input.email,
    walletAddress: input.walletAddress,
    activeOrder: input.activeOrder,
  };
}
