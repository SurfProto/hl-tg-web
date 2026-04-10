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

export interface OnrampQuoteRequest {
  amount: number;
  walletAddress: string | null;
}

export interface OnrampBootstrapData {
  allowed: boolean;
  state: OnrampAppState;
  kycStatus: OnrampKycStatus;
  isVerified: boolean;
  email: string | null;
  walletAddress: string | null;
  activeOrder: OnrampOrderStatus | null;
  recentOrders: OnrampOrderStatus[];
  limits: OnrampLimits | null;
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

export function isTerminalOnrampState(state: OnrampAppState) {
  return state === "success" || state === "failed" || state === "expired";
}

export function getActiveOnrampOrder(order: OnrampOrderStatus | null): OnrampOrderStatus | null {
  return order && !isTerminalOnrampState(order.appState) ? order : null;
}

export function mergeRecentOnrampOrders(
  orders: OnrampOrderStatus[],
  order: OnrampOrderStatus | null,
  limit = 5,
): OnrampOrderStatus[] {
  if (!order || !isTerminalOnrampState(order.appState)) {
    return orders;
  }

  return [order, ...orders.filter((candidate) => candidate.id !== order.id)].slice(0, limit);
}

export function isOnrampUserVerified(status: OnrampKycStatus) {
  return status === "verified_local" || status === "verified_kyc";
}

export type OnrampAmountValidation =
  | { ok: true; amount: number }
  | { ok: false; code: "limits_unavailable" | "invalid_amount" | "below_minimum" | "above_maximum" };

export function validateOnrampAmount(amountInput: string | number, limits: OnrampLimits | null): OnrampAmountValidation {
  if (!limits) {
    return { ok: false, code: "limits_unavailable" };
  }

  const amount = typeof amountInput === "number" ? amountInput : Number(amountInput);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, code: "invalid_amount" };
  }

  if (amount < limits.minAmount) {
    return { ok: false, code: "below_minimum" };
  }

  if (amount > limits.maxAmount) {
    return { ok: false, code: "above_maximum" };
  }

  return { ok: true, amount };
}

export function isOnrampQuoteCurrent(
  quoteRequest: OnrampQuoteRequest | null,
  amount: number,
  walletAddress: string | null,
) {
  return Boolean(
    quoteRequest &&
      quoteRequest.amount === amount &&
      quoteRequest.walletAddress === walletAddress,
  );
}

function looksLikeHtml(body: string): boolean {
  const trimmed = body.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
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

  const rawBody = await response.text();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("text/html") || looksLikeHtml(rawBody)) {
    throw new Error(`Onramp API ${path} returned HTML instead of JSON`);
  }

  let payload: Envelope<T>;
  try {
    payload = JSON.parse(rawBody) as Envelope<T>;
  } catch {
    throw new Error(`Onramp API ${path} returned an invalid JSON response`);
  }

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
