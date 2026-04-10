export type OnrampAppState =
  | "email_required"
  | "ready"
  | "quote_loading"
  | "quote_ready"
  | "checkout_pending"
  | "invoice_pending"
  | "payment_pending"
  | "processing"
  | "success"
  | "failed"
  | "expired";

export type OnrampKycStatus = "email_missing" | "verified_local" | "verified_kyc" | "unknown";

export interface OnrampOrderStatus {
  id: string;
  externalOrderId: string | null;
  serviceId?: string | null;
  providerState: string;
  appState: OnrampAppState;
  payinAmount: string | null;
  payinCurrency: string | null;
  payoutAmount: string | null;
  payoutCurrency: string | null;
  feeAmount?: string | null;
  invoiceUrl: string | null;
  invoiceUrlExpiresAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  lastSyncedAt: string | null;
}

export interface OnrampQuote {
  symbol: string;
  payinAmount: string;
  payinCurrency: string;
  payoutAmount: string;
  payoutCurrency: string;
}

export interface OnrampLimits {
  minAmount: number;
  maxAmount: number;
  currency: string;
}
