import type { PaymentRail, PlatformDirection, PaymentMethod, RoutedQuote } from "./types";

interface RouteQuoteInput {
  amount: number;
  country: string;
  currency: string;
  direction: PlatformDirection;
  paymentMethod: PaymentMethod;
  rails: PaymentRail[];
}

function calculateFee(amount: number, rail: PaymentRail): number {
  return Number((rail.fixedFee + (amount * rail.percentageFeeBps) / 10_000).toFixed(2));
}

function railScore(amount: number, rail: PaymentRail): number {
  const fee = calculateFee(amount, rail);
  const failurePenalty = (10_000 - rail.successRateBps) / 10;
  const delayPenalty = rail.settlementDelayMinutes / 60;
  return fee + failurePenalty + delayPenalty;
}

export function routeQuote(input: RouteQuoteInput): RoutedQuote | null {
  const eligible = input.rails
    .filter((rail) => rail.enabled)
    .filter((rail) => rail.health === "healthy")
    .filter((rail) => rail.country === input.country)
    .filter((rail) => rail.currency === input.currency)
    .filter((rail) => rail.direction === input.direction)
    .filter((rail) => rail.paymentMethod === input.paymentMethod)
    .sort((a, b) => railScore(input.amount, a) - railScore(input.amount, b));

  const selected = eligible[0];
  if (!selected) {
    return null;
  }

  const totalFee = calculateFee(input.amount, selected);
  return {
    amount: input.amount,
    country: input.country,
    currency: input.currency,
    direction: input.direction,
    fixedFee: selected.fixedFee,
    netAmount: Number((input.amount - totalFee).toFixed(2)),
    paymentMethod: input.paymentMethod,
    percentageFeeBps: selected.percentageFeeBps,
    provider: selected.provider,
    railId: selected.id,
    settlementDelayMinutes: selected.settlementDelayMinutes,
    successRateBps: selected.successRateBps,
    totalFee,
  };
}
