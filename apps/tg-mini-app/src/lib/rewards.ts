import type { ReferralSummary, RewardsDashboard } from "@repo/types";

interface Envelope<T> {
  code?: string;
  data: T;
  error?: string;
  success: boolean;
}

export class RewardsApiError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "RewardsApiError";
    this.code = code;
    this.status = status;
  }
}

function looksLikeHtml(body: string) {
  const trimmed = body.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

function buildNonJsonError(path: string, status: number, rawBody: string) {
  const snippet = rawBody.trim().slice(0, 160) || "<empty body>";
  return new Error(`Rewards API ${path} returned non-JSON (${status}): ${snippet}`);
}

async function requestJson<T>(path: string, accessToken: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });

  const rawBody = await response.text();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("text/html") || looksLikeHtml(rawBody)) {
    throw buildNonJsonError(path, response.status, rawBody);
  }

  let payload: Envelope<T>;
  try {
    payload = JSON.parse(rawBody) as Envelope<T>;
  } catch {
    throw buildNonJsonError(path, response.status, rawBody);
  }

  if (!response.ok || !payload.success) {
    throw new RewardsApiError(
      payload.error ?? "Rewards request failed",
      response.status,
      payload.code,
    );
  }

  return payload.data;
}

/**
 * Read the dashboard. Sends no referral parameter.
 *
 * It used to carry `startParam`, and the server used to link a referrer as a
 * side effect of the read. The server now ignores it, so passing it made the
 * link look wired when it was not — see useApplyReferralFromLink.
 */
export async function fetchRewardsDashboard(accessToken: string) {
  return requestJson<RewardsDashboard>("/api/rewards/dashboard", accessToken, {
    body: JSON.stringify({}),
    method: "POST",
  });
}

export async function applyReferralCode(
  accessToken: string,
  input: { referralCode: string },
) {
  return requestJson<ReferralSummary>("/api/rewards/referral/apply", accessToken, {
    body: JSON.stringify(input),
    method: "POST",
  });
}

export interface CheckInResult {
  alreadyCheckedIn: boolean;
  bonusXp?: number;
  streak: {
    availableToday: boolean;
    currentDays: number;
    lastCheckInAt: string | null;
    longestDays: number;
  };
  xpGranted: number;
}

/**
 * Take today's check-in.
 *
 * Safe to call twice: the server keys the grant by UTC date, so a second call
 * returns the same state rather than an error.
 */
export async function checkIn(accessToken: string): Promise<CheckInResult> {
  return requestJson<CheckInResult>("/api/rewards/check-in", accessToken, {
    method: "POST",
  });
}
