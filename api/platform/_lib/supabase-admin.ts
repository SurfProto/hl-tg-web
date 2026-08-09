import { createHash } from "node:crypto";

import { fetchWithTimeout } from "../../_lib/fetch-with-timeout";
import { buildTransactionLedgerEntries } from "./ledger";
import type { PlatformConfig } from "./config";
import type {
  PaymentRail,
  PlatformTransaction,
  ReferenceRate,
  RiskDecision,
  RiskAction,
  TransactionStatus,
  UserRiskProfile,
  VelocitySnapshot,
} from "./types";

interface PlatformUserRow {
  id: string;
  privy_user_id: string | null;
  wallet_address: string | null;
}

interface PaymentRailRow {
  id: string;
  country: string;
  currency: string;
  direction: PaymentRail["direction"];
  payment_method: PaymentRail["paymentMethod"];
  provider: string;
  fixed_fee: string | number;
  percentage_fee_bps: number;
  success_rate_bps: number;
  settlement_delay_minutes: number;
  health: PaymentRail["health"];
  enabled: boolean;
  min_amount?: string | number | null;
  max_amount?: string | number | null;
}

interface PlatformTransactionRow {
  id: string;
  idempotency_key: string;
  user_id: string | null;
  merchant_id: string | null;
  direction: PlatformTransaction["direction"];
  status: TransactionStatus;
  country: string;
  fiat_currency: string;
  crypto_asset: string;
  gross_amount: string | number;
  fee_amount: string | number;
  crypto_amount: string | number;
  payment_method: PlatformTransaction["paymentMethod"];
  rail_id: string | null;
  provider: string | null;
  risk_action: RiskAction;
  risk_reason_code: string;
  provider_order_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface CreatePlatformTransactionInput {
  country: string;
  cryptoAmount: number;
  cryptoAsset: string;
  direction: PlatformTransaction["direction"];
  feeAmount: number;
  fiatCurrency: string;
  grossAmount: number;
  idempotencyKey: string;
  merchantId?: string | null;
  metadata?: Record<string, unknown>;
  paymentMethod: PlatformTransaction["paymentMethod"];
  provider?: string | null;
  providerOrderId?: string | null;
  railId?: string | null;
  riskAction: RiskAction;
  riskCaseRequired: boolean;
  riskReasonCode: string;
  riskScore: number;
  status: TransactionStatus;
  userId?: string | null;
}

function looksLikeHtml(body: string): boolean {
  const trimmed = body.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

function buildHeaders(config: PlatformConfig, extra?: Record<string, string>) {
  return {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function supabaseRequest<T>(config: PlatformConfig, path: string, init?: RequestInit): Promise<T> {
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

function mapRailRow(row: PaymentRailRow): PaymentRail {
  return {
    country: row.country,
    currency: row.currency,
    direction: row.direction,
    enabled: row.enabled,
    fixedFee: Number(row.fixed_fee ?? 0),
    health: row.health,
    id: row.id,
    maxAmount: row.max_amount == null ? null : Number(row.max_amount),
    minAmount: row.min_amount == null ? null : Number(row.min_amount),
    paymentMethod: row.payment_method,
    percentageFeeBps: row.percentage_fee_bps,
    provider: row.provider,
    settlementDelayMinutes: row.settlement_delay_minutes,
    successRateBps: row.success_rate_bps,
  };
}

function mapTransactionRow(row: PlatformTransactionRow): PlatformTransaction {
  return {
    country: row.country,
    createdAt: row.created_at,
    cryptoAmount: Number(row.crypto_amount ?? 0),
    cryptoAsset: row.crypto_asset,
    direction: row.direction,
    feeAmount: Number(row.fee_amount ?? 0),
    fiatCurrency: row.fiat_currency,
    grossAmount: Number(row.gross_amount ?? 0),
    id: row.id,
    idempotencyKey: row.idempotency_key,
    merchantId: row.merchant_id,
    metadata: row.metadata ?? {},
    paymentMethod: row.payment_method,
    provider: row.provider,
    providerOrderId: row.provider_order_id,
    railId: row.rail_id,
    riskAction: row.risk_action,
    riskReasonCode: row.risk_reason_code,
    status: row.status,
    updatedAt: row.updated_at,
    userId: row.user_id,
  };
}

export async function getUserRiskProfile(
  config: PlatformConfig,
  userId: string,
): Promise<UserRiskProfile | null> {
  const rows = await supabaseRequest<
    Array<{
      user_id: string;
      sanctions_match: boolean;
      pep_match: boolean;
      adverse_media: boolean;
      chargeback_history: boolean;
      blockchain_exposure: boolean;
      screened_at: string | null;
    }>
  >(
    config,
    `user_risk_profiles?user_id=eq.${encodeURIComponent(userId)}&select=*`,
    { headers: buildHeaders(config) },
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    adverseMedia: row.adverse_media,
    blockchainExposure: row.blockchain_exposure,
    chargebackHistory: row.chargeback_history,
    pepMatch: row.pep_match,
    sanctionsMatch: row.sanctions_match,
    screenedAt: row.screened_at,
    userId: row.user_id,
  };
}

/**
 * Rolling 24h totals for the user, used to derive the velocity_spike flag.
 * Only settled-ish states count — a rejected attempt should not inflate the
 * customer's own velocity, but a held one should.
 */
export async function getUserVelocity(
  config: PlatformConfig,
  userId: string,
): Promise<VelocitySnapshot> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await supabaseRequest<Array<{ gross_amount: string | number }>>(
    config,
    `platform_transactions?user_id=eq.${encodeURIComponent(userId)}` +
      `&created_at=gte.${encodeURIComponent(since)}` +
      `&status=in.(created,authorized,held,processing,settled)` +
      `&select=gross_amount`,
    { headers: buildHeaders(config) },
  );

  return {
    grossAmount24h: rows.reduce((sum, row) => sum + Number(row.gross_amount ?? 0), 0),
    transactionCount24h: rows.length,
  };
}

export async function getReferenceRate(
  config: PlatformConfig,
  fiatCurrency: string,
  cryptoAsset: string,
): Promise<ReferenceRate | null> {
  const rows = await supabaseRequest<
    Array<{ fiat_currency: string; crypto_asset: string; rate: string | number; observed_at: string }>
  >(
    config,
    `fx_reference_rates?fiat_currency=eq.${encodeURIComponent(fiatCurrency)}` +
      `&crypto_asset=eq.${encodeURIComponent(cryptoAsset)}&select=*`,
    { headers: buildHeaders(config) },
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    cryptoAsset: row.crypto_asset,
    fiatCurrency: row.fiat_currency,
    observedAt: row.observed_at,
    rate: Number(row.rate),
  };
}

/**
 * Resolve a merchant from its API key.
 *
 * merchantId used to be read from the request body, so any authenticated user
 * could attribute transactions and webhook events to any merchant. The key is
 * compared by SHA-256 hash, which is what merchant_api_keys stores.
 */
export async function getMerchantByApiKey(config: PlatformConfig, apiKey: string) {
  const keyHash = createHash("sha256").update(apiKey).digest("hex");
  const rows = await supabaseRequest<
    Array<{ merchant_id: string; status: string; merchants: { id: string; status: string } | null }>
  >(
    config,
    `merchant_api_keys?key_hash=eq.${encodeURIComponent(keyHash)}&status=eq.active` +
      `&select=merchant_id,status,merchants(id,status)`,
    { headers: buildHeaders(config) },
  );

  const row = rows[0];
  if (!row || row.merchants?.status !== "active") {
    return null;
  }

  return { id: row.merchant_id };
}

export async function getPlatformUserByPrivyUserId(config: PlatformConfig, privyUserId: string) {
  const rows = await supabaseRequest<PlatformUserRow[]>(
    config,
    `users?privy_user_id=eq.${encodeURIComponent(privyUserId)}&select=id,privy_user_id,wallet_address`,
    { headers: buildHeaders(config) },
  );
  return rows[0] ?? null;
}

export async function getPaymentRails(config: PlatformConfig): Promise<PaymentRail[]> {
  const rows = await supabaseRequest<PaymentRailRow[]>(
    config,
    "payment_rails?select=*&order=country.asc,currency.asc,provider.asc",
    { headers: buildHeaders(config) },
  );
  return rows.map(mapRailRow);
}

export async function getPlatformTransaction(config: PlatformConfig, transactionId: string) {
  const rows = await supabaseRequest<PlatformTransactionRow[]>(
    config,
    `platform_transactions?id=eq.${encodeURIComponent(transactionId)}&select=*`,
    { headers: buildHeaders(config) },
  );
  return rows[0] ? mapTransactionRow(rows[0]) : null;
}

/**
 * Create a transaction, its ledger entries, its risk decision and any risk case
 * in a single database transaction.
 *
 * This used to be three sequential PostgREST calls behind a read-then-insert
 * idempotency check. Concurrent requests with the same key both missed the
 * read and both inserted, and a failure between calls left a transaction with
 * no ledger or no recorded decision. The RPC does the conflict handling in
 * Postgres and returns the existing row when the key is already taken.
 */
export async function createPlatformTransaction(
  config: PlatformConfig,
  input: CreatePlatformTransactionInput,
): Promise<PlatformTransaction> {
  const ledgerEntries = buildTransactionLedgerEntries({
    cryptoAmount: input.cryptoAmount,
    cryptoAsset: input.cryptoAsset,
    direction: input.direction,
    feeAmount: input.feeAmount,
    fiatCurrency: input.fiatCurrency,
    grossAmount: input.grossAmount,
    status: input.status,
    // The database assigns the real id; entries are keyed off it inside the
    // function, so this placeholder is never persisted.
    transactionId: "pending",
  });

  const row = await supabaseRequest<PlatformTransactionRow>(
    config,
    "rpc/create_platform_transaction",
    {
      body: JSON.stringify({
        p_country: input.country,
        p_crypto_amount: input.cryptoAmount,
        p_crypto_asset: input.cryptoAsset,
        p_direction: input.direction,
        p_fee_amount: input.feeAmount,
        p_fiat_currency: input.fiatCurrency,
        p_gross_amount: input.grossAmount,
        p_idempotency_key: input.idempotencyKey,
        p_ledger_entries: ledgerEntries.map((entry) => ({
          account: entry.account,
          credit: entry.credit,
          currency: entry.currency,
          debit: entry.debit,
          metadata: entry.metadata,
        })),
        p_merchant_id: input.merchantId ?? null,
        p_metadata: input.metadata ?? {},
        p_payment_method: input.paymentMethod,
        p_provider: input.provider ?? null,
        p_provider_order_id: input.providerOrderId ?? null,
        p_rail_id: input.railId ?? null,
        p_risk_action: input.riskAction,
        p_risk_case_required: input.riskCaseRequired,
        p_risk_reason_code: input.riskReasonCode,
        p_risk_score: input.riskScore,
        p_status: input.status,
        p_user_id: input.userId ?? null,
      }),
      headers: buildHeaders(config, { Prefer: "return=representation" }),
      method: "POST",
    },
  );

  return mapTransactionRow(row);
}

/**
 * Book contra-entries for a transaction that failed or was reversed.
 *
 * Previously a failed transaction only got a zero-value memo row and its
 * original debits and credits stayed on the books.
 */
export async function reversePlatformTransaction(
  config: PlatformConfig,
  transactionId: string,
  status: Extract<TransactionStatus, "failed" | "reversed">,
) {
  await supabaseRequest<null>(config, "rpc/reverse_platform_transaction", {
    body: JSON.stringify({ p_status: status, p_transaction_id: transactionId }),
    headers: buildHeaders(config),
    method: "POST",
  });
}

/** Record a decision that is not attached to a transaction (dry-run scoring). */
export async function persistRiskDecision(
  config: PlatformConfig,
  transactionId: string | null,
  decision: RiskDecision,
) {
  const rows = await supabaseRequest<Array<{ id: string }>>(
    config,
    "risk_decisions?select=id",
    {
      body: JSON.stringify({
        action: decision.action,
        case_required: decision.caseRequired,
        reason_code: decision.reasonCode,
        score: decision.score,
        transaction_id: transactionId,
      }),
      headers: buildHeaders(config, { Prefer: "return=representation" }),
      method: "POST",
    },
  );

  if (decision.caseRequired) {
    await supabaseRequest<unknown[]>(
      config,
      "risk_cases?select=id",
      {
        body: JSON.stringify({
          decision_id: rows[0]?.id ?? null,
          priority: decision.action === "hold" || decision.action === "freeze" ? "high" : "normal",
          reason_code: decision.reasonCode,
          status: "open",
          transaction_id: transactionId,
        }),
        headers: buildHeaders(config, { Prefer: "return=representation" }),
        method: "POST",
      },
    );
  }

  return decision;
}

export async function listSettlements(config: PlatformConfig, merchantId: string | null, limit = 50) {
  const filters = [
    merchantId ? `merchant_id=eq.${encodeURIComponent(merchantId)}` : null,
    "select=*",
    "order=created_at.desc",
    `limit=${Math.max(1, Math.min(limit, 200))}`,
  ]
    .filter(Boolean)
    .join("&");

  return supabaseRequest<unknown[]>(config, `settlements?${filters}`, {
    headers: buildHeaders(config),
  });
}

/**
 * Insert a webhook event, ignoring replays.
 *
 * Returns null when event_id is already present, which the route treats as a
 * duplicate rather than an error.
 */
export async function persistWebhookEvent(
  config: PlatformConfig,
  input: {
    eventId: string;
    eventType: string;
    merchantId: string | null;
    payload: Record<string, unknown>;
    signatureValid: boolean;
  },
) {
  const rows = await supabaseRequest<unknown[]>(
    config,
    "merchant_webhook_events?on_conflict=event_id&select=*",
    {
      body: JSON.stringify({
        event_id: input.eventId,
        event_type: input.eventType,
        merchant_id: input.merchantId,
        payload: input.payload,
        signature_valid: input.signatureValid,
        status: input.signatureValid ? "accepted" : "rejected",
      }),
      headers: buildHeaders(config, {
        Prefer: "resolution=ignore-duplicates,return=representation",
      }),
      method: "POST",
    },
  );
  return rows[0] ?? null;
}
