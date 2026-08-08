import type {
  PlatformDirection,
  RiskFlag,
  UserRiskProfile,
  VelocitySnapshot,
} from "./types";

/**
 * Build the risk flags for a transaction from data the caller cannot set.
 *
 * The endpoints used to read `riskFlags` straight out of the request body, so
 * omitting the field produced a clean "allow" every time — sanctions and PEP
 * screening were opt-in by the party being screened. Everything here comes
 * from the stored screening record, the user's own transaction history, or
 * server configuration.
 */

// Velocity thresholds. Deliberately conservative; tune against real traffic.
export const VELOCITY_COUNT_THRESHOLD = 10;
export const VELOCITY_AMOUNT_THRESHOLD = 25_000;

// A screening result older than this no longer counts as current.
export const SCREENING_MAX_AGE_DAYS = 180;

export interface DeriveRiskFlagsInput {
  amount: number;
  country: string;
  direction: PlatformDirection;
  highRiskCountries: string[];
  profile: UserRiskProfile | null;
  velocity: VelocitySnapshot;
  now?: Date;
}

function isScreeningCurrent(screenedAt: string | null, now: Date): boolean {
  if (!screenedAt) {
    return false;
  }

  const screened = new Date(screenedAt).getTime();
  if (!Number.isFinite(screened)) {
    return false;
  }

  const ageDays = (now.getTime() - screened) / (24 * 60 * 60 * 1000);
  return ageDays >= 0 && ageDays <= SCREENING_MAX_AGE_DAYS;
}

export function deriveRiskFlags(input: DeriveRiskFlagsInput): RiskFlag[] {
  const now = input.now ?? new Date();
  const flags = new Set<RiskFlag>();

  if (!input.profile || !isScreeningCurrent(input.profile.screenedAt, now)) {
    flags.add("unscreened");
  }

  if (input.profile) {
    if (input.profile.sanctionsMatch) flags.add("sanctions_match");
    if (input.profile.pepMatch) flags.add("pep_match");
    if (input.profile.adverseMedia) flags.add("adverse_media");
    if (input.profile.chargebackHistory) flags.add("chargeback_history");
    if (input.profile.blockchainExposure) flags.add("blockchain_exposure");
  }

  const normalizedCountry = input.country.trim().toUpperCase();
  if (input.highRiskCountries.some((entry) => entry.trim().toUpperCase() === normalizedCountry)) {
    flags.add("high_risk_country");
  }

  // Count the transaction being priced, not just the ones already recorded.
  const projectedCount = input.velocity.transactionCount24h + 1;
  const projectedAmount = input.velocity.grossAmount24h + input.amount;
  if (
    projectedCount > VELOCITY_COUNT_THRESHOLD ||
    projectedAmount > VELOCITY_AMOUNT_THRESHOLD
  ) {
    flags.add("velocity_spike");
  }

  return [...flags];
}
