import { createHmac, timingSafeEqual } from "node:crypto";

interface SignWebhookPayloadInput {
  body: string;
  secret: string;
  timestamp: number;
}

interface VerifyWebhookSignatureInput extends SignWebhookPayloadInput {
  now?: number;
  signature: string;
  toleranceSeconds?: number;
}

export function signWebhookPayload(input: SignWebhookPayloadInput): string {
  return createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.body}`)
    .digest("hex");
}

export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
  const toleranceSeconds = input.toleranceSeconds ?? 300;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.timestamp) > toleranceSeconds) {
    return false;
  }

  const expected = signWebhookPayload(input);
  const actualBuffer = Buffer.from(input.signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}
