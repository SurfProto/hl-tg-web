import { requirePrivySession } from "../onramp/_lib/auth";
import { ensureMethod, HttpError, json, withJsonRoute } from "../onramp/_lib/http";
import { getStringQuery } from "../onramp/_lib/request";
import { getPlatformConfig } from "../platform/_lib/config";
import { getPlatformTransaction, getPlatformUserByPrivyUserId } from "../platform/_lib/supabase-admin";

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "GET");

    const config = getPlatformConfig();
    const session = await requirePrivySession(request, config.privyAppId);
    const user = await getPlatformUserByPrivyUserId(config, session.privyUserId);
    const transactionId = getStringQuery(request, "id") ?? request.query?.id;
    if (typeof transactionId !== "string" || !transactionId) {
      throw new HttpError(400, "BAD_REQUEST", "Transaction id is required");
    }

    const transaction = await getPlatformTransaction(config, transactionId);
    if (!transaction || (transaction.userId && transaction.userId !== user?.id)) {
      throw new HttpError(404, "TRANSACTION_NOT_FOUND", "Transaction not found");
    }

    json(response, 200, {
      success: true,
      data: { transaction },
    });
  });
}
