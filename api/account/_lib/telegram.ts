import { createHmac, timingSafeEqual } from "node:crypto";

import { constantTimeEquals } from "../../_lib/secret-compare";
import { HttpError } from "../../onramp/_lib/http";

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface VerifiedTelegramInitData {
  authDate: number;
  user?: TelegramUser;
}

function parseHeader(request: any) {
  const value =
    request.headers?.["x-telegram-init-data"] ??
    request.headers?.["X-Telegram-Init-Data"];
  return Array.isArray(value) ? value[0] : value;
}

function getPreviewBypass(request: any) {
  const value =
    request.headers?.["x-market-preview-bypass"] ??
    request.headers?.["X-Market-Preview-Bypass"];
  return Array.isArray(value) ? value[0] : value;
}

function dataCheckString(params: URLSearchParams) {
  return [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function expectedHash(initData: URLSearchParams, botToken: string) {
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secret).update(dataCheckString(initData)).digest("hex");
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds?: number } = {},
): VerifiedTelegramInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  if (!hash || !Number.isFinite(authDate)) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid Telegram init data");
  }

  const maxAgeSeconds = options.maxAgeSeconds ?? 24 * 60 * 60;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (authDate > nowSeconds + 60 || nowSeconds - authDate > maxAgeSeconds) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid Telegram init data");
  }

  if (!constantTimeEqual(hash, expectedHash(params, botToken))) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid Telegram init data");
  }

  const rawUser = params.get("user");
  let user: TelegramUser | undefined;
  if (rawUser) {
    try {
      user = JSON.parse(rawUser) as TelegramUser;
    } catch {
      throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid Telegram init data");
    }
  }

  return { authDate, user };
}

export function requireTelegramInitData(
  request: any,
  env: Record<string, string | undefined> = process.env,
): VerifiedTelegramInitData {
  const previewBypassSecret = env.MARKET_PREVIEW_BYPASS_SECRET?.trim();
  const bypass = getPreviewBypass(request);
  // NOTE: Vercel sets NODE_ENV=production on preview deployments too, so despite
  // the name this only takes effect for local development. That is the safe
  // behaviour; widening it to preview deployments would need a deliberate
  // decision, since the bypass skips identity verification entirely.
  if (
    env.NODE_ENV !== "production" &&
    previewBypassSecret &&
    typeof bypass === "string" &&
    constantTimeEquals(bypass, previewBypassSecret)
  ) {
    return { authDate: Math.floor(Date.now() / 1000), user: undefined };
  }

  const botToken =
    env.MARKET_TELEGRAM_BOT_TOKEN?.trim() || env.TELEGRAM_BOT_TOKEN?.trim();
  const initData = parseHeader(request);
  if (!botToken || typeof initData !== "string" || !initData.trim()) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid Telegram init data");
  }

  return verifyTelegramInitData(initData, botToken);
}
