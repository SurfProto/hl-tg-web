import type { LeaderboardEntry, RewardKind, RewardLedgerEntry } from "../../../packages/types/src";
import type { RewardsConfig } from "./config";

export interface RewardsUserRow {
  id: string;
  created_at: string;
  email: string | null;
  privy_user_id: string | null;
  referral_code: string | null;
  referred_by: string | null;
  username: string | null;
  wallet_address: string | null;
}

export interface RewardsSeasonRow {
  ends_at: string;
  id: string;
  is_active: boolean;
  name: string;
  reward_pool_weekly: string | null;
  starts_at: string;
}

export interface UserPointsRow {
  id: string;
  multiplier: string;
  referral_volume: string;
  season_id: string;
  total_volume: string;
  updated_at: string;
  user_id: string;
  xp: string;
}

export interface WeeklyRewardRow {
  claimed: boolean;
  drawn_at: string | null;
  id: string;
  pool_share: string;
  raffle_eligible: boolean;
  raffle_prize: string;
  raffle_rank: number | null;
  season_id: string;
  user_id: string;
  user_volume: string;
  week_start: string;
}

interface SupabaseDepositRow {
  created_at: string;
  fee_amount: string | null;
  id: string;
  last_synced_at: string | null;
  payin_amount: string | null;
  payout_amount: string | null;
  provider_touched_at: string | null;
}

interface RewardLedgerInsertInput {
  amount: number;
  asset: string | null;
  description: string;
  idempotencyKey: string;
  metadata: Record<string, unknown> | null;
  postedAt: string | null;
  questId: string | null;
  rewardKind: RewardKind;
  seasonId: string | null;
  source: string;
  status: "pending" | "posted" | "failed";
  userId: string;
  weekStart: string | null;
}

interface SupabaseRewardLedgerRow {
  amount: string;
  asset: string | null;
  created_at: string;
  description: string;
  id: string;
  idempotency_key: string;
  metadata: Record<string, unknown> | null;
  posted_at: string | null;
  quest_id: string | null;
  reward_kind: RewardKind;
  season_id: string | null;
  source: string;
  status: "pending" | "posted" | "failed";
  user_id: string;
  week_start: string | null;
}

