import { HttpError } from "../../onramp/_lib/http";
import type { CustomerType, PaymentMethod, PlatformDirection, RiskFlag } from "./types";

const DIRECTIONS = new Set<PlatformDirection>(["onramp", "offramp", "merchant_payment"]);
const PAYMENT_METHODS = new Set<PaymentMethod>(["card", "bank_transfer", "mobile_money", "cash", "wallet"]);
const CUSTOMER_TYPES = new Set<CustomerType>(["consumer", "merchant", "partner"]);
const RISK_FLAGS = new Set<RiskFlag>([
  "sanctions_match",
  "pep_match",
  "adverse_media",
  "velocity_spike",
  "device_mismatch",
  "chargeback_history",
  "blockchain_exposure",
  "high_risk_country",
]);

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "BAD_REQUEST", `${field} is required`);
  }
  return value.trim();
}

export function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function requirePositiveNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, "BAD_REQUEST", `${field} must be a positive number`);
  }
  return parsed;
}

export function requireDirection(value: unknown): PlatformDirection {
  const direction = requireString(value, "direction") as PlatformDirection;
  if (!DIRECTIONS.has(direction)) {
    throw new HttpError(400, "BAD_REQUEST", "direction is not supported");
  }
  return direction;
}

export function requirePaymentMethod(value: unknown): PaymentMethod {
  const paymentMethod = requireString(value, "paymentMethod") as PaymentMethod;
  if (!PAYMENT_METHODS.has(paymentMethod)) {
    throw new HttpError(400, "BAD_REQUEST", "paymentMethod is not supported");
  }
  return paymentMethod;
}

export function parseCustomerType(value: unknown): CustomerType {
  if (value == null) {
    return "consumer";
  }

  const customerType = requireString(value, "customerType") as CustomerType;
  if (!CUSTOMER_TYPES.has(customerType)) {
    throw new HttpError(400, "BAD_REQUEST", "customerType is not supported");
  }
  return customerType;
}

export function parseRiskFlags(value: unknown): RiskFlag[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, "BAD_REQUEST", "riskFlags must be an array");
  }

  return value.map((flag) => {
    const parsed = requireString(flag, "riskFlags") as RiskFlag;
    if (!RISK_FLAGS.has(parsed)) {
      throw new HttpError(400, "BAD_REQUEST", `Unsupported risk flag: ${parsed}`);
    }
    return parsed;
  });
}
