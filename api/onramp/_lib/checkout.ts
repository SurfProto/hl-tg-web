import { randomUUID } from "node:crypto";

import type { OnrampConfig } from "./config";
import { confirmOnrampOrder, createOnrampPreorder, getOnrampOrder } from "./provider";
import { toOrderStatus } from "./responses";
import { persistOrder } from "./supabase-admin";
import type { OnrampOrderStatus } from "./types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createAndPersistOrder(input: {
  config: OnrampConfig;
  user: {
    id: string;
    walletAddress: string;
    email: string;
    kycId: string | null;
  };
  amount: number;
}): Promise<OnrampOrderStatus> {
  const externalOrderId = `onramp_${randomUUID()}`;
  const preorder = await createOnrampPreorder(input.config, {
    address: input.user.walletAddress,
    amount: input.amount,
    externalOrderId,
    userEmail: input.user.email,
    userKycId: input.user.kycId ?? input.user.id,
  });

  let confirmed = await confirmOnrampOrder(input.config, preorder.id);

  // TODO: Replace this short invoice poll with the hosted KYC + provider webhook phase.
  if (!confirmed.invoice_url) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sleep(1500);
      confirmed = await getOnrampOrder(input.config, { orderId: confirmed.id });
      if (confirmed.invoice_url) {
        break;
      }
    }
  }

  const order = toOrderStatus(input.config, confirmed);

  return persistOrder(input.config, {
    userId: input.user.id,
    walletAddress: input.user.walletAddress,
    email: input.user.email,
    providerOrderId: confirmed.id,
    externalOrderId: confirmed.external_order_id,
    serviceId: confirmed.service_id,
    providerState: confirmed.state,
    payinAmount: confirmed.payin_amount,
    payoutAmount: confirmed.payout_amount,
    feeAmount: confirmed.fee ?? null,
    invoiceUrl: confirmed.invoice_url,
    invoiceUrlExpiresAt: confirmed.invoice_url_expires_at,
    providerCreatedAt: confirmed.created_at,
    providerTouchedAt: confirmed.touched_at,
    errorCode: order.errorCode,
    errorMessage: order.errorMessage,
  });
}
