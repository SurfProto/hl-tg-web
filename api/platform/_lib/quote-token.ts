import { createHmac, timingSafeEqual } from "node:crypto";

import { HttpError } from "../../onramp/_lib/http";
import type { PaymentMethod, PlatformDirection, RiskDecision } from "./types";

/**
 * A quote the server signed, so /api/transactions can trust the amounts.
 *
 * Transaction creation used to take `cryptoAmount` from the request body and
 * book it to the ledger unchecked: `{ amount: 1, cryptoAmount: 1000000 }`
 * recorded a million-unit crypto liability against a one-unit payin. The quote
 * endpoint now prices the corridor and signs the result; transaction creation
 * accepts only a valid, unexpired token and ignores any amounts in the body.
 */

export const QUOTE_TTL_SECONDS = 120;

export interface QuoteClaims {
  amount: number;
  country: string;
  cryptoAmount: number;
  cryptoAsset: string;
  direction: PlatformDirection;
  expiresAt: number;
  feeAmount: number;
  fiatCurrency: string;
  ownerId: string;
  paymentMethod: PaymentMethod;
  provider: string;
  railId: string;
  // Carried whole so the decision recorded against the transaction is the one
  // that was actually made at quote time, score and reason included.
  risk: RiskDecision;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function signQuoteToken(claims: QuoteClaims, secret: string): string {
  const payload = encode(claims);
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyQuoteToken(
  token: string,
  secret: string,
  options: { now?: number } = {},
): QuoteClaims {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) {
    throw new HttpError(400, "INVALID_QUOTE", "Quote token is malformed");
  }

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!constantTimeEqual(signature, sign(payload, secret))) {
    throw new HttpError(400, "INVALID_QUOTE", "Quote token signature is invalid");
  }

  let claims: QuoteClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as QuoteClaims;
  } catch {
    throw new HttpError(400, "INVALID_QUOTE", "Quote token payload is not valid JSON");
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (typeof claims.expiresAt !== "number" || claims.expiresAt <= now) {
    throw new HttpError(400, "QUOTE_EXPIRED", "Quote has expired; request a new one");
  }

  return claims;
}
