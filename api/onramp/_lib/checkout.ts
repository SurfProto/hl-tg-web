import { createHash } from "node:crypto";

import type { OnrampConfig } from "./config";
import { confirmOnrampOrder, createOnrampPreorder } from "./provider";
import { toOrderStatus } from "./responses";
import { getOwnedOrder, persistOrder } from "./supabase-admin";
import type { OnrampOrderStatus } from "./types";

/**
 * Derive a stable provider-facing order id from the caller's idempotency key.
 *
 * The id used to be a fresh randomUUID() on every call, so a double-tap or a
 * client retry created a *second real payment order* with the provider. Deriving
 * it means a retry presents the same external id and can be matched instead.
 *
 * Hashed with the user id so one account cannot guess or collide with another's.
 */
export function deriveExternalOrderId(userId: string, idempotencyKey: string): string {
  const digest = createHash("sha256")
    .update(`${userId}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 32);
  return `onramp_${digest}`;
}

export async function createAndPersistOrder(input: {
  config: OnrampConfig;
  user: {
    id: string;
    email: string;
    kycId: string | null;
  };
  amount: number;
  idempotencyKey: string;
  payoutAddress: string;
}): Promise<OnrampOrderStatus> {
  const externalOrderId = deriveExternalOrderId(input.user.id, input.idempotencyKey);

  // Return the existing order rather than starting another one. Checked before
  // touching the provider, because that call moves real money.
  const existing = await getOwnedOrder(input.config, input.user.id, { externalOrderId });
  if (existing) {
    return existing;
  }

  const preorder = await createOnrampPreorder(input.config, {
    address: input.payoutAddress,
    amount: input.amount,
    externalOrderId,
    userEmail: input.user.email,
    userKycId: input.user.kycId ?? input.user.id,
  });

  const confirmed = await confirmOnrampOrder(input.config, preorder.id);
  const order = toOrderStatus(input.config, confirmed);

  try {
    return await persistOrder(input.config, {
      userId: input.user.id,
      walletAddress: input.payoutAddress,
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
  } catch (error) {
    // A live provider order now exists with no local record. Log the identifiers
    // needed to reconcile it before rethrowing — previously this failure left no
    // trace of the orphaned order at all.
    console.error("[onramp] Order created with provider but not persisted", {
      externalOrderId,
      providerOrderId: confirmed.id,
      userId: input.user.id,
    });
    throw error;
  }
}
