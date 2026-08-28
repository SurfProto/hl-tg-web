import { constantTimeEquals } from "../_lib/secret-compare";
import { ensureMethod, HttpError, json, withJsonRoute } from "../onramp/_lib/http";
import { loadBuilderFillsDay } from "./_lib/builder-fills";
import { getRewardsConfig } from "./_lib/config";
import {
  getPendingBuilderFillDays,
  recordBuilderFillDay,
  upsertBuilderFills,
} from "./_lib/supabase-admin";

/**
 * Daily ingestion of Hyperliquid's builder-fills export.
 *
 * Volume XP is granted on `builderFee > 0`, which says a fill paid *a* builder,
 * not that it paid *us*. This export is published per builder address, so it is
 * the only source that can tell the difference. It reconciles rather than
 * grants: the file for a day appears some time after that day ends, and making
 * XP wait on it would delay every user's reward by up to a day.
 *
 * Days are the unit of work and each is recorded independently, so one
 * unreadable file does not stop the rest, and a day already ingested is never
 * re-fetched.
 */

/** Days per run. The whole backlog is rarely more than this and the files are small. */
const DEFAULT_DAY_LIMIT = 7;

/**
 * How far back to look for gaps.
 *
 * Bounded so a long-idle deployment does not wake up and try to fetch a year.
 * Anything older than this is history the reconciliation will simply not cover,
 * which it reports as pending days rather than hiding.
 */
const LOOKBACK_DAYS = 30;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` to the `YYYYMMDD` the export is keyed by. */
function toExportKey(day: string): string {
  return day.replace(/-/g, "");
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
    if (!config.builderAddress) {
      throw new HttpError(
        500,
        "BUILDER_ADDRESS_MISSING",
        "Builder fill verification needs a builder address",
      );
    }

    const startedAt = Date.now();
    const from = isoDay(new Date(startedAt - LOOKBACK_DAYS * 24 * 60 * 60 * 1000));
    const days = await getPendingBuilderFillDays(config, { from, limit: DEFAULT_DAY_LIMIT });

    let ingested = 0;
    let unpublished = 0;
    let failed = 0;
    let rowsIngested = 0;
    let feeUsd = 0;

    for (const day of days) {
      const result = await loadBuilderFillsDay({
        builderAddress: config.builderAddress,
        day: toExportKey(day),
        testnet: config.hyperliquidTestnet,
      });

      if (result.kind === "unpublished") {
        unpublished += 1;
        await recordBuilderFillDay(config, { day, status: "unpublished" });
        continue;
      }

      if (result.kind === "unavailable") {
        failed += 1;
        console.warn(`[builder-fills] day failed day=${day} code=${result.code}`);
        await recordBuilderFillDay(config, {
          day,
          errorCode: result.code,
          status: "unavailable",
        });
        continue;
      }

      const dayFeeUsd = result.rows.reduce((sum, row) => sum + row.builderFeeUsd, 0);

      try {
        // Rows first, then the day. A crash between them costs a re-read, which
        // is free because every row keys on `{day}:{line}` — whereas marking
        // the day first would strand its rows unwritten and unretried.
        await upsertBuilderFills(
          config,
          result.rows.map((row) => ({ ...row, day })),
        );
      } catch {
        failed += 1;
        await recordBuilderFillDay(config, {
          day,
          errorCode: "write_failed",
          status: "unavailable",
        });
        continue;
      }

      await recordBuilderFillDay(config, {
        day,
        feeUsd: dayFeeUsd,
        malformed: result.malformed,
        rows: result.rows.length,
        status: "ingested",
      });

      ingested += 1;
      rowsIngested += result.rows.length;
      feeUsd += dayFeeUsd;

      if (result.malformed > 0) {
        console.warn(`[builder-fills] malformed rows day=${day} count=${result.malformed}`);
      }
    }

    const durationMs = Date.now() - startedAt;
    console.info(
      `[builder-fills] run complete considered=${days.length} ingested=${ingested} ` +
        `unpublished=${unpublished} failed=${failed} rows=${rowsIngested} ` +
        `feeUsd=${feeUsd.toFixed(6)} durationMs=${durationMs}`,
    );

    json(response, 200, {
      success: true,
      data: {
        considered: days.length,
        durationMs,
        failed,
        feeUsd,
        ingested,
        rowsIngested,
        unpublished,
      },
    });
  });
}
