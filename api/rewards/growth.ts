import { constantTimeEquals } from "../_lib/secret-compare";
import { getRewardsConfig } from "./_lib/config";
import { HttpError, json, withJsonRoute } from "../onramp/_lib/http";
import { buildGrowthFunnel } from "./_lib/growth-funnel";
import {
  getFundedUserIds,
  getLastActivityByUser,
  listCampaignSpend,
  listUserAttributions,
  listWnftConversions,
} from "./_lib/supabase-admin";

/**
 * The growth funnel — the manual operating report of the growth spec's point 4.
 * Admin-keyed: this is operator data across the whole program.
 *
 * Per channel and in total: authenticated users, funded users, WNFT held /
 * confirmed / rejected, D7 retention, campaign spend and CAC. Everything is
 * derived — from attribution, deposits, reconciled fills, WNFT records and the
 * operator-seeded campaign_spend — so there is nothing to keep in sync by hand.
 *
 * It measures authenticated accounts. Link opens before authentication are not
 * captured, so they are not reported; the honest top of this funnel is the
 * first authenticated wallet.
 */

const RETENTION_DAYS = 7;

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    if (request.method !== "GET") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Expected GET");
    }

    const config = getRewardsConfig();
    const provided =
      request.headers?.["x-rewards-admin-key"] ??
      request.headers?.["X-REWARDS-ADMIN-KEY"];
    if (!config.rewardsAdminKey || !constantTimeEquals(provided, config.rewardsAdminKey)) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid admin key");
    }

    const [attributions, wnftRecords, fundedUserIds, activity, spend] =
      await Promise.all([
        listUserAttributions(config),
        listWnftConversions(config),
        getFundedUserIds(config),
        getLastActivityByUser(config),
        listCampaignSpend(config),
      ]);

    const report = buildGrowthFunnel({
      attributions,
      wnftByUser: new Map(wnftRecords.map((record) => [record.userId, record.status])),
      fundedUserIds: new Set(fundedUserIds),
      lastActivityByUser: new Map(
        activity.map((row) => [row.userId, row.lastOccurredAt]),
      ),
      spendByCampaign: new Map(spend.map((row) => [row.campaignCode, row.spendUsd])),
      retentionDays: RETENTION_DAYS,
    });

    json(response, 200, {
      success: true,
      data: { retentionDays: RETENTION_DAYS, ...report },
    });
  });
}