function looksLikeHtml(body: string): boolean {
  const trimmed = body.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

function buildHeaders(config: RewardsConfig, extra?: Record<string, string>) {
  return {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function supabaseRequest<T>(
  config: RewardsConfig,
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

function monthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function nextMonthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function formatInList(values: string[]) {
  return `(${values.map((value) => `"${value}"`).join(",")})`;
}

function toLeaderboardEntries(
  pointsRows: UserPointsRow[],
  usersById: Map<string, RewardsUserRow>,
): Array<Omit<LeaderboardEntry, "rank" | "raffleEligible">> {
  return pointsRows.map((row) => ({
    displayName:
      usersById.get(row.user_id)?.username ??
      truncateAddress(usersById.get(row.user_id)?.wallet_address) ??
      "Trader",
    eligibleVolume: Number(row.total_volume ?? 0),
    userId: row.user_id,
    xp: Number(row.xp ?? 0),
  }));
}

function truncateAddress(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function mapRewardLedgerRow(row: SupabaseRewardLedgerRow): RewardLedgerEntry {
  return {
    amount: Number(row.amount ?? 0),
    asset: row.asset,
    createdAt: row.created_at,
    description: row.description,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    metadata: row.metadata,
    postedAt: row.posted_at,
    questId: row.quest_id as RewardLedgerEntry["questId"],
    rewardKind: row.reward_kind,
    seasonId: row.season_id,
    source: row.source,
    status: row.status,
    userId: row.user_id,
    weekStart: row.week_start,
  };
}

export async function getUserByPrivyUserId(config: RewardsConfig, privyUserId: string) {
  const rows = await supabaseRequest<RewardsUserRow[]>(
    config,
    `users?privy_user_id=eq.${encodeURIComponent(privyUserId)}&select=*`,
    { headers: buildHeaders(config) },
  );
  return rows[0] ?? null;
}

async function getUserByWalletAddress(config: RewardsConfig, walletAddress: string) {
  const rows = await supabaseRequest<RewardsUserRow[]>(
    config,
    `users?wallet_address=eq.${encodeURIComponent(walletAddress)}&select=*`,
    { headers: buildHeaders(config) },
  );
  return rows[0] ?? null;
}

export async function getUserById(config: RewardsConfig, userId: string) {
  const rows = await supabaseRequest<RewardsUserRow[]>(
    config,
    `users?id=eq.${userId}&select=*`,
    { headers: buildHeaders(config) },
  );
  return rows[0] ?? null;
}

export async function getUsersByIds(config: RewardsConfig, userIds: string[]) {
  if (userIds.length === 0) {
    return [];
  }

  return supabaseRequest<RewardsUserRow[]>(
    config,
    `users?id=in.${formatInList(userIds)}&select=*`,
    { headers: buildHeaders(config) },
  );
}

export async function getOrCreateRewardsUser(
  config: RewardsConfig,
  input: { privyUserId: string; walletAddress: string | null; username: string | null },
) {
  const existing =
    (await getUserByPrivyUserId(config, input.privyUserId)) ??
    (input.walletAddress ? await getUserByWalletAddress(config, input.walletAddress) : null);

  if (existing) {
    const rows = await supabaseRequest<RewardsUserRow[]>(
      config,
      `users?id=eq.${existing.id}&select=*`,
      {
        body: JSON.stringify({
          privy_user_id: input.privyUserId,
          username: input.username ?? existing.username,
          wallet_address: input.walletAddress ?? existing.wallet_address,
        }),
        headers: buildHeaders(config, { Prefer: "return=representation" }),
        method: "PATCH",
      },
    );
    return rows[0];
  }

  const rows = await supabaseRequest<RewardsUserRow[]>(
    config,
    "users?select=*",
    {
      body: JSON.stringify({
        privy_user_id: input.privyUserId,
        username: input.username,
        wallet_address: input.walletAddress,
      }),
      headers: buildHeaders(config, { Prefer: "return=representation" }),
      method: "POST",
    },
  );

  return rows[0];
}

export async function ensureReferralCode(config: RewardsConfig, user: RewardsUserRow) {
  if (user.referral_code) {
    return user;
  }

  const referralCode = user.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  const rows = await supabaseRequest<RewardsUserRow[]>(
    config,
    `users?id=eq.${user.id}&select=*`,
    {
      body: JSON.stringify({ referral_code: referralCode }),
      headers: buildHeaders(config, { Prefer: "return=representation" }),
      method: "PATCH",
    },
  );
  return rows[0];
}

export async function applyReferralCodeIfEligible(
  config: RewardsConfig,
  input: { referralCode: string | null; user: RewardsUserRow },
) {
  if (!input.referralCode || input.user.referred_by || input.user.referral_code === input.referralCode) {
    return input.user;
  }

  const referrers = await supabaseRequest<RewardsUserRow[]>(
    config,
    `users?referral_code=eq.${encodeURIComponent(input.referralCode)}&select=*`,
    { headers: buildHeaders(config) },
  );
  const referrer = referrers[0];
  if (!referrer || referrer.id === input.user.id) {
    return input.user;
  }

  const rows = await supabaseRequest<RewardsUserRow[]>(
    config,
    `users?id=eq.${input.user.id}&select=*`,
    {
      body: JSON.stringify({ referred_by: referrer.id }),
      headers: buildHeaders(config, { Prefer: "return=representation" }),
      method: "PATCH",
    },
  );
  return rows[0];
}

export async function getOrCreateActiveSeason(config: RewardsConfig, now = new Date()) {
  const isoNow = now.toISOString();
  const seasons = await supabaseRequest<RewardsSeasonRow[]>(
    config,
    `seasons?is_active=eq.true&starts_at=lte.${encodeURIComponent(isoNow)}&ends_at=gt.${encodeURIComponent(
      isoNow,
    )}&select=*&order=starts_at.asc&limit=1`,
    { headers: buildHeaders(config) },
  );
  const activeSeason = seasons[0];
  if (activeSeason) {
    return activeSeason;
  }

  const start = monthStart(now);
  const end = nextMonthStart(now);
  const rows = await supabaseRequest<RewardsSeasonRow[]>(
    config,
    "seasons?select=*",
    {
      body: JSON.stringify({
        ends_at: end.toISOString(),
        is_active: true,
        name: start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
        reward_pool_weekly: config.weeklyRewardPoolUsd,
        starts_at: start.toISOString(),
      }),
      headers: buildHeaders(config, { Prefer: "return=representation" }),
      method: "POST",
    },
  );
  return rows[0];
}

export async function getSuccessfulOnrampDeposits(
  config: RewardsConfig,
  userId: string,
  seasonStart: string,
) {
  const rows = await supabaseRequest<SupabaseDepositRow[]>(
    config,
    `onramp_orders?user_id=eq.${userId}&app_state=eq.success&created_at=gte.${encodeURIComponent(
      seasonStart,
    )}&select=id,payout_amount,payin_amount,fee_amount,provider_touched_at,last_synced_at,created_at&order=created_at.asc`,
    { headers: buildHeaders(config) },
  );

  return rows.map((row) => {
    const payoutAmount = Number(row.payout_amount ?? 0);
    const payinAmount = Number(row.payin_amount ?? 0);
    const feeAmount = Number(row.fee_amount ?? 0);

    return {
      amountUsd: payoutAmount > 0 ? payoutAmount : Math.max(payinAmount - feeAmount, 0),
      id: row.id,
      occurredAt: row.provider_touched_at ?? row.last_synced_at ?? row.created_at,
    };
  });
}

export async function getFundedReferralStats(
  config: RewardsConfig,
  referrerId: string,
  seasonStart: string,
  fundedDepositThresholdUsd: number,
) {
  const referredUsers = await supabaseRequest<RewardsUserRow[]>(
    config,
    `users?referred_by=eq.${referrerId}&select=*`,
    { headers: buildHeaders(config) },
  );

  if (referredUsers.length === 0) {
    return { fundedReferralCount: 0, fundedReferralVolume: 0, referredCount: 0 };
  }

  const orders = await supabaseRequest<Array<{ user_id: string; payout_amount: string | null; payin_amount: string | null; fee_amount: string | null }>>(
    config,
    `onramp_orders?user_id=in.${formatInList(
      referredUsers.map((user) => user.id),
    )}&app_state=eq.success&created_at=gte.${encodeURIComponent(
      seasonStart,
    )}&select=user_id,payout_amount,payin_amount,fee_amount`,
    { headers: buildHeaders(config) },
  );

  const volumeByUser = new Map<string, number>();
  for (const order of orders) {
    const payoutAmount = Number(order.payout_amount ?? 0);
    const payinAmount = Number(order.payin_amount ?? 0);
    const feeAmount = Number(order.fee_amount ?? 0);
    const amount = payoutAmount > 0 ? payoutAmount : Math.max(payinAmount - feeAmount, 0);
    if (amount <= 0) {
      continue;
    }

    volumeByUser.set(order.user_id, (volumeByUser.get(order.user_id) ?? 0) + amount);
  }

  const fundedUsers = [...volumeByUser.entries()].filter(([, amount]) => amount >= fundedDepositThresholdUsd);

  return {
    fundedReferralCount: fundedUsers.length,
    fundedReferralVolume: fundedUsers.reduce((sum, [, amount]) => sum + amount, 0),
    referredCount: referredUsers.length,
  };
}

export async function upsertRewardLedgerEntries(
  config: RewardsConfig,
  entries: RewardLedgerInsertInput[],
) {
  if (entries.length === 0) {
    return [];
  }

  const rows = await supabaseRequest<SupabaseRewardLedgerRow[]>(
    config,
    "reward_ledger?on_conflict=idempotency_key&select=*",
    {
      body: JSON.stringify(
        entries.map((entry) => ({
          amount: entry.amount,
          asset: entry.asset,
          description: entry.description,
          idempotency_key: entry.idempotencyKey,
          metadata: entry.metadata,
          posted_at: entry.postedAt,
          quest_id: entry.questId,
          reward_kind: entry.rewardKind,
          season_id: entry.seasonId,
          source: entry.source,
          status: entry.status,
          user_id: entry.userId,
          week_start: entry.weekStart,
        })),
      ),
      headers: buildHeaders(config, {
        Prefer: "resolution=merge-duplicates,return=representation",
      }),
      method: "POST",
    },
  );

  return rows.map(mapRewardLedgerRow);
}

export async function updateRewardLedgerStatus(
  config: RewardsConfig,
  ledgerId: string,
  input: {
    metadata?: Record<string, unknown> | null;
    postedAt?: string | null;
    status: "pending" | "posted" | "failed";
  },
) {
  const rows = await supabaseRequest<SupabaseRewardLedgerRow[]>(
    config,
    `reward_ledger?id=eq.${ledgerId}&select=*`,
    {
      body: JSON.stringify({
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        ...(input.postedAt !== undefined ? { posted_at: input.postedAt } : {}),
        status: input.status,
      }),
      headers: buildHeaders(config, { Prefer: "return=representation" }),
      method: "PATCH",
    },
  );

  return mapRewardLedgerRow(rows[0]);
}

export async function getRewardLedgerEntries(
  config: RewardsConfig,
  userId: string,
  limit = 100,
) {
  const rows = await supabaseRequest<SupabaseRewardLedgerRow[]>(
    config,
    `reward_ledger?user_id=eq.${userId}&select=*&order=created_at.desc&limit=${Math.max(1, Math.min(limit, 200))}`,
    { headers: buildHeaders(config) },
  );

  return rows.map(mapRewardLedgerRow);
}

export async function getRewardLedgerEntriesBySource(
  config: RewardsConfig,
  input: {
    limit?: number;
    seasonId?: string | null;
    source: string;
    weekStart?: string | null;
  },
) {
  const filters = [
    `source=eq.${encodeURIComponent(input.source)}`,
    input.seasonId ? `season_id=eq.${input.seasonId}` : null,
    input.weekStart ? `week_start=eq.${encodeURIComponent(input.weekStart)}` : null,
    `select=*`,
    `order=created_at.desc`,
    `limit=${Math.max(1, Math.min(input.limit ?? 50, 200))}`,
  ]
    .filter(Boolean)
    .join("&");

  const rows = await supabaseRequest<SupabaseRewardLedgerRow[]>(
    config,
    `reward_ledger?${filters}`,
    { headers: buildHeaders(config) },
  );

  return rows.map(mapRewardLedgerRow);
}

export async function getExistingVolumeXpFillKeys(
  config: RewardsConfig,
  userId: string,
  seasonId: string,
) {
  const rows = await supabaseRequest<Array<{ idempotency_key: string }>>(
    config,
    `reward_ledger?user_id=eq.${userId}&season_id=eq.${seasonId}&source=eq.volume_xp&select=idempotency_key`,
    { headers: buildHeaders(config) },
  );

  return new Set(
    rows.map((row) => row.idempotency_key.split(":").slice(-1)[0] ?? row.idempotency_key),
  );
}

export async function upsertUserPoints(
  config: RewardsConfig,
  input: {
    multiplier?: number;
    referralVolume: number;
    seasonId: string;
    totalVolume: number;
    userId: string;
    xp: number;
  },
) {
  const rows = await supabaseRequest<UserPointsRow[]>(
    config,
    "user_points?on_conflict=user_id,season_id&select=*",
    {
      body: JSON.stringify({
        multiplier: input.multiplier ?? 1,
        referral_volume: input.referralVolume,
        season_id: input.seasonId,
        total_volume: input.totalVolume,
        updated_at: new Date().toISOString(),
        user_id: input.userId,
        xp: input.xp,
      }),
      headers: buildHeaders(config, {
        Prefer: "resolution=merge-duplicates,return=representation",
      }),
      method: "POST",
    },
  );

  return rows[0];
}

export async function getUserPointsForSeason(
  config: RewardsConfig,
  userId: string,
  seasonId: string,
) {
  const rows = await supabaseRequest<UserPointsRow[]>(
    config,
    `user_points?user_id=eq.${userId}&season_id=eq.${seasonId}&select=*`,
    { headers: buildHeaders(config) },
  );
  return rows[0] ?? null;
}

export async function getSeasonLeaderboardRows(config: RewardsConfig, seasonId: string) {
  const pointsRows = await supabaseRequest<UserPointsRow[]>(
    config,
    `user_points?season_id=eq.${seasonId}&select=*`,
    { headers: buildHeaders(config) },
  );
  const users = await getUsersByIds(
    config,
    [...new Set(pointsRows.map((row) => row.user_id))],
  );
  const usersById = new Map(users.map((user) => [user.id, user]));
  return toLeaderboardEntries(pointsRows, usersById);
}

export async function upsertWeeklyReward(config: RewardsConfig, input: {
  seasonId: string;
  userId: string;
  userVolume: number;
  weekStart: string;
}) {
  const rows = await supabaseRequest<WeeklyRewardRow[]>(
    config,
    "weekly_rewards?on_conflict=user_id,season_id,week_start&select=*",
    {
      body: JSON.stringify({
        season_id: input.seasonId,
        user_id: input.userId,
        user_volume: input.userVolume,
        week_start: input.weekStart,
      }),
      headers: buildHeaders(config, {
        Prefer: "resolution=merge-duplicates,return=representation",
      }),
      method: "POST",
    },
  );

  return rows[0];
}

export async function getWeeklyVolumeRows(
  config: RewardsConfig,
  seasonId: string,
  weekStart: string,
) {
  return supabaseRequest<WeeklyRewardRow[]>(
    config,
    `weekly_rewards?season_id=eq.${seasonId}&week_start=eq.${encodeURIComponent(weekStart)}&select=*&order=user_volume.desc`,
    { headers: buildHeaders(config) },
  );
}

export async function patchWeeklyReward(
  config: RewardsConfig,
  weeklyRewardId: string,
  input: Partial<Pick<WeeklyRewardRow, "drawn_at" | "raffle_eligible" | "raffle_prize" | "raffle_rank">>,
) {
  const rows = await supabaseRequest<WeeklyRewardRow[]>(
    config,
    `weekly_rewards?id=eq.${weeklyRewardId}&select=*`,
    {
      body: JSON.stringify(input),
      headers: buildHeaders(config, { Prefer: "return=representation" }),
      method: "PATCH",
    },
  );
  return rows[0];
}
