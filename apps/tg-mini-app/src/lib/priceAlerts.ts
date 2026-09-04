interface Envelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface PriceAlertRecord {
  id: string;
  coin: string;
  targetPx: number;
  direction: "above" | "below";
  createdAt: string;
}

async function requestJson<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });

  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? "Price alert request failed");
  }

  return payload.data;
}

export async function listPriceAlerts(
  accessToken: string,
): Promise<PriceAlertRecord[]> {
  const data = await requestJson<{ alerts: PriceAlertRecord[] }>(
    "/api/notifications/price-alerts",
    accessToken,
  );
  return data.alerts;
}

export async function createPriceAlert(
  accessToken: string,
  input: { coin: string; targetPx: number; direction: "above" | "below" },
): Promise<PriceAlertRecord> {
  const data = await requestJson<{ alert: PriceAlertRecord }>(
    "/api/notifications/price-alerts",
    accessToken,
    { body: JSON.stringify(input), method: "POST" },
  );
  return data.alert;
}

export async function removePriceAlert(
  accessToken: string,
  alertId: string,
): Promise<void> {
  await requestJson<{ deleted: boolean }>(
    `/api/notifications/price-alerts?id=${encodeURIComponent(alertId)}`,
    accessToken,
    { method: "DELETE" },
  );
}
