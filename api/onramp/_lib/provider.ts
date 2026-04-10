import type { OnrampConfig } from "./config";
import { HttpError } from "./http";

interface ProviderEnvelope<T> {
  status_code: number;
  success: boolean;
  message: string;
  data: T | null;
  error_details: unknown;
  error_code: string | null;
}

function looksLikeHtml(body: string): boolean {
  const trimmed = body.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

export interface ProviderQuote {
  symbol: string;
  payin_breakdown: {
    amount: number | string;
    currency: string;
  };
  payout_breakdown: {
    amount: number | string;
    currency: string;
  };
}

export interface ProviderOrder {
  id: string;
  external_order_id: string | null;
  service_id: string | null;
  payout_amount: string | null;
  payin_amount: string | null;
  fee?: string | null;
  invoice_url: string | null;
  invoice_url_expires_at: string | null;
  created_at: string | null;
  touched_at: string | null;
  state: string;
}

function toSearchParams(params: Record<string, string | undefined>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) {
      searchParams.set(key, value);
    }
  }
  return searchParams;
}

async function providerRequest<T>(
  config: OnrampConfig,
  input: {
    method: "GET" | "POST";
    path: string;
    params?: Record<string, string | number | undefined>;
    body?: Record<string, string | number | undefined>;
  },
): Promise<T> {
  const url = new URL(`${config.baseUrl}${input.path}`);

  if (input.method === "GET" && input.params) {
    const searchParams = toSearchParams(
      Object.fromEntries(
        Object.entries(input.params).map(([key, value]) => [key, value == null ? undefined : String(value)]),
      ),
    );
    url.search = searchParams.toString();
  }

  const response = await fetch(url, {
    method: input.method,
    headers: {
      "Content-Type": "application/json",
      "X-Onramp-Proxy-Token": config.proxyToken,
    },
    body: input.method === "POST" ? JSON.stringify(input.body ?? {}) : undefined,
  });

  const rawBody = await response.text();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const diagnosticSuffix = ` (host: ${url.host}, status: ${response.status || 0}, content-type: ${contentType || "unknown"})`;

  if (contentType.includes("text/html") || looksLikeHtml(rawBody)) {
    throw new HttpError(
      response.status || 502,
      "PROVIDER_HTML_RESPONSE",
      `Onramp provider returned HTML for ${input.path}${diagnosticSuffix}`,
    );
  }

  let payload: ProviderEnvelope<T>;
  try {
    payload = JSON.parse(rawBody) as ProviderEnvelope<T>;
  } catch {
    throw new HttpError(
      response.status || 502,
      "PROVIDER_INVALID_JSON",
      `Onramp provider returned invalid JSON for ${input.path}${diagnosticSuffix}`,
    );
  }

  if (!response.ok || !payload.success || !payload.data) {
    throw new HttpError(
      response.status || payload.status_code || 502,
      payload.error_code ?? "PROVIDER_ERROR",
      payload.message || "Provider request failed",
      payload.error_details,
    );
  }

  return payload.data;
}

export async function precalcOnramp(config: OnrampConfig, amount: number): Promise<ProviderQuote> {
  return providerRequest<ProviderQuote>(config, {
    method: "POST",
    path: "/externals/cex/precalc",
    body: {
      amount,
      direction: "FORWARD",
      fee_strategy: "SERVICE",
      service_id: config.serviceId,
      symbol: config.providerSymbol,
    },
  });
}

export interface CreatePreorderInput {
  address: string;
  amount: number;
  externalOrderId: string;
  userEmail: string;
  userKycId?: string | null;
}

export async function createOnrampPreorder(
  config: OnrampConfig,
  input: CreatePreorderInput,
): Promise<ProviderOrder> {
  return providerRequest<ProviderOrder>(config, {
    method: "POST",
    path: "/externals/cex/order/preorder",
    body: {
      service_id: config.serviceId,
      address: input.address,
      network: config.network,
      user_kyc_id: input.userKycId ?? undefined,
      user_email: input.userEmail,
      amount: input.amount,
      fee_strategy: "SERVICE",
      symbol: config.providerSymbol,
      external_order_id: input.externalOrderId,
    },
  });
}

export async function confirmOnrampOrder(config: OnrampConfig, preorderId: string): Promise<ProviderOrder> {
  return providerRequest<ProviderOrder>(config, {
    method: "POST",
    path: "/externals/cex/order/create",
    body: {
      preorder_id: preorderId,
    },
  });
}

export async function getOnrampOrder(
  config: OnrampConfig,
  input: { orderId?: string | null; externalOrderId?: string | null },
): Promise<ProviderOrder> {
  return providerRequest<ProviderOrder>(config, {
    method: "GET",
    path: "/externals/cex/order/get",
    params: {
      order_id: input.orderId ?? undefined,
      external_order_id: input.externalOrderId ?? undefined,
    },
  });
}
