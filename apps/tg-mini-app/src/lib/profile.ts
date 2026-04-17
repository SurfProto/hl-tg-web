export interface NotificationPreferences {
  liquidationAlerts: boolean;
  orderFills: boolean;
  usdcDeposits: boolean;
}

export interface ProfileRecord {
  id: string;
  telegramId: string | null;
  walletAddress: string | null;
  privyUserId: string | null;
  username: string | null;
  email: string | null;
  language: string;
}

export interface ProfileEnvelope {
  profile: ProfileRecord;
  notificationPreferences: NotificationPreferences;
  telegramDeliveryStatus: string | null;
}

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: string;
  code?: string;
}

interface BootstrapProfileInput {
  telegramId?: string;
  privyUserId?: string;
  username?: string;
  walletAddress?: string;
  email?: string;
  language?: string;
}

interface UpdateProfileInput {
  username?: string | null;
  language?: string | null;
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

  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? "Profile request failed");
  }

  return payload.data;
}

export function getTelegramProfile() {
  return window.Telegram?.WebApp?.initDataUnsafe?.user;
}

export async function bootstrapProfile(accessToken: string, input: BootstrapProfileInput): Promise<ProfileEnvelope> {
  return requestJson<ProfileEnvelope>("/api/profile/bootstrap", accessToken, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function fetchProfile(accessToken: string): Promise<ProfileEnvelope> {
  return requestJson<ProfileEnvelope>("/api/profile", accessToken, {
    method: "GET",
  });
}

export async function updateProfile(accessToken: string, input: UpdateProfileInput): Promise<{ profile: ProfileRecord }> {
  return requestJson<{ profile: ProfileRecord }>("/api/profile", accessToken, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function updateNotificationPreferences(
  accessToken: string,
  input: NotificationPreferences,
): Promise<{ notificationPreferences: NotificationPreferences }> {
  return requestJson<{ notificationPreferences: NotificationPreferences }>(
    "/api/profile/notifications",
    accessToken,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}
