export type PlatformDirection = "onramp" | "offramp" | "merchant_payment";
export type PaymentMethod = "card" | "bank_transfer" | "mobile_money" | "cash" | "wallet";
export type RailHealth = "healthy" | "degraded" | "down";
export type TransactionStatus =
  | "created"
  | "authorized"
  | "held"
  | "processing"
  | "settled"
  | "failed"
  | "reversed";
export type RiskAction = "allow" | "review" | "reject" | "hold" | "freeze";
export type CustomerType = "consumer" | "merchant" | "partner";
export type RiskFlag =
  | "sanctions_match"
  | "pep_match"
  | "adverse_media"
  | "velocity_spike"
  | "device_mismatch"
  | "chargeback_history"
  | "blockchain_exposure"
  | "high_risk_country";

export interface PaymentRail {
  id: string;
  country: string;
  currency: string;
  direction: PlatformDirection;
  paymentMethod: PaymentMethod;
  provider: string;
  fixedFee: number;
  percentageFeeBps: number;
  successRateBps: number;
  settlementDelayMinutes: number;
  health: RailHealth;
  enabled: boolean;
}

export interface RoutedQuote {
  amount: number;
  country: string;
  currency: string;
  direction: PlatformDirection;
  paymentMethod: PaymentMethod;
  provider: string;
  railId: string;
  fixedFee: number;
  percentageFeeBps: number;
  totalFee: number;
  netAmount: number;
  settlementDelayMinutes: number;
  successRateBps: number;
}

export interface RiskDecisionInput {
  amount: number;
  country: string;
  currency: string;
  customerType: CustomerType;
  direction: PlatformDirection;
  paymentMethod: PaymentMethod;
  riskFlags: RiskFlag[];
}

export interface RiskDecision {
  action: RiskAction;
  caseRequired: boolean;
  reasonCode: string;
  score: number;
}

export interface LedgerEntry {
  account: string;
  credit: number;
  currency: string;
  debit: number;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  transactionId: string;
}

export interface PlatformTransaction {
  id: string;
  idempotencyKey: string;
  userId: string | null;
  merchantId: string | null;
  direction: PlatformDirection;
  status: TransactionStatus;
  country: string;
  fiatCurrency: string;
  cryptoAsset: string;
  grossAmount: number;
  feeAmount: number;
  cryptoAmount: number;
  paymentMethod: PaymentMethod;
  railId: string | null;
  provider: string | null;
  riskAction: RiskAction;
  riskReasonCode: string;
  providerOrderId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
