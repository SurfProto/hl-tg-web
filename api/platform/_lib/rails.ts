import type { PaymentRail, PlatformDirection, PaymentMethod, RoutedQuote } from "./types";

interface RouteQuoteInput {
  amount: number;
  country: string;
  currency: string;
  direction: PlatformDirection;
  paymentMethod: PaymentMethod;
  rails: PaymentRail[];
}

// What a failed payment costs beyond the retry itself — abandoned checkouts,
// support load — as basis points of the transaction. Judgement call; tune
// against real conversion data.
const ABANDONMENT_COST_BPS = 100;
// What an hour of settlement delay is worth, same units.
const DELAY_BPS_PER_HOUR = 5;

export function calculateFee(amount: number, rail: PaymentRail): number {
  return Number((rail.fixedFee + (amount * rail.percentageFeeBps) / 10_000).toFixed(2));
}

/**
 * Score a rail in basis points of the transaction amount — lower is better.
 *
 * The previous version added a fee in corridor currency to a bps-derived
 * reliability penalty and a delay in hours. Those units are not comparable: in
 * KZT or IDR the fee term dwarfed everything and reliability was ignored,
 * while for small USD amounts reliability dominated and a rail charging ten
 * times the fee could still win.
 *
 * Everything is now basis points of the amount:
 *  - the fee, divided by the success rate, because a failed attempt has to be
 *    retried and you pay again — this is the expected fee per success;
 *  - the failure rate times what an abandoned payment costs;
 *  - the settlement delay.
 */
export function railScore(amount: number, rail: PaymentRail): number {
  const successRate = Math.min(Math.max(rail.successRateBps, 1), 10_000) / 10_000;
  const failureRate = 1 - successRate;

  const feeBps = amount > 0 ? (calculateFee(amount, rail) / amount) * 10_000 : 0;
  const expectedFeeBps = feeBps / successRate;
  const abandonmentBps = failureRate * ABANDONMENT_COST_BPS;
  const delayBps = (rail.settlementDelayMinutes / 60) * DELAY_BPS_PER_HOUR;

  return expectedFeeBps + abandonmentBps + delayBps;
}

function supportsAmount(rail: PaymentRail, amount: number): boolean {
  if (rail.minAmount != null && amount < rail.minAmount) return false;
  if (rail.maxAmount != null && amount > rail.maxAmount) return false;
  return true;
}

export function routeQuote(input: RouteQuoteInput): RoutedQuote | null {
  const eligible = input.rails
    .filter((rail) => rail.enabled)
    .filter((rail) => rail.health === "healthy")
    .filter((rail) => rail.country === input.country)
    .filter((rail) => rail.currency === input.currency)
    .filter((rail) => rail.direction === input.direction)
    .filter((rail) => rail.paymentMethod === input.paymentMethod)
    .filter((rail) => supportsAmount(rail, input.amount))
    // A rail whose fee meets or exceeds the amount leaves the customer with
    // nothing (or less than nothing) and must not be routed to.
    .filter((rail) => calculateFee(input.amount, rail) < input.amount)
    .map((rail) => ({ rail, score: railScore(input.amount, rail) }))
    .sort((left, right) => left.score - right.score);

  const selected = eligible[0]?.rail;
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
