import { HttpError } from "./onramp/_lib/http";
import { toErrorBody } from "./_lib/error-response";
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
 * Uses the Web Standard signature rather than Node's (request, response).
 *
 * Vercel populates `request.body` with a *parsed* object for
 * `Content-Type: application/json`, consuming the stream in the process, so a
 * Node-signature handler can never see the bytes the sender signed.
 * Re-serialising the parsed object only reproduces them if the sender happened
 * to use identical key order and spacing. `export const config = { api: {
 * bodyParser: false } }` does not help either — that is a Next.js Pages Router
 * convention and is ignored by Vercel Functions.
 *
 * A Web handler receives the untouched Request, so `await request.text()`
 * returns exactly what was transmitted and the HMAC is computed over it.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handleWebhook(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Expected POST");
  }

  const config = getPlatformConfig();
  if (!config.webhookSecret) {
    throw new HttpError(500, "WEBHOOKS_MISCONFIGURED", "Missing webhook signing secret");
  }

  // The sending merchant is identified by its API key, not by a merchantId in
  // the body that any caller could set.
  const apiKey = request.headers.get("x-merchant-api-key");
  const merchant = apiKey ? await getMerchantByApiKey(config, apiKey) : null;
  if (apiKey && !merchant) {
    throw new HttpError(401, "UNAUTHORIZED", "Invalid merchant API key");
  }

  const timestamp = Number(request.headers.get("x-platform-timestamp"));
  const signature = request.headers.get("x-platform-signature");
  if (!Number.isFinite(timestamp) || !signature) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing webhook signature");
  }

  // Exactly the bytes that were sent.
  const rawBody = await request.text();
  if (
    !verifyWebhookSignature({
      body: rawBody,
      secret: config.webhookSecret,
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

  // The timestamp window alone does not stop replays: the same signed bytes can
  // be resent inside it. eventId is unique in the database.
  const eventId = optionalString(body.eventId);
  if (!eventId) {
    throw new HttpError(400, "BAD_REQUEST", "eventId is required for replay protection");
  }

  const event = await persistWebhookEvent(config, {
    eventId,
    eventType: requireString(body.eventType, "eventType"),
    merchantId: merchant?.id ?? null,
    payload: body.payload ?? {},
    signatureValid: true,
  });

  if (!event) {
    // Unique violation on eventId — already processed. Acknowledge so the
    // sender stops retrying.
    return jsonResponse(200, { success: true, data: { duplicate: true } });
  }

  return jsonResponse(200, { success: true, data: { event } });
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handleWebhook(request);
    } catch (error) {
      const { statusCode, body } = toErrorBody(error);
      return jsonResponse(statusCode, body);
    }
  },
};
