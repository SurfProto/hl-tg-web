import type { RewardsConfig } from "./config";
import {
  completeDepositSync,
  openDepositSync,
  upsertDepositEvents,
  type DepositEventInsert,
} from "./supabase-admin";

/**
 * Funding, read from the Hyperliquid account rather than from our onramp.
 *
 * `onramp_orders` records one thing: a card purchase we brokered. Every funding
 * rule in the program was written against it, so a user who bridged their own
 * USDC in — the most likely way for a trader who already uses Hyperliquid to
 * arrive — had funded nothing as far as the program was concerned.
 *
 * `userNonFundingLedgerUpdates` is the account's own record of money moving in
 * and out, and it is a superset: an onramp purchase lands on it as a `deposit`
 * like any other bridge transfer. Reading it does not lose the onramp path, it
 * subsumes it.
 */

export type LedgerDelta = {
  amount?: string | number | null;
  destination?: string | null;
  fee?: string | number | null;
  token?: string | null;
  toPerp?: boolean | null;
  type?: string | null;
  usdc?: string | number | null;
  usdcValue?: string | number | null;
  user?: string | null;
};

export interface RawLedgerUpdate {
  delta: LedgerDelta;
  hash: string;
  time: number;
}

export interface ClassifiedLedgerEvent {
  /**
   * Signed, and meaningful only when `isExternal`: positive for money arriving,
   * negative for money leaving. Internal events carry the magnitude so the row
   * reads sensibly, and nothing ever sums them.
   */
  amountUsd: number;
  eventKey: string;
  eventType: string;
  isExternal: boolean;
  occurredAt: string;
}

/**
 * Types that describe one account sending USDC to another.
 *
 * `send` is what the live API emits; the other two are the names Hyperliquid's
 * documentation uses for the same shape. All three are handled because the
 * classification must not silently start returning false if the exchange
 * renames the field, which would quietly un-fund everybody who arrived that
 * way.
 */
const TRANSFER_TYPES = new Set(["internalTransfer", "send", "spotTransfer"]);

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The dollar magnitude of a ledger delta.
 *
 * `usdcValue` first because a spot transfer carries both the token amount and
 * its dollar valuation, and the dollars are what funding is measured in.
 */
function magnitudeOf(delta: LedgerDelta): number {
  for (const candidate of [delta.usdcValue, delta.usdc, delta.amount]) {
    const parsed = Math.abs(toNumber(candidate));
    if (parsed > 0) {
      return parsed;
    }
  }

  return 0;
}

function sameAddress(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  return left.toLowerCase() === right.toLowerCase();
}

/**
 * One ledger event, and whether it moved money across the account boundary.
 *
 * The distinction is the whole point. Hyperliquid reports internal reshuffling
 * on the same feed as real funding — spot/perp transfers, vault movements,
 * sub-account transfers, and self-sends where one address is on both ends. On
 * the account this was built against, eleven of seventeen events were the same
 * fifteen dollars moving between spot and perp; counting those would turn one
 * deposit into a dozen.
 *
 * Unrecognised types are recorded and classified as internal. A type nobody has
 * seen before must not be able to invent funding out of nothing, and the raw
 * type is stored, so re-deciding later is a query rather than a re-fetch.
 */
export function classifyLedgerUpdate(
  update: RawLedgerUpdate,
  walletAddress: string,
): ClassifiedLedgerEvent {
  const delta = update.delta ?? {};
  const eventType = String(delta.type ?? "unknown");
  const magnitude = magnitudeOf(delta);
  const fee = Math.abs(toNumber(delta.fee));

  let amountUsd = magnitude;
  let isExternal = false;

  if (eventType === "deposit") {
    isExternal = true;
  } else if (eventType === "withdraw") {
    // The fee leaves the account too, so it belongs in the outflow. Otherwise a
    // full withdrawal would leave a small positive net behind and the account
    // would still look funded.
    amountUsd = -(magnitude + fee);
    isExternal = true;
  } else if (TRANSFER_TYPES.has(eventType)) {
    const isUsdc = String(delta.token ?? "USDC").toUpperCase() === "USDC";
    const sender = delta.user ?? null;
    const recipient = delta.destination ?? null;

    // Same address on both ends is this account moving its own money between
    // its spot and perp balances. It is the single most common event on a real
    // ledger and it is not funding.
    if (isUsdc && !sameAddress(sender, recipient)) {
      if (sameAddress(recipient, walletAddress)) {
        isExternal = true;
      } else if (sameAddress(sender, walletAddress)) {
        amountUsd = -(magnitude + fee);
        isExternal = true;
      }
    }
  }

  return {
    amountUsd,
    // Hyperliquid gives no id of its own. Hash, instant and type together are
    // stable across re-reads, which is what makes replaying a window free.
    eventKey: `${update.hash}:${update.time}:${eventType}`,
    eventType,
    isExternal,
    occurredAt: new Date(update.time).toISOString(),
  };
}

