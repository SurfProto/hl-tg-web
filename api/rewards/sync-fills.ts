import { constantTimeEquals } from "../_lib/secret-compare";
import { fetchWithTimeout } from "../_lib/fetch-with-timeout";
import { ensureMethod, HttpError, json, withJsonRoute } from "../onramp/_lib/http";
import { getRewardsConfig, type RewardsConfig } from "./_lib/config";
import { syncAccountDeposits, type RawLedgerUpdate } from "./_lib/deposits";
import { syncAccountFills } from "./_lib/fill-sync";
import { grantReferralMilestones } from "./_lib/referrals";
import { getWeekStartIso } from "./_lib/weeks";
import type { FillWindow, RawFill } from "./_lib/fill-windows";
import {
  backfillFillCheckpoints,
  claimFillSyncBatch,
  getOrCreateActiveSeason,
  getSeasonBounds,
  rebuildProjections,
} from "./_lib/supabase-admin";

/**
 * Scheduled fill ingestion.
 *
 * Trading volume used to be read only while somebody had the Points screen
 * open, which made earning XP a function of visiting a page: a user who traded
 * and never opened it earned nothing, and a user past 2,000 fills silently lost
 * the older ones. Ingestion belongs on a schedule, not on a page view.
 *
 * Each run claims a bounded batch, so a slow account cannot starve the rest and
 * two overlapping runs cannot fetch the same account. Per-account failures are
 * recorded against that account's checkpoint and the run continues: one
 * unreachable wallet must not stop everyone else's XP.
 */

const DEFAULT_BATCH_LIMIT = 25;

/**
 * How long before a claimed account is offered to another run.
 *
 * This exists to release a batch abandoned by a worker that died mid-run. It is
 * not a rate limiter, and it must stay comfortably below the cron interval or
 * it silently becomes one: at 900s against a ten-minute schedule, an account
 * attempted at 08:01 was not yet due at 08:10, so every other tick claimed
 * nothing and the real sync cadence was twenty minutes rather than ten.
 *
 * Comfortably below, not merely below. Cron ticks land on fixed wall-clock
 * minutes while `last_attempt_at` drifts to whenever the run actually happened,
 * so a threshold equal to the interval still misses on the boundary — a run at
 * 08:10:00 is exactly 600s old at 08:20:00, and the comparison is strict.
 *
 * Re-claiming an account that is still in flight is safe if it ever happens:
 * the ledger write is keyed by fill and the cursor only moves forward, so the
 * cost is duplicated work rather than duplicated XP.
 */
export const CLAIM_STALE_AFTER_SECONDS = 300;

function hyperliquidInfoUrl(config: RewardsConfig) {
  return config.hyperliquidTestnet
    ? "https://api.hyperliquid-testnet.xyz/info"
    : "https://api.hyperliquid.xyz/info";
}

