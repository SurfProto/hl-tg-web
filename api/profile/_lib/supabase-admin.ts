import { type ProfileConfig } from "./config";

interface ProfileRow {
  id: string;
  telegram_id: string | null;
  wallet_address: string | null;
  privy_user_id: string | null;
  username: string | null;
  email: string | null;
  language: string | null;
}

interface NotificationPreferencesRow {
  liquidation_alerts: boolean;
  order_fills: boolean;
  usdc_deposits: boolean;
}

interface NotificationChannelRow {
  status: string | null;
}

interface BootstrapProfileInput {
  privyUserId: string;
  telegramId: string | null;
  walletAddress: string | null;
  username: string | null;
  email: string | null;
  language: string | null;
}

interface UpdateProfileInput {
  username?: string | null;
  language?: string | null;
}

interface UpdateNotificationPreferencesInput {
  liquidationAlerts: boolean;
  orderFills: boolean;
  usdcDeposits: boolean;
}

function looksLikeHtml(body: string): boolean {
  const trimmed = body.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

function buildHeaders(config: ProfileConfig, extra?: Record<string, string>) {
  return {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function supabaseRequest<T>(
  config: ProfileConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${body}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  const rawBody = await response.text();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("text/html") || looksLikeHtml(rawBody)) {
    throw new Error(`Supabase returned HTML for ${path}`);
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new Error(`Supabase returned invalid JSON for ${path}`);
  }
}

function normalizeEmail(email: string | null | undefined) {
  if (!email) {
    return null;
  }

  return email.trim().toLowerCase();
}

export function getDefaultNotificationPreferences(): NotificationPreferencesRow {
  return {
    liquidation_alerts: true,
    order_fills: true,
    usdc_deposits: true,
  };
}

export async function getProfileByPrivyUserId(
  config: ProfileConfig,
  privyUserId: string,
): Promise<ProfileRow | null> {
  const rows = await supabaseRequest<ProfileRow[]>(
    config,
    `users?privy_user_id=eq.${encodeURIComponent(privyUserId)}&select=id,telegram_id,wallet_address,privy_user_id,username,email,language&limit=1`,
    {
      headers: buildHeaders(config),
    },
  );

  return rows[0] ?? null;
}

export async function bootstrapProfileUser(
  config: ProfileConfig,
  input: BootstrapProfileInput,
): Promise<ProfileRow> {
  const payload = {
    telegram_id: input.telegramId,
    wallet_address: input.walletAddress,
    privy_user_id: input.privyUserId,
    username: input.username,
    email: normalizeEmail(input.email),
    language: input.language ?? "en",
  };

  if (input.telegramId) {
    const rows = await supabaseRequest<ProfileRow[]>(
      config,
      "users?on_conflict=telegram_id&select=id,telegram_id,wallet_address,privy_user_id,username,email,language",
      {
        method: "POST",
        headers: buildHeaders(config, {
          Prefer: "resolution=merge-duplicates,return=representation",
        }),
        body: JSON.stringify(payload),
      },
    );

    return rows[0];
  }

  if (input.walletAddress) {
    const rows = await supabaseRequest<ProfileRow[]>(
      config,
      "users?on_conflict=wallet_address&select=id,telegram_id,wallet_address,privy_user_id,username,email,language",
      {
        method: "POST",
        headers: buildHeaders(config, {
          Prefer: "resolution=merge-duplicates,return=representation",
        }),
        body: JSON.stringify(payload),
      },
    );

    return rows[0];
  }

  const existing = await getProfileByPrivyUserId(config, input.privyUserId);
  if (!existing) {
    throw new Error("PROFILE_NOT_FOUND");
  }

  return existing;
}

export async function updateProfileUser(
  config: ProfileConfig,
  privyUserId: string,
  updates: UpdateProfileInput,
): Promise<ProfileRow> {
  const existing = await getProfileByPrivyUserId(config, privyUserId);
  if (!existing) {
    throw new Error("PROFILE_NOT_FOUND");
  }

  const payload = {
    ...(Object.prototype.hasOwnProperty.call(updates, "username")
      ? { username: updates.username }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(updates, "language")
      ? { language: updates.language }
      : {}),
  };

  const rows = await supabaseRequest<ProfileRow[]>(
    config,
    `users?id=eq.${existing.id}&select=id,telegram_id,wallet_address,privy_user_id,username,email,language`,
    {
      method: "PATCH",
      headers: buildHeaders(config, {
        Prefer: "return=representation",
      }),
      body: JSON.stringify(payload),
    },
  );

  return rows[0];
}

export async function getNotificationPreferences(
  config: ProfileConfig,
  userId: string,
): Promise<NotificationPreferencesRow> {
  const rows = await supabaseRequest<NotificationPreferencesRow[]>(
    config,
    `notification_preferences?user_id=eq.${encodeURIComponent(userId)}&select=liquidation_alerts,order_fills,usdc_deposits&limit=1`,
    {
      headers: buildHeaders(config),
    },
  );

  return rows[0] ?? getDefaultNotificationPreferences();
}

export async function getNotificationChannelStatus(
  config: ProfileConfig,
  userId: string,
): Promise<string | null> {
  const rows = await supabaseRequest<NotificationChannelRow[]>(
    config,
    `notification_channels?user_id=eq.${encodeURIComponent(userId)}&channel=eq.telegram&select=status&limit=1`,
    {
      headers: buildHeaders(config),
    },
  );

  return rows[0]?.status ?? null;
}

export async function upsertNotificationPreferences(
  config: ProfileConfig,
  privyUserId: string,
  input: UpdateNotificationPreferencesInput,
): Promise<NotificationPreferencesRow> {
  const existing = await getProfileByPrivyUserId(config, privyUserId);
  if (!existing) {
    throw new Error("PROFILE_NOT_FOUND");
  }

  const rows = await supabaseRequest<NotificationPreferencesRow[]>(
    config,
    "notification_preferences?on_conflict=user_id&select=liquidation_alerts,order_fills,usdc_deposits",
    {
      method: "POST",
      headers: buildHeaders(config, {
        Prefer: "resolution=merge-duplicates,return=representation",
      }),
      body: JSON.stringify({
        user_id: existing.id,
        liquidation_alerts: input.liquidationAlerts,
        order_fills: input.orderFills,
        usdc_deposits: input.usdcDeposits,
      }),
    },
  );

  return rows[0];
}
