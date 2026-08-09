import { ensureMethod, HttpError, json, withJsonRoute } from "./onramp/_lib/http";
import { getPlatformConfig } from "./platform/_lib/config";
import { optionalString, requireString } from "./platform/_lib/request";
import { getMerchantByApiKey, persistWebhookEvent } from "./platform/_lib/supabase-admin";
import { verifyWebhookSignature } from "./platform/_lib/webhooks";

interface WebhookBody {
  eventId?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
}

/**
 * Vercel parses JSON bodies before the handler runs, which destroys the exact
 * bytes the sender signed. Turning the parser off lets us read the raw stream
 * and verify the HMAC against what was actually sent — re-serialising the
 * parsed object with JSON.stringify only matches if the sender happened to use
 * the same key order and spacing.
 */
export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(request: any): Promise<string> {
  if (typeof request.body === "string") {
    return request.body;
  }

  if (Buffer.isBuffer(request.body)) {
    return request.body.toString("utf8");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function header(request: any, name: string): string | undefined {
  const raw = request.headers?.[name] ?? request.headers?.[name.toUpperCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : undefined;
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const platformConfig = getPlatformConfig();
    if (!platformConfig.webhookSecret) {
      throw new HttpError(500, "WEBHOOKS_MISCONFIGURED", "Missing webhook signing secret");
    }

    // The sending merchant is identified by its API key, not by a merchantId
    // in the body that anyone could set.
    const apiKey = header(request, "x-merchant-api-key");
    const merchant = apiKey ? await getMerchantByApiKey(platformConfig, apiKey) : null;
    if (apiKey && !merchant) {
      throw new HttpError(401, "UNAUTHORIZED", "Invalid merchant API key");
    }

    const timestamp = Number(header(request, "x-platform-timestamp"));
    const signature = header(request, "x-platform-signature");
    if (!Number.isFinite(timestamp) || typeof signature !== "string") {
      throw new HttpError(401, "UNAUTHORIZED", "Missing webhook signature");
    }

    const rawBody = await readRawBody(request);
    if (
      !verifyWebhookSignature({
        body: rawBody,
        secret: platformConfig.webhookSecret,
        signature,
        timestamp,
      })
    ) {
      throw new HttpError(401, "UNAUTHORIZED", "Invalid webhook signature");
    }

    let body: WebhookBody;
    try {
      body = rawBody ? (JSON.parse(rawBody) as WebhookBody) : {};
    } catch {
      throw new HttpError(400, "BAD_REQUEST", "Webhook body is not valid JSON");
    }

    // The timestamp window alone does not stop replays: the same signed bytes
    // can be sent repeatedly inside it. eventId is unique in the database.
    const eventId = optionalString(body.eventId);
    if (!eventId) {
      throw new HttpError(400, "BAD_REQUEST", "eventId is required for replay protection");
    }

    const event = await persistWebhookEvent(platformConfig, {
      eventId,
      eventType: requireString(body.eventType, "eventType"),
      merchantId: merchant?.id ?? null,
      payload: body.payload ?? {},
      signatureValid: true,
    });

    if (!event) {
      // Unique violation on eventId — already processed. Acknowledge so the
      // sender stops retrying.
      json(response, 200, { success: true, data: { duplicate: true } });
      return;
    }

    json(response, 200, {
      success: true,
      data: { event },
    });
  });
}
