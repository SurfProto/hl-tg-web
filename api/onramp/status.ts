import { requirePrivySession } from "./_lib/auth";
import { getOnrampConfig } from "./_lib/config";
import { ensureMethod, json, withJsonRoute, HttpError } from "./_lib/http";
import { getOnrampOrder } from "./_lib/provider";
import { getStringQuery } from "./_lib/request";
import { getActiveOrder, getOwnedOrder, getUserByPrivyUserId, updateOwnedOrderStatus } from "./_lib/supabase-admin";

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "GET");

    const config = getOnrampConfig();
    const session = await requirePrivySession(request, config.privyAppId);
    const user = await getUserByPrivyUserId(config, session.privyUserId);
    if (!user?.email || !user.wallet_address) {
      throw new HttpError(400, "ONRAMP_NOT_READY", "Onramp identity is not initialized");
    }

    const orderId = getStringQuery(request, "order_id");
    const externalOrderId =
      getStringQuery(request, "external_order_id") ?? getStringQuery(request, "onramp_external_order_id");

    const localOrder =
      orderId || externalOrderId
        ? await getOwnedOrder(config, user.id, {
            providerOrderId: orderId,
            externalOrderId,
          })
        : await getActiveOrder(config, user.id);
    if (!localOrder) {
      throw new HttpError(404, "ORDER_NOT_FOUND", "No owned onramp order found");
    }

    const order = await getOnrampOrder(config, {
      orderId: localOrder.id,
      externalOrderId: localOrder.externalOrderId,
    });

    const persisted = await updateOwnedOrderStatus(config, user.id, localOrder.id, {
      providerState: order.state,
      payinAmount: order.payin_amount,
      payoutAmount: order.payout_amount,
      feeAmount: order.fee ?? null,
      invoiceUrl: order.invoice_url,
      invoiceUrlExpiresAt: order.invoice_url_expires_at,
      providerTouchedAt: order.touched_at,
      errorCode: null,
      errorMessage: null,
    });

    json(response, 200, {
      success: true,
      data: {
        state: persisted.appState,
        order: persisted,
      },
    });
  });
}
