import { ensureMethod, HttpError, json, parseJsonBody, withJsonRoute } from "./onramp/_lib/http";
import { getPlatformConfig } from "./platform/_lib/config";
import { optionalString, requireString } from "./platform/_lib/request";
import { persistWebhookEvent } from "./platform/_lib/supabase-admin";
import { verifyWebhookSignature } from "./platform/_lib/webhooks";

interface WebhookBody {
  eventType?: string;
  merchantId?: string | null;
  payload?: Record<string, unknown>;
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getPlatformConfig();
    if (!config.webhookSecret) {
      throw new HttpError(500, "WEBHOOKS_MISCONFIGURED", "Missing webhook signing secret");
    }

    const timestamp = Number(request.headers["x-platform-timestamp"] ?? request.headers["X-Platform-Timestamp"]);
    const signature = request.headers["x-platform-signature"] ?? request.headers["X-Platform-Signature"];
    if (!Number.isFinite(timestamp) || typeof signature !== "string") {
      throw new HttpError(401, "UNAUTHORIZED", "Missing webhook signature");
    }

    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
    const signatureValid = verifyWebhookSignature({
      body: rawBody,
      secret: config.webhookSecret,
      signature,
      timestamp,
    });
    if (!signatureValid) {
      throw new HttpError(401, "UNAUTHORIZED", "Invalid webhook signature");
    }

    const body = parseJsonBody<WebhookBody>(request);
    const event = await persistWebhookEvent(config, {
      eventType: requireString(body.eventType, "eventType"),
      merchantId: optionalString(body.merchantId),
      payload: body.payload ?? {},
      signatureValid,
    });

    json(response, 200, {
      success: true,
      data: { event },
    });
  });
}
