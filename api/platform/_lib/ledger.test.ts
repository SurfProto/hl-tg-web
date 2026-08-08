import { describe, expect, it } from "vitest";

import { buildReversalEntries, buildTransactionLedgerEntries, sumLedgerEntries } from "./ledger";

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

  it("posts nothing for a transaction that never succeeded", () => {
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

    expect(entries).toEqual([]);
  });
});

describe("buildReversalEntries", () => {
  it("unwinds a booked transaction so both currencies net back to zero", () => {
    const original = buildTransactionLedgerEntries({
      transactionId: "txn_3",
      direction: "offramp",
      grossAmount: 1000,
      feeAmount: 25,
      fiatCurrency: "KZT",
      cryptoAmount: 10,
      cryptoAsset: "USDT",
      status: "settled",
    });

    const reversal = buildReversalEntries(original);
    const combined = [...original, ...reversal];

    // Each contra-entry mirrors its original with debit and credit swapped.
    expect(reversal).toHaveLength(original.length);
    reversal.forEach((entry, index) => {
      expect(entry.account).toBe(original[index].account);
      expect(entry.currency).toBe(original[index].currency);
      expect(entry.debit).toBe(original[index].credit);
      expect(entry.credit).toBe(original[index].debit);
      expect(entry.idempotencyKey).toBe(`${original[index].idempotencyKey}:reversal`);
    });

    // The old behaviour wrote a zero-value memo row and left the originals
    // booked, so a failed transaction still showed money as moved.
    expect(sumLedgerEntries(combined, "KZT")).toBe(0);
    expect(sumLedgerEntries(combined, "USDT")).toBe(0);
    expect(
      combined.filter((entry) => entry.account === "treasury:crypto_inventory"),
    ).toHaveLength(2);
  });
});
