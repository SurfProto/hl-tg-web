import type { LedgerEntry, PlatformDirection, TransactionStatus } from "./types";

interface BuildLedgerInput {
  transactionId: string;
  direction: PlatformDirection;
  grossAmount: number;
  feeAmount: number;
  fiatCurrency: string;
  cryptoAmount: number;
  cryptoAsset: string;
  status: TransactionStatus;
}

function entry(input: Omit<LedgerEntry, "idempotencyKey">): LedgerEntry {
  return {
    ...input,
    idempotencyKey: `${input.transactionId}:${input.account}:${input.currency}`,
  };
}

export function sumLedgerEntries(entries: LedgerEntry[], currency: string): number {
  return Number(
    entries
      .filter((candidate) => candidate.currency === currency)
      .reduce((sum, candidate) => sum + candidate.debit - candidate.credit, 0)
      .toFixed(8),
  );
}

/**
 * Contra-entries that unwind a set of postings.
 *
 * Reversing means swapping debit and credit, not writing a memo. The previous
 * behaviour recorded a zero-value `memo:failed_transaction` row and left the
 * original postings in place, so a failed transaction still showed as money
 * moved.
 */
export function buildReversalEntries(entries: LedgerEntry[]): LedgerEntry[] {
  return entries.map((original) => ({
    account: original.account,
    credit: original.debit,
    currency: original.currency,
    debit: original.credit,
    idempotencyKey: `${original.idempotencyKey}:reversal`,
    metadata: { ...original.metadata, reversalOf: original.idempotencyKey },
    transactionId: original.transactionId,
  }));
}

export function buildTransactionLedgerEntries(input: BuildLedgerInput): LedgerEntry[] {
  if (input.status === "failed" || input.status === "reversed") {
    // A transaction that never succeeded has nothing to post. Reversals of an
    // already-booked transaction go through buildReversalEntries instead.
    return [];
  }

  const netFiat = Number((input.grossAmount - input.feeAmount).toFixed(2));
  if (input.direction === "offramp") {
    return [
      entry({
        account: "treasury:crypto_inventory",
        credit: input.cryptoAmount,
        currency: input.cryptoAsset,
        debit: 0,
        metadata: { direction: input.direction },
        transactionId: input.transactionId,
      }),
      entry({
        account: "liability:user_crypto",
        credit: 0,
        currency: input.cryptoAsset,
        debit: input.cryptoAmount,
        metadata: { direction: input.direction },
        transactionId: input.transactionId,
      }),
      entry({
        account: "fiat:payout",
        credit: netFiat,
        currency: input.fiatCurrency,
        debit: 0,
        metadata: { direction: input.direction },
        transactionId: input.transactionId,
      }),
      entry({
        account: "revenue:fees",
        credit: input.feeAmount,
        currency: input.fiatCurrency,
        debit: 0,
        metadata: { direction: input.direction },
        transactionId: input.transactionId,
      }),
      entry({
        account: "clearing:crypto_to_fiat",
        credit: 0,
        currency: input.fiatCurrency,
        debit: input.grossAmount,
        metadata: { direction: input.direction },
        transactionId: input.transactionId,
      }),
    ];
  }

  return [
    entry({
      account: "fiat:payin",
      credit: 0,
      currency: input.fiatCurrency,
      debit: input.grossAmount,
      metadata: { direction: input.direction },
      transactionId: input.transactionId,
    }),
    entry({
      account: "revenue:fees",
      credit: input.feeAmount,
      currency: input.fiatCurrency,
      debit: 0,
      metadata: { direction: input.direction },
      transactionId: input.transactionId,
    }),
    entry({
      account: "liability:user_crypto",
      credit: input.cryptoAmount,
      currency: input.cryptoAsset,
      debit: 0,
      metadata: { direction: input.direction },
      transactionId: input.transactionId,
    }),
    entry({
      account: "treasury:crypto_inventory",
      credit: 0,
      currency: input.cryptoAsset,
      debit: input.cryptoAmount,
      metadata: { direction: input.direction },
      transactionId: input.transactionId,
    }),
    entry({
      account: "clearing:fiat_to_crypto",
      credit: netFiat,
      currency: input.fiatCurrency,
      debit: 0,
      metadata: { direction: input.direction },
      transactionId: input.transactionId,
    }),
  ];
}
