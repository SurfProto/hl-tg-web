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

export type OnrampKycStatus = "email_missing" | "verified_local" | "unknown";

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

export interface OnrampBootstrapData {
  allowed: boolean;
  state: OnrampAppState;
  kycStatus: OnrampKycStatus;
  email: string | null;
  walletAddress: string | null;
  activeOrder: OnrampOrderStatus | null;
  hasVerifiedEmailMatch: boolean;
  service: {
    serviceId: string;
    symbol: string;
    network: string;
  };
}

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: string;
  code?: string;
}

async function requestJson<T>(path: string, accessToken: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });

  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? "Onramp request failed");
  }

  return payload.data;
}

export async function bootstrapOnramp(
  accessToken: string,
  input: { email: string | null; walletAddress: string | null },
): Promise<OnrampBootstrapData> {
  return requestJson<OnrampBootstrapData>("/api/onramp/bootstrap", accessToken, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function fetchOnrampQuote(accessToken: string, amount: number): Promise<{ state: OnrampAppState; quote: OnrampQuote }> {
  return requestJson<{ state: OnrampAppState; quote: OnrampQuote }>("/api/onramp/quote", accessToken, {
    method: "POST",
    body: JSON.stringify({ amount }),
  });
}

export async function checkoutOnramp(accessToken: string, amount: number): Promise<{ state: OnrampAppState; order: OnrampOrderStatus }> {
  return requestJson<{ state: OnrampAppState; order: OnrampOrderStatus }>("/api/onramp/checkout", accessToken, {
    method: "POST",
    body: JSON.stringify({ amount }),
  });
}

export async function fetchOnrampStatus(
  accessToken: string,
  input?: { orderId?: string | null; externalOrderId?: string | null },
): Promise<{ state: OnrampAppState; order: OnrampOrderStatus }> {
  const params = new URLSearchParams();
  if (input?.orderId) {
    params.set("order_id", input.orderId);
  }
  if (input?.externalOrderId) {
    params.set("external_order_id", input.externalOrderId);
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  return requestJson<{ state: OnrampAppState; order: OnrampOrderStatus }>(`/api/onramp/status${suffix}`, accessToken, {
    method: "GET",
  });
}