export interface DepositSyncResult {
  errorCode: "EXCHANGE_UNAVAILABLE" | "LEDGER_WRITE_FAILED" | null;
  eventsIngested: number;
  externalEvents: number;
  windowStartMs: number;
}

export interface SyncAccountDepositsDeps {
  /** Injected so the worker can be driven without an exchange in tests. */
  fetchLedgerUpdates: (
    walletAddress: string,
    window: { endMs: number; startMs: number },
  ) => Promise<RawLedgerUpdate[]>;
  now?: () => number;
}

/**
 * Read one account's ledger from its cursor and record what it says.
 *
 * No window subdivision, unlike fills. That machinery exists because
 * `userFillsByTime` caps at 2,000 per response and cannot say whether it
 * truncated; this feed carries tens of events over an account's whole life —
 * seventeen across five months on the account it was built against — so a
 * single request for the whole window is both sufficient and provably complete.
 *
 * Writes first, cursor second, for the same reason the fill worker does: a
 * crash between the two costs a re-read, and the re-read is free because every
 * row upserts onto its own event key.
 */
export async function syncAccountDeposits(
  config: RewardsConfig,
  claim: { userId: string; walletAddress: string },
  deps: SyncAccountDepositsDeps,
): Promise<DepositSyncResult> {
  // Narrowed rather than spread. The worker hands over its fill claim, which
  // carries that checkpoint's `cursorTime` — and spreading it into a completion
  // call handed the *fill* cursor to the deposit checkpoint, so a failed read
  // advanced the deposit cursor past history it had just failed to record.
  const account = { userId: claim.userId, walletAddress: claim.walletAddress };

  const endMs = deps.now?.() ?? Date.now();
  const cursorTime = await openDepositSync(config, account);
  const startMs = new Date(cursorTime).getTime();

  const base = { eventsIngested: 0, externalEvents: 0, windowStartMs: startMs };

  if (startMs > endMs) {
    return { ...base, errorCode: null };
  }

  let updates: RawLedgerUpdate[];
  try {
    updates = await deps.fetchLedgerUpdates(account.walletAddress, { endMs, startMs });
  } catch {
    // The upstream message is discarded rather than stored: this value reaches
    // a reconciliation surface, and an exchange error body is not something to
    // persist and re-display.
    await completeDepositSync(config, { ...account, errorCode: "EXCHANGE_UNAVAILABLE" });
    return { ...base, errorCode: "EXCHANGE_UNAVAILABLE" };
  }

  const rows: DepositEventInsert[] = updates.map((update) => ({
    ...classifyLedgerUpdate(update, account.walletAddress),
    userId: account.userId,
    walletAddress: account.walletAddress,
  }));

  try {
    await upsertDepositEvents(config, rows);
  } catch {
    await completeDepositSync(config, { ...account, errorCode: "LEDGER_WRITE_FAILED" });
    return { ...base, errorCode: "LEDGER_WRITE_FAILED" };
  }

  await completeDepositSync(config, {
    ...account,
    // The window end, not the newest event's timestamp. Using the newest event
    // would strand anything sharing that exact millisecond behind the next
    // window's start.
    cursorTime: new Date(endMs).toISOString(),
    eventsIngested: rows.length,
  });

  return {
    errorCode: null,
    eventsIngested: rows.length,
    externalEvents: rows.filter((row) => row.isExternal).length,
    windowStartMs: startMs,
  };
}
