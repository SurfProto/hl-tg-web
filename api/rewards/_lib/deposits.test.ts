import { describe, expect, it } from "vitest";
import { classifyLedgerUpdate, type RawLedgerUpdate } from "./deposits";

const WALLET = "0x0fBB6d45a796Bb32617EA066A86a79f6E3774204";
const OTHER = "0xD9Cc218BB6Ce07e59ab7E5349ea60ef77A1989D3";

function update(delta: RawLedgerUpdate["delta"], time = 1_775_035_007_165): RawLedgerUpdate {
  return { delta, hash: "0xbee4", time };
}

describe("ledger classification", () => {
  it("counts a bridge deposit, whoever paid for it", () => {
    const event = classifyLedgerUpdate(update({ type: "deposit", usdc: "15.0" }), WALLET);

    expect(event.isExternal).toBe(true);
    expect(event.amountUsd).toBe(15);
    expect(event.occurredAt).toBe("2026-04-01T09:16:47.165Z");
  });

  /**
   * The event that made this necessary. On the account this was built against,
   * eleven of seventeen ledger entries were the same fifteen dollars moving
   * between the spot and perp balances. Counting them would turn one deposit
   * into a dozen.
   */
  it("ignores money moving between an account's own balances", () => {
    const event = classifyLedgerUpdate(
      update({ toPerp: true, type: "accountClassTransfer", usdc: "15.0" }),
      WALLET,
    );

    expect(event.isExternal).toBe(false);
  });

  it("ignores a send with the same address on both ends", () => {
    const event = classifyLedgerUpdate(
      update({
        amount: "12.79",
        destination: WALLET.toLowerCase(),
        token: "USDC",
        type: "send",
        usdcValue: "12.79",
        user: WALLET.toLowerCase(),
      }),
      WALLET,
    );

    expect(event.isExternal).toBe(false);
  });

  /**
   * A trader who already holds funds on Hyperliquid arrives by transferring
   * them in, not by buying with a card. That is the whole point of reading the
   * ledger rather than our onramp table.
   */
  it("counts a transfer in from another account", () => {
    const event = classifyLedgerUpdate(
      update({
        destination: WALLET.toLowerCase(),
        token: "USDC",
        type: "send",
        usdcValue: "250",
        user: OTHER.toLowerCase(),
      }),
      WALLET,
    );

    expect(event.isExternal).toBe(true);
    expect(event.amountUsd).toBe(250);
  });

  it("counts a transfer out against the balance, fee included", () => {
    const event = classifyLedgerUpdate(
      update({
        destination: OTHER.toLowerCase(),
        fee: "1",
        token: "USDC",
        type: "send",
        usdcValue: "250",
        user: WALLET.toLowerCase(),
      }),
      WALLET,
    );

    expect(event.isExternal).toBe(true);
    expect(event.amountUsd).toBe(-251);
  });

  // Otherwise a full withdrawal leaves a small positive net behind and the
  // account still looks funded.
  it("takes the withdrawal fee out of the balance too", () => {
    const event = classifyLedgerUpdate(update({ fee: "1.0", type: "withdraw", usdc: "100" }), WALLET);

    expect(event.amountUsd).toBe(-101);
    expect(event.isExternal).toBe(true);
  });

  it("does not count a transfer of some other token as dollars arriving", () => {
    const event = classifyLedgerUpdate(
      update({
        amount: "40",
        destination: WALLET.toLowerCase(),
        token: "HYPE",
        type: "spotTransfer",
        usdcValue: "1600",
        user: OTHER.toLowerCase(),
      }),
      WALLET,
    );

    expect(event.isExternal).toBe(false);
  });

  /**
   * A type nobody has seen before must not be able to invent funding. The raw
   * type is stored either way, so re-deciding later is a query rather than a
   * re-fetch.
   */
  it("records an unrecognised event without treating it as funding", () => {
    const event = classifyLedgerUpdate(update({ type: "vaultDistribution", usdc: "9" }), WALLET);

    expect(event.eventType).toBe("vaultDistribution");
    expect(event.isExternal).toBe(false);
  });

  it("matches addresses whatever their case", () => {
    const event = classifyLedgerUpdate(
      update({
        destination: WALLET.toUpperCase(),
        token: "USDC",
        type: "internalTransfer",
        usdc: "60",
        user: OTHER.toUpperCase(),
      }),
      WALLET.toLowerCase(),
    );

    expect(event.isExternal).toBe(true);
    expect(event.amountUsd).toBe(60);
  });

  // Stable across re-reads, which is what makes replaying a window free.
  it("keys an event on hash, instant and type", () => {
    const event = classifyLedgerUpdate(update({ type: "deposit", usdc: "15.0" }), WALLET);

    expect(event.eventKey).toBe("0xbee4:1775035007165:deposit");
  });
});
