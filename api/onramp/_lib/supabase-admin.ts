import { fetchWithTimeout } from "../../_lib/fetch-with-timeout";
import { getSymbolCurrencies, type OnrampConfig } from "./config";
import { normalizeOrderState } from "./normalize";
import type { OnrampOrderStatus } from "./types";

interface SupabaseUserRow {
  id: string;
  wallet_address: string | null;
  privy_user_id: string | null;
  email: string | null;
  kyc_status: string | null;
  kyc_source: string | null;
  kyc_checked_at: string | null;
  kyc_id: string | null;
}

interface SupabaseOrderRow {
  provider_order_id: string;
  external_order_id: string | null;
  service_id: string | null;
  provider_state: string;
  app_state: string;
  payin_amount: string | null;
  payin_currency: string | null;
  payout_amount: string | null;
  payout_currency: string | null;
  fee_amount: string | null;
  invoice_url: string | null;
  invoice_url_expires_at: string | null;
  error_code: string | null;
  error_message: string | null;
  last_synced_at: string | null;
}

interface PersistOrderInput {
  userId: string;
  walletAddress: string;
  email: string;
  providerOrderId: string;
  externalOrderId: string | null;
  serviceId: string | null;
  providerState: string;
  payinAmount: string | null;
  payoutAmount: string | null;
  feeAmount: string | null;
  invoiceUrl: string | null;
  invoiceUrlExpiresAt: string | null;
  providerCreatedAt: string | null;
  providerTouchedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

interface UpdateOrderStatusInput {
  providerState: string;
  payinAmount: string | null;
  payoutAmount: string | null;
  feeAmount: string | null;
  invoiceUrl: string | null;
  invoiceUrlExpiresAt: string | null;
  providerTouchedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

function looksLikeHtml(body: string): boolean {
  const trimmed = body.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

function buildHeaders(config: OnrampConfig, extra?: Record<string, string>) {
  return {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function supabaseRequest<T>(config: OnrampConfig, path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithTimeout(`${config.supabaseUrl}/rest/v1/${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${body}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  const rawBody = await response.text();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("text/html") || looksLikeHtml(rawBody)) {
    throw new Error(`Supabase returned HTML for ${path}`);
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new Error(`Supabase returned invalid JSON for ${path}`);
  }
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) {
    return null;
  }

  return email.trim().toLowerCase();
}

export async function getUserByPrivyUserId(config: OnrampConfig, privyUserId: string): Promise<SupabaseUserRow | null> {
  const rows = await supabaseRequest<SupabaseUserRow[]>(
    config,
    `users?privy_user_id=eq.${encodeURIComponent(privyUserId)}&select=*`,
    {
      headers: buildHeaders(config),
    },
  );

  return rows[0] ?? null;
}

export async function hasVerifiedEmail(config: OnrampConfig, email: string | null): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return false;
  }

  const rows = await supabaseRequest<Array<{ normalized_email: string }>>(
    config,
    `verified_emails?normalized_email=eq.${encodeURIComponent(normalizedEmail)}&select=normalized_email&limit=1`,
    {
      headers: buildHeaders(config),
    },
  );

  return rows.length > 0;
}

export function mapOrderRow(row: SupabaseOrderRow): OnrampOrderStatus {
  return {
    id: row.provider_order_id,
    externalOrderId: row.external_order_id,
    serviceId: row.service_id,
    providerState: row.provider_state,
    appState: row.app_state as OnrampOrderStatus["appState"],
    payinAmount: row.payin_amount,
    payinCurrency: row.payin_currency,
    payoutAmount: row.payout_amount,
    payoutCurrency: row.payout_currency,
    feeAmount: row.fee_amount,
    invoiceUrl: row.invoice_url,
    invoiceUrlExpiresAt: row.invoice_url_expires_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    lastSyncedAt: row.last_synced_at,
  };
}

export async function getActiveOrder(config: OnrampConfig, userId: string): Promise<OnrampOrderStatus | null> {
  const rows = await supabaseRequest<SupabaseOrderRow[]>(
    config,
    `onramp_orders?user_id=eq.${userId}&app_state=not.in.(success,failed,expired)&select=provider_order_id,external_order_id,service_id,provider_state,app_state,payin_amount,payin_currency,payout_amount,payout_currency,fee_amount,invoice_url,invoice_url_expires_at,error_code,error_message,last_synced_at&order=created_at.desc&limit=1`,
    {
      headers: buildHeaders(config),
    },
  );

  return rows[0] ? mapOrderRow(rows[0]) : null;
}

export async function getRecentOrders(config: OnrampConfig, userId: string, limit = 5): Promise<OnrampOrderStatus[]> {
  const boundedLimit = Math.max(1, Math.min(20, Math.floor(limit)));
  const rows = await supabaseRequest<SupabaseOrderRow[]>(
    config,
    `onramp_orders?user_id=eq.${userId}&app_state=in.(success,failed,expired)&select=provider_order_id,external_order_id,service_id,provider_state,app_state,payin_amount,payin_currency,payout_amount,payout_currency,fee_amount,invoice_url,invoice_url_expires_at,error_code,error_message,last_synced_at&order=created_at.desc&limit=${boundedLimit}`,
    {
      headers: buildHeaders(config),
    },
  );

  return rows.map(mapOrderRow);
}

export async function getOwnedOrder(
  config: OnrampConfig,
  userId: string,
  input: { providerOrderId?: string | null; externalOrderId?: string | null },
): Promise<OnrampOrderStatus | null> {
  const identifiers = [
    input.providerOrderId
      ? `provider_order_id=eq.${encodeURIComponent(input.providerOrderId)}`
      : null,
    input.externalOrderId
      ? `external_order_id=eq.${encodeURIComponent(input.externalOrderId)}`
      : null,
  ].filter(Boolean).join("&");
  const rows = await supabaseRequest<SupabaseOrderRow[]>(
    config,
    `onramp_orders?user_id=eq.${encodeURIComponent(userId)}&${identifiers}&select=provider_order_id,external_order_id,service_id,provider_state,app_state,payin_amount,payin_currency,payout_amount,payout_currency,fee_amount,invoice_url,invoice_url_expires_at,error_code,error_message,last_synced_at&limit=1`,
    { headers: buildHeaders(config) },
  );

  return rows[0] ? mapOrderRow(rows[0]) : null;
}

export async function persistOrder(config: OnrampConfig, input: PersistOrderInput): Promise<OnrampOrderStatus> {
  const { payinCurrency, payoutCurrency } = getSymbolCurrencies(config.appSymbol);
  const rows = await supabaseRequest<SupabaseOrderRow[]>(
    config,
    "onramp_orders?select=provider_order_id,external_order_id,service_id,provider_state,app_state,payin_amount,payin_currency,payout_amount,payout_currency,fee_amount,invoice_url,invoice_url_expires_at,error_code,error_message,last_synced_at",
    {
      method: "POST",
      headers: buildHeaders(config, {
        Prefer: "return=representation",
      }),
      body: JSON.stringify({
        user_id: input.userId,
        provider_order_id: input.providerOrderId,
        external_order_id: input.externalOrderId,
        service_id: input.serviceId,
        provider_state: input.providerState,
        app_state: normalizeOrderState(input.providerState),
        payin_amount: input.payinAmount,
        payin_currency: payinCurrency,
        payout_amount: input.payoutAmount,
        payout_currency: payoutCurrency,
        fee_amount: input.feeAmount,
        wallet_address: input.walletAddress,
        email: normalizeEmail(input.email),
        invoice_url: input.invoiceUrl,
        invoice_url_expires_at: input.invoiceUrlExpiresAt,
        provider_created_at: input.providerCreatedAt,
        provider_touched_at: input.providerTouchedAt,
        last_synced_at: new Date().toISOString(),
        error_code: input.errorCode,
        error_message: input.errorMessage,
      }),
    },
  );

  return mapOrderRow(rows[0]);
}

export async function updateOwnedOrderStatus(
  config: OnrampConfig,
  userId: string,
  providerOrderId: string,
  input: UpdateOrderStatusInput,
): Promise<OnrampOrderStatus> {
  const { payinCurrency, payoutCurrency } = getSymbolCurrencies(config.appSymbol);
  const rows = await supabaseRequest<SupabaseOrderRow[]>(
    config,
    `onramp_orders?user_id=eq.${encodeURIComponent(userId)}&provider_order_id=eq.${encodeURIComponent(providerOrderId)}&select=provider_order_id,external_order_id,service_id,provider_state,app_state,payin_amount,payin_currency,payout_amount,payout_currency,fee_amount,invoice_url,invoice_url_expires_at,error_code,error_message,last_synced_at`,
    {
      method: "PATCH",
      headers: buildHeaders(config, { Prefer: "return=representation" }),
      body: JSON.stringify({
        provider_state: input.providerState,
        app_state: normalizeOrderState(input.providerState),
        payin_amount: input.payinAmount,
        payin_currency: payinCurrency,
        payout_amount: input.payoutAmount,
        payout_currency: payoutCurrency,
        fee_amount: input.feeAmount,
        invoice_url: input.invoiceUrl,
        invoice_url_expires_at: input.invoiceUrlExpiresAt,
        provider_touched_at: input.providerTouchedAt,
        last_synced_at: new Date().toISOString(),
        error_code: input.errorCode,
        error_message: input.errorMessage,
      }),
    },
  );
  return mapOrderRow(rows[0]);
}
