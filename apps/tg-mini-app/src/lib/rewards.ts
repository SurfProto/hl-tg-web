import type { RewardsDashboard } from "@repo/types";

interface Envelope<T> {
  code?: string;
  data: T;
  error?: string;
  success: boolean;
}

function looksLikeHtml(body: string) {
  const trimmed = body.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
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
    throw new Error(`Rewards API ${path} returned HTML instead of JSON`);
  }

  const payload = JSON.parse(rawBody) as Envelope<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? "Rewards request failed");
  }

  return payload.data;
}

export async function fetchRewardsDashboard(
  accessToken: string,
  input: { startParam?: string | null; username?: string | null; walletAddress?: string | null },
) {
  return requestJson<RewardsDashboard>("/api/rewards/dashboard", accessToken, {
    body: JSON.stringify(input),
    method: "POST",
  });
}
