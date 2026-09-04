import type { BuilderFillRow } from "./builder-fills";

/**
 * WNFT conversion derivation — is this account a genuine repeat trader?
 *
 * Pure: no I/O, no config globals. The caller supplies the account's
 * *reconciled* builder fills (rows from Hyperliquid's own export that paid our
 * builder address) and the thresholds. The thresholds are policy — a notional
 * floor derived from the bounty and attack cost — and live in configuration,
 * not here, because their correct value is an economic decision that this
 * function must not bake in.
 *
 * Two distinct orders, not two fills. The export carries no order id (its row
 * key is only `{day}:{line}`), so order boundaries are reconstructed: fills of
 * the same coin and side within a short window are one order. This stops a
 * single order that filled across several price levels in one second from
 * reading as several orders, and stops many tiny fills from being summed
 * across a day into one fake large trade — the floor is applied per
 * reconstructed order.
 */

export interface WnftQualificationConfig {
  /** Minimum notional (USD) a single reconstructed order must reach to count. */
  minOrderNotionalUsd: number;
  /** Fills of the same coin/side within this many seconds are one order. */
  sameOrderWindowSeconds: number;
  /** Distinct qualifying orders required to convert. The spec's "two". */
  minQualifyingOrders: number;
}

export interface WnftQualification {
  qualifies: boolean;
  qualifyingOrderCount: number;
  qualifyingNotionalUsd: number;
  /** Completion time of the order that tipped the account over, or null. */
  convertedAt: string | null;
}

interface ReconstructedOrder {
  coin: string;
  side: string;
  notionalUsd: number;
  /** The latest fill time in the order — when the order completed. */
  completedAt: number;
}

function reconstructOrders(
  fills: BuilderFillRow[],
  windowMs: number,
): ReconstructedOrder[] {
  // Oldest first, so a fill only ever extends the order that precedes it.
  const sorted = [...fills].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );

  const orders: ReconstructedOrder[] = [];
  // The most recent order seen per (coin, side), for the window check.
  const openByKey = new Map<string, ReconstructedOrder & { lastFillAt: number }>();

  for (const fill of sorted) {
    const at = new Date(fill.occurredAt).getTime();
    if (!Number.isFinite(at)) {
      continue;
    }
    const notional = fill.px * fill.sz;
    if (!(notional > 0)) {
      continue;
    }

    const key = `${fill.coin}|${fill.side}`;
    const open = openByKey.get(key);
    if (open && at - open.lastFillAt <= windowMs) {
      open.notionalUsd += notional;
      open.completedAt = at;
      open.lastFillAt = at;
      continue;
    }

    const order = {
      coin: fill.coin,
      side: fill.side,
      notionalUsd: notional,
      completedAt: at,
      lastFillAt: at,
    };
    orders.push(order);
    openByKey.set(key, order);
  }

  return orders;
}

export function deriveWnftQualification(
  fills: BuilderFillRow[],
  config: WnftQualificationConfig,
): WnftQualification {
  const windowMs = Math.max(0, config.sameOrderWindowSeconds) * 1000;
  const orders = reconstructOrders(fills, windowMs);

  // Qualifying orders in completion order, so the Nth is the conversion moment.
  const qualifying = orders
    .filter((order) => order.notionalUsd >= config.minOrderNotionalUsd)
    .sort((a, b) => a.completedAt - b.completedAt);

  const qualifies = qualifying.length >= config.minQualifyingOrders;
  const convertedAt = qualifies
    ? new Date(qualifying[config.minQualifyingOrders - 1].completedAt).toISOString()
    : null;

  return {
    qualifies,
    qualifyingOrderCount: qualifying.length,
    qualifyingNotionalUsd: qualifying.reduce(
      (sum, order) => sum + order.notionalUsd,
      0,
    ),
    convertedAt,
  };
}

/**
 * Repository surface the WNFT refresh needs. Injected so the orchestration is
 * testable without a database.
 */
export interface WnftSyncDeps {
  getWalletUsers: () => Promise<Array<{ id: string; walletAddress: string }>>;
  getBuilderFillsForWallet: (walletAddress: string) => Promise<BuilderFillRow[]>;
  getWnftStatus: (
    userId: string,
  ) => Promise<"provisional" | "confirmed" | "rejected" | null>;
  upsertWnftProvisional: (
    userId: string,
    qualification: WnftQualification,
  ) => Promise<void>;
}

export interface WnftRefreshSummary {
  evaluated: number;
  provisional: number;
  skippedReviewed: number;
}

/**
 * Re-derive WNFT qualification for the wallets a builder-fill sync just
 * touched, and record a provisional record for any that now qualify.
 *
 * A reviewed record (confirmed or rejected) is never touched — a human's
 * decision is final until a human changes it. Nothing here is payable: a
 * provisional record is the held, awaiting-review state, and the cash bounty
 * is a separate gated track.
 */
export async function refreshWnftForWallets(
  walletAddresses: string[],
  config: WnftQualificationConfig,
  deps: WnftSyncDeps,
): Promise<WnftRefreshSummary> {
  const wallets = Array.from(
    new Set(walletAddresses.map((address) => address.toLowerCase())),
  );
  if (wallets.length === 0) {
    return { evaluated: 0, provisional: 0, skippedReviewed: 0 };
  }

  const walletUsers = await deps.getWalletUsers();
  const userIdByWallet = new Map(
    walletUsers.map((user) => [user.walletAddress.toLowerCase(), user.id]),
  );

  let evaluated = 0;
  let provisional = 0;
  let skippedReviewed = 0;

  for (const wallet of wallets) {
    const userId = userIdByWallet.get(wallet);
    if (!userId) {
      // A builder fill for a wallet with no linked account — nothing to
      // convert. Normal, not an error.
      continue;
    }

    const status = await deps.getWnftStatus(userId);
    if (status === "confirmed" || status === "rejected") {
      skippedReviewed += 1;
      continue;
    }

    evaluated += 1;
    const qualification = deriveWnftQualification(
      await deps.getBuilderFillsForWallet(wallet),
      config,
    );
    if (qualification.qualifies) {
      await deps.upsertWnftProvisional(userId, qualification);
      provisional += 1;
    }
  }

  return { evaluated, provisional, skippedReviewed };
}
