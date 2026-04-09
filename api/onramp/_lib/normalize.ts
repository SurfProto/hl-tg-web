import type { OnrampAppState } from "./types";

const PROVIDER_STATE_TO_APP_STATE: Record<string, OnrampAppState> = {
  PREORDER: "invoice_pending",
  PENDING: "payment_pending",
  PAYIN_PENDING: "payment_pending",
  PROCESSING: "processing",
  SUCCESS: "success",
  ERROR: "failed",
  FAILED: "failed",
  EXPIRED: "expired",
  CANCELLED: "failed",
};

export function normalizeOrderState(providerState: string | null | undefined): OnrampAppState {
  if (!providerState) {
    return "failed";
  }

  return PROVIDER_STATE_TO_APP_STATE[providerState.toUpperCase()] ?? "failed";
}
