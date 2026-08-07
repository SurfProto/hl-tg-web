import { describe, expect, it } from "vitest";

import { buildTransactionLedgerEntries, sumLedgerEntries } from "./ledger";

describe("buildTransactionLedgerEntries", () => {
  it("creates a balanced canonical ledger for successful onramp money movement", () => {
    const entries = buildTransactionLedgerEntries({
      transactionId: "txn_1",
      direction: "onramp",
      grossAmount: 1000,
      feeAmount: 25,
      fiatCurrency: "RUB",
      cryptoAmount: 10,
      cryptoAsset: "USDT",
      status: "authorized",
    });

    expect(entries).toEqual([
      expect.objectContaining({ account: "fiat:payin", currency: "RUB", debit: 1000, credit: 0 }),
      expect.objectContaining({ account: "revenue:fees", currency: "RUB", debit: 0, credit: 25 }),
      expect.objectContaining({ account: "liability:user_crypto", currency: "USDT", debit: 0, credit: 10 }),
      expect.objectContaining({ account: "treasury:crypto_inventory", currency: "USDT", debit: 10, credit: 0 }),
      expect.objectContaining({ account: "clearing:fiat_to_crypto", currency: "RUB", debit: 0, credit: 975 }),
    ]);
    expect(sumLedgerEntries(entries, "RUB")).toBe(0);
    expect(sumLedgerEntries(entries, "USDT")).toBe(0);
  });

  it("marks failed transactions with reversal metadata and no value movement", () => {
    const entries = buildTransactionLedgerEntries({
      transactionId: "txn_2",
      direction: "offramp",
      grossAmount: 1000,
      feeAmount: 25,
      fiatCurrency: "KZT",
      cryptoAmount: 10,
      cryptoAsset: "USDT",
      status: "failed",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      account: "memo:failed_transaction",
      debit: 0,
      credit: 0,
      metadata: { direction: "offramp", status: "failed" },
    });
  });
});
