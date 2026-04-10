import type { OnrampConfig } from "./config";
import { getSymbolCurrencies } from "./config";
import { HttpError } from "./http";
import type { OnrampLimits } from "./types";

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

interface ProviderOnrampLimit {
  symbol: string;
  min_amount: string | number | null;
  max_amount: string | number | null;
}

interface ProviderService {
  id: string;
  is_active?: boolean;
  limits?: ProviderOnrampLimit[];
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

function parseProviderLimitAmount(value: string | number | null | undefined): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function normalizeProviderLimit(config: OnrampConfig, service: ProviderService): OnrampLimits | null {
  if (service.id !== config.serviceId || service.is_active === false || !Array.isArray(service.limits)) {
    return null;
  }

  const limit = service.limits.find((candidate) => candidate.symbol === config.providerSymbol);
  if (!limit) {
    return null;
  }

  const minAmount = parseProviderLimitAmount(limit.min_amount);
  const maxAmount = parseProviderLimitAmount(limit.max_amount);
  if (minAmount == null || maxAmount == null || minAmount > maxAmount) {
    return null;
  }

  return {
    minAmount,
    maxAmount,
    currency: getSymbolCurrencies(config.appSymbol).payinCurrency,
  };
}

export async function getOnrampLimits(config: OnrampConfig): Promise<OnrampLimits> {
  const services = await providerRequest<ProviderService[]>(config, {
    method: "GET",
    path: "/externals/cex/services",
  });

  for (const service of services) {
    const limits = normalizeProviderLimit(config, service);
    if (limits) {
      return limits;
    }
  }

  throw new HttpError(503, "LIMITS_UNAVAILABLE", "Quote limits are unavailable. Try again later.");
}

export async function assertAmountWithinOnrampLimits(config: OnrampConfig, amount: number): Promise<OnrampLimits> {
  const limits = await getOnrampLimits(config);
  const rangeMessage = `Quote amount must be between ${limits.minAmount} and ${limits.maxAmount} ${limits.currency}.`;

  if (amount < limits.minAmount) {
    throw new HttpError(
      400,
      "AMOUNT_BELOW_MINIMUM",
      rangeMessage,
    );
  }

  if (amount > limits.maxAmount) {
    throw new HttpError(
      400,
      "AMOUNT_ABOVE_MAXIMUM",
      rangeMessage,
    );
  }

  return limits;
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
