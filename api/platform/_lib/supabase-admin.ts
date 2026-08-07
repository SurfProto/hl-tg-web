import { randomUUID } from "node:crypto";

import { buildTransactionLedgerEntries } from "./ledger";
import type { PlatformConfig } from "./config";
import type {
  LedgerEntry,
  PaymentRail,
  PlatformTransaction,
  RiskDecision,
  RiskAction,
  TransactionStatus,
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
  riskReasonCode: string;
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
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, init);
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

async function getPlatformTransactionByIdempotencyKey(config: PlatformConfig, idempotencyKey: string) {
  const rows = await supabaseRequest<PlatformTransactionRow[]>(
    config,
    `platform_transactions?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=*`,
    { headers: buildHeaders(config) },
  );
  return rows[0] ? mapTransactionRow(rows[0]) : null;
}

async function insertLedgerEntries(config: PlatformConfig, entries: LedgerEntry[]) {
  if (entries.length === 0) {
    return;
  }

  await supabaseRequest<unknown[]>(
    config,
    "transaction_ledger_entries?on_conflict=idempotency_key&select=id",
    {
      body: JSON.stringify(
        entries.map((entry) => ({
          account: entry.account,
          credit: entry.credit,
          currency: entry.currency,
          debit: entry.debit,
          idempotency_key: entry.idempotencyKey,
          metadata: entry.metadata,
          transaction_id: entry.transactionId,
        })),
      ),
      headers: buildHeaders(config, {
        Prefer: "resolution=merge-duplicates,return=representation",
      }),
      method: "POST",
    },
  );
}

export async function upsertPlatformTransactionWithLedger(
  config: PlatformConfig,
  input: CreatePlatformTransactionInput,
) {
  const existing = await getPlatformTransactionByIdempotencyKey(config, input.idempotencyKey);
  if (existing) {
    return existing;
  }

  const transactionId = randomUUID();
  const now = new Date().toISOString();
  const rows = await supabaseRequest<PlatformTransactionRow[]>(
    config,
    "platform_transactions?select=*",
    {
      body: JSON.stringify({
        country: input.country,
        crypto_amount: input.cryptoAmount,
        crypto_asset: input.cryptoAsset,
        direction: input.direction,
        fee_amount: input.feeAmount,
        fiat_currency: input.fiatCurrency,
        gross_amount: input.grossAmount,
        id: transactionId,
        idempotency_key: input.idempotencyKey,
        merchant_id: input.merchantId ?? null,
        metadata: input.metadata ?? {},
        payment_method: input.paymentMethod,
        provider: input.provider ?? null,
        provider_order_id: input.providerOrderId ?? null,
        rail_id: input.railId ?? null,
        risk_action: input.riskAction,
        risk_reason_code: input.riskReasonCode,
        status: input.status,
        updated_at: now,
        user_id: input.userId ?? null,
      }),
      headers: buildHeaders(config, { Prefer: "return=representation" }),
      method: "POST",
    },
  );

  const transaction = mapTransactionRow(rows[0]);
  await insertLedgerEntries(
    config,
    buildTransactionLedgerEntries({
      cryptoAmount: input.cryptoAmount,
      cryptoAsset: input.cryptoAsset,
      direction: input.direction,
      feeAmount: input.feeAmount,
      fiatCurrency: input.fiatCurrency,
      grossAmount: input.grossAmount,
      status: input.status,
      transactionId: transaction.id,
    }),
  );

  return transaction;
}

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

export async function persistWebhookEvent(
  config: PlatformConfig,
  input: {
    eventType: string;
    merchantId: string | null;
    payload: Record<string, unknown>;
    signatureValid: boolean;
  },
) {
  const rows = await supabaseRequest<unknown[]>(
    config,
    "merchant_webhook_events?select=*",
    {
      body: JSON.stringify({
        event_type: input.eventType,
        merchant_id: input.merchantId,
        payload: input.payload,
        signature_valid: input.signatureValid,
        status: input.signatureValid ? "accepted" : "rejected",
      }),
      headers: buildHeaders(config, { Prefer: "return=representation" }),
      method: "POST",
    },
  );
  return rows[0] ?? null;
}
