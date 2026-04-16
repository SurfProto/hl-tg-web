import { ensureMethod, HttpError, json, parseJsonBody, withJsonRoute } from "../onramp/_lib/http";
import { getRewardsConfig } from "./_lib/config";
import { runWeeklyRaffle } from "./_lib/program";

interface WeeklyRaffleBody {
  weekStart?: string | null;
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    const config = getRewardsConfig();
    if (request.method === "GET") {
      const cronSecret = process.env.CRON_SECRET;
      const authorization = request.headers?.authorization ?? request.headers?.Authorization;
      if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
        throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid cron authorization");
      }
    } else {
      ensureMethod(request, "POST");

      const adminKey = request.headers["x-rewards-admin-key"] ?? request.headers["X-REWARDS-ADMIN-KEY"];
      if (!config.rewardsAdminKey || adminKey !== config.rewardsAdminKey) {
        throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid rewards admin key");
      }
    }

    const body = request.method === "POST" ? parseJsonBody<WeeklyRaffleBody>(request) : {};
    const result = await runWeeklyRaffle(
      {
        weekStart: body.weekStart ?? null,
      },
      config,
    );

    json(response, 200, {
      success: true,
      data: result,
    });
  });
}
