import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawLedgerUpdate } from "./deposits";

const supabaseAdmin = vi.hoisted(() => ({
  completeDepositSync: vi.fn(),
  openDepositSync: vi.fn(),
  upsertDepositEvents: vi.fn(),
}));

vi.mock("./supabase-admin", () => supabaseAdmin);

import { syncAccountDeposits } from "./deposits";

const ACCOUNT = {
  userId: "user-1",
  walletAddress: "0x0fBB6d45a796Bb32617EA066A86a79f6E3774204",
};

const NOW = Date.parse("2026-08-26T00:00:00.000Z");

function config() {
  return {} as never;
}

function deposit(timeMs: number, usdc: string): RawLedgerUpdate {
  return { delta: { type: "deposit", usdc }, hash: `0x${timeMs}`, time: timeMs };
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseAdmin.openDepositSync.mockResolvedValue(new Date(0).toISOString());
  supabaseAdmin.completeDepositSync.mockResolvedValue(undefined);
  supabaseAdmin.upsertDepositEvents.mockResolvedValue(undefined);
});

describe("deposit ledger sync", () => {
  /**
   * A new checkpoint starts at the epoch, so the first run reads the account's
   * whole history rather than only what happened after the code shipped.
   */
  it("reads from the account's whole history on a first run", async () => {
    const fetchLedgerUpdates = vi.fn().mockResolvedValue([]);

    await syncAccountDeposits(config(), ACCOUNT, {
      fetchLedgerUpdates,
      now: () => NOW,
    });

    expect(fetchLedgerUpdates).toHaveBeenCalledWith(ACCOUNT.walletAddress, {
      endMs: NOW,
      startMs: 0,
    });
  });

  it("stores what the ledger said, classified", async () => {
    const fetchLedgerUpdates = vi
      .fn()
      .mockResolvedValue([
        deposit(1_775_035_007_165, "15.0"),
        { delta: { toPerp: true, type: "accountClassTransfer", usdc: "15.0" }, hash: "0xshuffle", time: 1_775_035_033_413 },
      ] satisfies RawLedgerUpdate[]);

    const result = await syncAccountDeposits(config(), ACCOUNT, {
      fetchLedgerUpdates,
      now: () => NOW,
    });

    expect(result.eventsIngested).toBe(2);
    // Both rows are kept; only one of them is money arriving.
    expect(result.externalEvents).toBe(1);

    const [, rows] = supabaseAdmin.upsertDepositEvents.mock.calls[0]!;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ amountUsd: 15, isExternal: true, userId: "user-1" });
    expect(rows[1]).toMatchObject({ isExternal: false });
  });

  /**
   * Writes first, cursor second. A crash between the two costs a re-read, and
   * the re-read is free because every row upserts onto its own event key.
   */
  it("advances the cursor to the window end, and only after the write", async () => {
    const order: string[] = [];
    supabaseAdmin.upsertDepositEvents.mockImplementation(async () => {
      order.push("write");
    });
    supabaseAdmin.completeDepositSync.mockImplementation(async () => {
      order.push("cursor");
    });

    await syncAccountDeposits(config(), ACCOUNT, {
      fetchLedgerUpdates: async () => [deposit(1_775_035_007_165, "15.0")],
      now: () => NOW,
    });

    expect(order).toEqual(["write", "cursor"]);
    expect(supabaseAdmin.completeDepositSync).toHaveBeenCalledWith(
      config(),
      expect.objectContaining({ cursorTime: new Date(NOW).toISOString(), eventsIngested: 1 }),
    );
  });

  it("leaves the cursor where it was when the exchange is unreachable", async () => {
    const result = await syncAccountDeposits(config(), ACCOUNT, {
      fetchLedgerUpdates: async () => {
        throw new Error("upstream 503: rate limited by cloudflare");
      },
      now: () => NOW,
    });

    expect(result.errorCode).toBe("EXCHANGE_UNAVAILABLE");
    expect(supabaseAdmin.upsertDepositEvents).not.toHaveBeenCalled();

    const [, input] = supabaseAdmin.completeDepositSync.mock.calls[0]!;
    expect(input.cursorTime).toBeUndefined();
    // The upstream message reaches a reconciliation surface, so only the class
    // of failure is recorded, never the body.
    expect(JSON.stringify(input)).not.toContain("cloudflare");
  });

  it("does not advance the cursor when the write fails", async () => {
    supabaseAdmin.upsertDepositEvents.mockRejectedValue(new Error("nope"));

    const result = await syncAccountDeposits(config(), ACCOUNT, {
      fetchLedgerUpdates: async () => [deposit(1_775_035_007_165, "15.0")],
      now: () => NOW,
    });

    expect(result.errorCode).toBe("LEDGER_WRITE_FAILED");
    const [, input] = supabaseAdmin.completeDepositSync.mock.calls[0]!;
    expect(input.cursorTime).toBeUndefined();
  });
});
