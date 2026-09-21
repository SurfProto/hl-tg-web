import { buildHeaders, isSupabaseUnavailable, supabaseRequest } from "../../_lib/supabase";
import {
  __resetSupabaseUnavailableTelemetryForTests,
  noteSupabaseUnavailable,
} from "../../_lib/supabase-telemetry";
import { redisDel, redisGet, redisSet, redisSetNx } from "../../market/_lib/redis";
import { type ProfileConfig } from "./config";
import { HttpError } from "../../onramp/_lib/http";

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
  walletAddress: string;
  username: string | null;
  email: string | null;
  language: string | null;
}

interface UpdateProfileInput {
  language?: string | null;
}

interface UpdateNotificationPreferencesInput {
  liquidationAlerts: boolean;
  orderFills: boolean;
  usdcDeposits: boolean;
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

/**
 * How long a resolved profile may be reused.
 *
 * requireAccountContext calls getProfileByPrivyUserId on every /api/account/*
 * request, and it runs *before* the Redis payload cache — so even a cache hit
 * cost one Supabase query. With the client polling the snapshot and orders
 * every 5s and fills every 10s, that was roughly 32 queries per minute per
 * active user, purely to translate a Privy user id into a wallet address.
 *
 * The mapping is effectively immutable, so a short window is safe. It is
 * deliberately short rather than absent because the row also carries
 * telegram_id, which requireAccountContext uses for an authorization decision;
 * 60s bounds how long a revoked or relinked identity stays usable. Both writers
 * below invalidate explicitly, so the window only matters for changes made
 * outside this API.
 */
const PROFILE_CACHE_TTL_SECONDS = 60;

/**
 * How long the last server-resolved profile stays usable when Supabase itself
 * is unreachable. On 2026-09-18 the database was down for over an hour; every
 * fresh entry above expired within a minute of it, and from then on each
 * account read went to a dead Supabase and every balance in the app blanked —
 * although the balance never needed the database for anything but this one
 * identity lookup, and Hyperliquid was healthy throughout. A day covers anyone
 * who opened the app since yesterday. It bounds how far into an outage reads
 * keep working and how old a row a user *inactive* before it can be handed —
 * an active user's copy is rewritten on every fresh miss, so it is under a
 * minute old when an outage begins. Every writer here clears both copies; a
 * users row edited outside this API must call invalidateProfileCache (see
 * HANDOFF.md). Served only when Supabase throws an availability error, never
 * when it answers.
 */
const PROFILE_STALE_TTL_SECONDS = 24 * 60 * 60;

/**
 * After a stale serve the fresh key is re-primed for this long, so the user's
 * next poll (every 5s) is a cache hit instead of another 4s wait on a dead
 * database. It also bounds how long a recovered Supabase goes unnoticed.
 */
const PROFILE_STALE_REPRIME_SECONDS = 15;

// The shared, throttled `[supabase] unavailable (profile-stale)` line: the
// only runtime-log signal that a persistent 5xx is being papered over by
// stale identities, so it must survive an outage without flooding it.
function noteStaleServe(error: unknown) {
  noteSupabaseUnavailable("profile-stale", error);
}

export function __resetProfileStaleTelemetryForTests() {
  __resetSupabaseUnavailableTelemetryForTests();
}

function profileCacheKey(privyUserId: string): string {
  return `profile:privy:${privyUserId}`;
}

function profileStaleKey(privyUserId: string): string {
  return `profile-stale:privy:${privyUserId}`;
}

export async function invalidateProfileCache(privyUserId: string): Promise<void> {
  // Both copies, or a relinked wallet could be served from the stale one
  // through the next outage.
  await Promise.all([
    redisDel(profileCacheKey(privyUserId)),
    redisDel(profileStaleKey(privyUserId)),
  ]);
}

export async function getProfileByPrivyUserId(
  config: ProfileConfig,
  privyUserId: string,
): Promise<ProfileRow | null> {
  const key = profileCacheKey(privyUserId);
  const cached = await redisGet(key);
  if (cached.value) {
    try {
      return JSON.parse(cached.value) as ProfileRow;
    } catch {
      // Unparseable entry: fall through and refresh it.
    }
  }

  let rows: ProfileRow[];
  try {
    rows = await supabaseRequest<ProfileRow[]>(
      config,
      `users?privy_user_id=eq.${encodeURIComponent(privyUserId)}&select=id,telegram_id,wallet_address,privy_user_id,username,email,language&limit=1`,
      {
        headers: buildHeaders(config),
      },
    );
  } catch (error) {
    // Only when Supabase did not answer — a timeout, a 5xx, a Cloudflare page.
    // That is an availability failure, not a verdict about this user, so the
    // last profile Supabase did resolve stands in: the same server-resolved
    // row it always was; nothing here trusts the client. A 4xx is Supabase
    // answering (a rotated key, a dropped column) and is rethrown, or a broken
    // deploy would hide behind reads that appear to work. A profile Supabase
    // has answered *about* (below) never reaches this branch, so a deleted or
    // relinked account still gets its 404 on a healthy DB.
    if (!isSupabaseUnavailable(error)) throw error;
    const stale = await redisGet(profileStaleKey(privyUserId));
    if (stale.value) {
      let profile: ProfileRow | null = null;
      try {
        profile = JSON.parse(stale.value) as ProfileRow;
      } catch {
        profile = null; // Unparseable stale entry: nothing to fall back on.
      }
      if (profile) {
        // NX: a concurrent healthy read may have just written a fresher entry.
        await redisSetNx(key, stale.value, PROFILE_STALE_REPRIME_SECONDS);
        noteStaleServe(error);
        return profile;
      }
    }
    throw error;
  }

  const profile = rows[0] ?? null;
  // Only cache hits. Caching "no such profile" would make a user who has just
  // signed up wait out the TTL before the app could see them.
  if (profile) {
    const serialized = JSON.stringify(profile);
    await Promise.all([
      redisSet(key, serialized, PROFILE_CACHE_TTL_SECONDS),
      redisSet(profileStaleKey(privyUserId), serialized, PROFILE_STALE_TTL_SECONDS),
    ]);
  } else {
    // Supabase answered "no such user": a deleted row, or one whose Privy id
    // moved elsewhere. The stale copy must go with it, or the next outage
    // would serve an identity the database has already retired.
    await redisDel(profileStaleKey(privyUserId));
  }

  return profile;
}

export async function getProfileByTelegramId(
  config: ProfileConfig,
  telegramId: string,
): Promise<ProfileRow | null> {
  const rows = await supabaseRequest<ProfileRow[]>(
    config,
    `users?telegram_id=eq.${encodeURIComponent(telegramId)}&select=id,telegram_id,wallet_address,privy_user_id,username,email,language&limit=1`,
    { headers: buildHeaders(config) },
  );

  return rows[0] ?? null;
}

export async function bootstrapProfileUser(
  config: ProfileConfig,
  input: BootstrapProfileInput,
): Promise<ProfileRow> {
  const existing = await getProfileByPrivyUserId(config, input.privyUserId);
  if (input.telegramId) {
    const telegramOwner = await getProfileByTelegramId(config, input.telegramId);
    if (telegramOwner && telegramOwner.privy_user_id !== input.privyUserId) {
      throw new HttpError(
        409,
        "IDENTITY_CONFLICT",
        "This Telegram account is already linked to another profile",
      );
    }
  }

  const authoritativePayload = {
    wallet_address: input.walletAddress,
    privy_user_id: input.privyUserId,
    email: normalizeEmail(input.email),
  };

  if (!existing) {
    const rows = await supabaseRequest<ProfileRow[]>(
      config,
      "users?select=id,telegram_id,wallet_address,privy_user_id,username,email,language",
      {
        method: "POST",
        headers: buildHeaders(config, {
          Prefer: "return=representation",
        }),
        body: JSON.stringify({
          ...authoritativePayload,
          telegram_id: input.telegramId,
          username: input.username,
          language: input.language ?? "en",
        }),
      },
    );

    await invalidateProfileCache(input.privyUserId);
    return rows[0];
  }

  const rows = await supabaseRequest<ProfileRow[]>(
    config,
    `users?id=eq.${existing.id}&privy_user_id=eq.${encodeURIComponent(input.privyUserId)}&select=id,telegram_id,wallet_address,privy_user_id,username,email,language`,
    {
      method: "PATCH",
      headers: buildHeaders(config, { Prefer: "return=representation" }),
      body: JSON.stringify({
        ...authoritativePayload,
        ...(input.telegramId
          ? { telegram_id: input.telegramId, username: input.username }
          : {}),
        ...(input.language ? { language: input.language } : {}),
      }),
    },
  );

  await invalidateProfileCache(input.privyUserId);
  return rows[0];
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

  await invalidateProfileCache(privyUserId);
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

/**
 * Record a user's first touch, once. Insert-if-absent (on_conflict do nothing),
 * so the first authenticated session's value is permanent and no later call can
 * change it. Idempotent: calling it every session is safe and cheap.
 */
export async function recordFirstTouch(
  config: ProfileConfig,
  userId: string,
  firstTouch: {
    source: "campaign" | "referral" | "direct";
    campaignCode: string | null;
    rawStartParam: string | null;
  },
): Promise<void> {
  await supabaseRequest<null>(
    config,
    "user_attribution?on_conflict=user_id",
    {
      body: JSON.stringify({
        user_id: userId,
        source: firstTouch.source,
        campaign_code: firstTouch.campaignCode,
        raw_start_param: firstTouch.rawStartParam,
      }),
      headers: buildHeaders(config, {
        Prefer: "resolution=ignore-duplicates,return=minimal",
      }),
      method: "POST",
    },
  );
}