async function fetchFillsByTime(
  config: RewardsConfig,
  walletAddress: string,
  window: FillWindow,
): Promise<RawFill[]> {
  const response = await fetchWithTimeout(hyperliquidInfoUrl(config), {
    body: JSON.stringify({
      aggregateByTime: false,
      endTime: window.endMs,
      startTime: window.startMs,
      type: "userFillsByTime",
      user: walletAddress,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Hyperliquid userFillsByTime failed with status ${response.status}`);
  }

  return (await response.json()) as RawFill[];
}

/**
 * The account's record of money moving in and out.
 *
 * One request for the whole window, with none of the subdivision the fill
 * endpoint needs: this feed carries tens of events over an account's lifetime
 * rather than thousands, and Hyperliquid retains all of it.
 */
async function fetchLedgerUpdates(
  config: RewardsConfig,
  walletAddress: string,
  window: FillWindow,
): Promise<RawLedgerUpdate[]> {
  const response = await fetchWithTimeout(hyperliquidInfoUrl(config), {
    body: JSON.stringify({
      endTime: window.endMs,
      startTime: window.startMs,
      type: "userNonFundingLedgerUpdates",
      user: walletAddress,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `Hyperliquid userNonFundingLedgerUpdates failed with status ${response.status}`,
    );
  }

  return (await response.json()) as RawLedgerUpdate[];
}

/**
 * Never the full address.
 *
 * Run logs are the one place this code routinely writes wallet identifiers, and
 * a full address in a log line is a durable, searchable link between an
 * internal user id and an on-chain identity.
 */
function walletTag(walletAddress: string) {
  return `${walletAddress.slice(0, 6)}…`;
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "GET");

    const cronSecret = process.env.CRON_SECRET;
    const authorization = request.headers?.authorization ?? request.headers?.Authorization;
    if (!cronSecret || !constantTimeEquals(authorization, `Bearer ${cronSecret}`)) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid cron authorization");
    }

    const config = getRewardsConfig();
    const startedAt = Date.now();

    // The worker is a write path, so it may create the season — and it is the
    // only rewards caller that still does. Doing it here rather than on a page
    // read means one scheduled caller, not a race between arbitrary visitors.
    const season = await getOrCreateActiveSeason(config);
    const created = await backfillFillCheckpoints(config, {
      seasonId: season.id,
      startAt: season.starts_at,
    });

    const claims = await claimFillSyncBatch(config, {
      limit: DEFAULT_BATCH_LIMIT,
      staleAfterSeconds: CLAIM_STALE_AFTER_SECONDS,
    });

    // The season of every claim, not just the current one. A checkpoint may
    // finish reading its own season after the next has begun, and it has to
    // stop at that season's end — the bound whose absence granted September's
    // trades under August as well. See syncAccountFills.
    const seasonBounds = await getSeasonBounds(
      config,
      claims.map((claim) => claim.seasonId),
    );
    // The current season is known without a lookup, and it is the one bound
    // that must never be missing.
    seasonBounds.set(season.id, {
      endsAt: season.ends_at,
      startsAt: season.starts_at,
    });

    let accountsSynced = 0;
    let accountsRetired = 0;
    let accountsSkipped = 0;
    // Closed seasons whose tail this run read. See the rebuild after the batch.
    const closedSeasonsWritten = new Set<string>();
    let accountsFailed = 0;
    let depositEvents = 0;
    let depositsFailed = 0;
    let fillsIngested = 0;
    let grantsWritten = 0;
    let requestCount = 0;
    let retentionRiskAccounts = 0;

    for (const claim of claims) {
      const bounds = seasonBounds.get(claim.seasonId);
      if (!bounds) {
        // A claim whose season cannot be found is not synced on a guess. Its
        // row would cascade-delete with its season, so this is not expected;
        // but reading without the season's end is exactly the unbounded read
        // this change exists to remove, so the account waits for the next run.
        accountsSkipped += 1;
        console.warn(
          `[rewards-sync] season bounds missing user=${claim.userId} season=${claim.seasonId} wallet=${walletTag(claim.walletAddress)}`,
        );
        continue;
      }

      // A closed season's checkpoint whose cursor has reached that season's
      // end has nothing left to read. Migration 030's claim no longer offers
      // one, but a claim RPC that predates it still does — every August
      // checkpoint, until the migration runs — and each would otherwise cost a
      // deposit sync (Supabase round trips plus a Hyperliquid request) and be
      // counted as a successful sync while reading nothing. The user's
      // current-season claim syncs their deposits already.
      if (
        claim.seasonId !== season.id &&
        Date.parse(claim.cursorTime) >= Date.parse(bounds.endsAt)
      ) {
        accountsRetired += 1;
        continue;
      }

      // Before the fills, so that a first deposit and the quest it completes
      // land in the same run rather than a cadence apart. Its own checkpoint
      // and its own failure: an unreadable ledger must not cost this account
      // its trading XP, and the quest simply waits for the next run.
      const deposits = await syncAccountDeposits(config, claim, {
        fetchLedgerUpdates: (walletAddress, window) =>
          fetchLedgerUpdates(config, walletAddress, window),
      });

      if (deposits.errorCode) {
        depositsFailed += 1;
        console.warn(
          `[rewards-sync] deposits failed user=${claim.userId} wallet=${walletTag(claim.walletAddress)} code=${deposits.errorCode}`,
        );
      } else {
        depositEvents += deposits.eventsIngested;
      }

      // One account's failure is recorded against its own checkpoint and the
      // run continues; an unreachable wallet must not stop everyone else's XP.
      const result = await syncAccountFills(config, claim, {
        fetchFills: (walletAddress, window) => fetchFillsByTime(config, walletAddress, window),
        isCurrentSeason: claim.seasonId === season.id,
        seasonEndsAt: bounds.endsAt,
        seasonStartsAt: season.starts_at,
      });

      if (result.errorCode) {
        accountsFailed += 1;
        console.warn(
          `[rewards-sync] account failed user=${claim.userId} season=${claim.seasonId} wallet=${walletTag(claim.walletAddress)} code=${result.errorCode}`,
        );
        continue;
      }

      accountsSynced += 1;
      if (claim.seasonId !== season.id && result.grantsWritten > 0) {
        closedSeasonsWritten.add(claim.seasonId);
      }
      fillsIngested += result.fillsIngested;
      grantsWritten += result.grantsWritten;
      requestCount += result.requestCount;
      if (result.retentionRisk) {
        retentionRiskAccounts += 1;
      }

      console.info(
        `[rewards-sync] account ok user=${claim.userId} season=${claim.seasonId} wallet=${walletTag(claim.walletAddress)} ` +
          `window=${new Date(result.windowStartMs).toISOString()}..${new Date(result.windowEndMs).toISOString()} ` +
          `fills=${result.fillsIngested} grants=${result.grantsWritten} requests=${result.requestCount} retentionRisk=${result.retentionRisk}`,
      );
    }

    // Referral rungs depend on one user's activity and pay a different user,
    // so there is no account they naturally belong to. Once per run, before the
    // rebuild, so the XP they grant lands in the projection immediately.
    const referrals = await grantReferralMilestones(config, {
      seasonId: season.id,
      weekStart: getWeekStartIso(new Date()),
    });

    // After the batch, not per account: the projection is a whole-season
    // aggregate, and rebuilding it once per run keeps it self-healing. Nothing
    // wrote these between the dashboard becoming read-only and this line, which
    // is how the leaderboard came to rank on a frozen volume figure.
    const projections = await rebuildProjections(config, season.id);

    // A closed season whose tail was read this run is rebuilt too. The rebuild
    // above covers only the current season, and nothing else ever rebuilds a
    // closed one — so the grants a checkpoint writes for a season's final
    // stretch after it has ended would never reach that season's leaderboard.
    // Only on runs that actually wrote such grants, which is the first few
    // after each rollover.
    for (const closedSeasonId of closedSeasonsWritten) {
      await rebuildProjections(config, closedSeasonId);
    }

    const durationMs = Date.now() - startedAt;
    console.info(
      `[rewards-sync] run complete season=${season.id} checkpointsCreated=${created} claimed=${claims.length} ` +
        `synced=${accountsSynced} failed=${accountsFailed} retired=${accountsRetired} skipped=${accountsSkipped} ` +
        `closedSeasonsRebuilt=${closedSeasonsWritten.size} fills=${fillsIngested} grants=${grantsWritten} ` +
        `depositEvents=${depositEvents} depositsFailed=${depositsFailed} ` +
        `requests=${requestCount} retentionRisk=${retentionRiskAccounts} ` +
        `referralMilestones=${referrals.milestones} referralRows=${referrals.granted} ` +
        `projectionRows=${projections.pointsRows}/${projections.weeklyRows} durationMs=${durationMs}`,
    );

    json(response, 200, {
      success: true,
      data: {
        accountsFailed,
        accountsRetired,
        accountsSkipped,
        accountsSynced,
        closedSeasonsRebuilt: closedSeasonsWritten.size,
        checkpointsCreated: created,
        claimed: claims.length,
        depositEvents,
        depositsFailed,
        durationMs,
        fillsIngested,
        grantsWritten,
        projectionPointsRows: projections.pointsRows,
        projectionWeeklyRows: projections.weeklyRows,
        referralMilestones: referrals.milestones,
        referralRows: referrals.granted,
        requestCount,
        retentionRiskAccounts,
        seasonId: season.id,
      },
    });
  });
}
