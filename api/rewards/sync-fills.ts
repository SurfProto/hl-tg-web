import { constantTimeEquals } from "../_lib/secret-compare";
import { fetchWithTimeout } from "../_lib/fetch-with-timeout";
import { ensureMethod, HttpError, json, withJsonRoute } from "../onramp/_lib/http";
import { getRewardsConfig, type RewardsConfig } from "./_lib/config";
import { syncAccountFills } from "./_lib/fill-sync";
import type { FillWindow, RawFill } from "./_lib/fill-windows";
import {
  backfillFillCheckpoints,
  claimFillSyncBatch,
  getOrCreateActiveSeason,
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

    const claims = await claimFillSyncBatch(config, { limit: DEFAULT_BATCH_LIMIT });

    let accountsSynced = 0;
    let accountsFailed = 0;
    let fillsIngested = 0;
    let grantsWritten = 0;
    let requestCount = 0;
    let retentionRiskAccounts = 0;

    for (const claim of claims) {
      // One account's failure is recorded against its own checkpoint and the
      // run continues; an unreachable wallet must not stop everyone else's XP.
      const result = await syncAccountFills(config, claim, {
        fetchFills: (walletAddress, window) => fetchFillsByTime(config, walletAddress, window),
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

    const durationMs = Date.now() - startedAt;
    console.info(
      `[rewards-sync] run complete season=${season.id} checkpointsCreated=${created} claimed=${claims.length} ` +
        `synced=${accountsSynced} failed=${accountsFailed} fills=${fillsIngested} grants=${grantsWritten} ` +
        `requests=${requestCount} retentionRisk=${retentionRiskAccounts} durationMs=${durationMs}`,
    );

    json(response, 200, {
      success: true,
      data: {
        accountsFailed,
        accountsSynced,
        checkpointsCreated: created,
        claimed: claims.length,
        durationMs,
        fillsIngested,
        grantsWritten,
        requestCount,
        retentionRiskAccounts,
        seasonId: season.id,
      },
    });
  });
}
