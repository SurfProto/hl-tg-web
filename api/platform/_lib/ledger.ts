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

export function buildTransactionLedgerEntries(input: BuildLedgerInput): LedgerEntry[] {
  if (input.status === "failed" || input.status === "reversed") {
    return [
      entry({
        account: `memo:${input.status}_transaction`,
        credit: 0,
        currency: input.fiatCurrency,
        debit: 0,
        metadata: { direction: input.direction, status: input.status },
        transactionId: input.transactionId,
      }),
    ];
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
