import type {
  LeaderboardEntry,
  QuestId,
  RewardKind,
  RewardLedgerEntry,
} from "../../../packages/types/src";
import { buildHeaders, supabaseRequest } from "../../_lib/supabase";
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

export interface RewardLedgerInsertInput {
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



function formatInList(values: string[]) {
  return `(${values.map((value) => `"${value}"`).join(",")})`;
}

/**
 * The season leaderboard, ranked and truncated by the database.
 *
 * This replaced a query that loaded every `user_points` row for the season and
 * every `users` row behind them into the function, sorted them in JS, and
 * returned ten — unbounded work and unbounded memory on a request path, growing
 * with the size of the program rather than the size of the answer.
 */
export async function getSeasonLeaderboard(
  config: RewardsConfig,
  seasonId: string,
  userId: string,
  limit = 10,
): Promise<LeaderboardEntry[]> {
  const rows = await supabaseRequest<
    Array<{
      alias: string;
      eligible_volume: string | number;
      is_current_user: boolean;
      rank: string | number;
      xp: string | number;
    }>
  >(config, "rpc/rewards_season_leaderboard", {
    body: JSON.stringify({ p_limit: limit, p_season_id: seasonId, p_user_id: userId }),
    headers: buildHeaders(config),
    method: "POST",
  });

  return rows.map((row) => ({
    alias: row.alias,
    eligibleVolume: Number(row.eligible_volume ?? 0),
    isCurrentUser: Boolean(row.is_current_user),
    rank: Number(row.rank ?? 0),
    xp: Number(row.xp ?? 0),
  }));
}

/** The caller's own rank, or null when they have no points row this season. */
export async function getSeasonUserRank(
  config: RewardsConfig,
  seasonId: string,
  userId: string,
): Promise<number | null> {
  const rank = await supabaseRequest<number | null>(
    config,
    "rpc/rewards_season_user_rank",
    {
      body: JSON.stringify({ p_season_id: seasonId, p_user_id: userId }),
      headers: buildHeaders(config),
      method: "POST",
    },
  );

  return rank == null ? null : Number(rank);
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

export async function getUserById(config: RewardsConfig, userId: string) {
  const rows = await supabaseRequest<RewardsUserRow[]>(
    config,
    `users?id=eq.${userId}&select=*`,
    { headers: buildHeaders(config) },
  );
  return rows[0] ?? null;
}

export async function getUserByReferralCode(config: RewardsConfig, referralCode: string) {
  const rows = await supabaseRequest<RewardsUserRow[]>(
    config,
    `users?referral_code=eq.${encodeURIComponent(referralCode)}&select=*`,
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
  input: { privyUserId: string },
) {
  const existing = await getUserByPrivyUserId(config, input.privyUserId);

  if (existing) {
    return existing;
  }

  const rows = await supabaseRequest<RewardsUserRow[]>(
    config,
    "users?select=*",
    {
      body: JSON.stringify({
        privy_user_id: input.privyUserId,
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


/**
 * The active season, or null. Never creates one.
 *
 * The read path uses this. Creating a season as a side effect of somebody
 * opening a page is how two first visitors in the same instant could each
 * create one, and nothing in the schema stops a second active season existing.
 */
export async function getActiveSeason(
  config: RewardsConfig,
  now = new Date(),
): Promise<RewardsSeasonRow | null> {
  const isoNow = now.toISOString();
  const seasons = await supabaseRequest<RewardsSeasonRow[]>(
    config,
    `seasons?is_active=eq.true&starts_at=lte.${encodeURIComponent(isoNow)}&ends_at=gt.${encodeURIComponent(
      isoNow,
    )}&select=*&order=starts_at.asc&limit=1`,
    { headers: buildHeaders(config) },
  );

  return seasons[0] ?? null;
}

/**
 * The active season, creating one if none exists.
 *
 * Reserved for write paths — the ingestion worker and the referral mutation.
 * A read must use getActiveSeason instead.
 */
/**
 * The season covering `now`, creating it only if none does.
 *
 * Delegates to an RPC so the check and the insert are one operation. Read then
 * insert from here meant two first-visitors in the same instant could create
 * two overlapping seasons, splitting the program's accounting with no way to
 * say which was canonical. An exclusion constraint on the date range now
 * decides the winner; see migration 012.
 */
export async function getOrCreateActiveSeason(config: RewardsConfig, now = new Date()) {
  const season = await supabaseRequest<RewardsSeasonRow | RewardsSeasonRow[]>(
    config,
    "rpc/rewards_get_or_create_active_season",
    {
      body: JSON.stringify({
        p_now: now.toISOString(),
        p_weekly_pool: config.weeklyRewardPoolUsd,
      }),
      headers: buildHeaders(config),
      method: "POST",
    },
  );

  return (Array.isArray(season) ? season[0] : season) as RewardsSeasonRow;
}

export type ReferrerClaimOutcome = "ok" | "already_set" | "self_referral";

/**
 * Link a referrer, if none is set and it is not the user themselves.
 *
 * The condition lives in the UPDATE rather than in a preceding read, so two
 * codes applied at once cannot both pass the check and have the second
 * overwrite the first.
 */
export async function claimReferrer(
  config: RewardsConfig,
  userId: string,
  referrerId: string,
): Promise<ReferrerClaimOutcome> {
  const outcome = await supabaseRequest<string>(config, "rpc/rewards_claim_referrer", {
    body: JSON.stringify({ p_referrer_id: referrerId, p_user_id: userId }),
    headers: buildHeaders(config),
    method: "POST",
  });

  return outcome as ReferrerClaimOutcome;
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
        // Append-only. merge-duplicates made every sync a blind UPDATE of any
        // row sharing an idempotency key, so re-running a sync over a cash
        // entry that had already been paid reset it to 'pending' and offered
        // it for payment again. Ingestion may create a ledger row; it may
        // never restate one that already exists.
        //
        // This changes what comes back: PostgREST returns only the rows it
        // actually inserted, so an all-duplicate write returns []. Callers
        // needing the full set must re-read.
        Prefer: "resolution=ignore-duplicates,return=representation",
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

/**
 * A page of a user's reward history, for display.
 *
 * This is a display query and nothing more. It used to double as the input to
 * the XP total, which meant the cap below silently became the accounting
 * horizon — see getSeasonXpTotals, which asks the database instead.
 */
export async function getRewardLedgerEntries(
  config: RewardsConfig,
  userId: string,
  limit = 100,
  offset = 0,
) {
  const rows = await supabaseRequest<SupabaseRewardLedgerRow[]>(
    config,
    `reward_ledger?user_id=eq.${userId}&select=*&order=created_at.desc&limit=${Math.max(1, Math.min(limit, 200))}&offset=${Math.max(0, offset)}`,
    { headers: buildHeaders(config) },
  );

  return rows.map(mapRewardLedgerRow);
}

export interface SeasonXpTotals {
  questXp: number;
  referralBonusXp: number;
  totalXp: number;
  volumeXp: number;
}

/**
 * Season XP totals, aggregated by the database over every applicable row.
 *
 * The previous implementation summed the reward history the dashboard had
 * already fetched for display — capped at 150 rows, newest first. Past 150
 * entries a user's XP was recomputed from a recent window and written back
 * over the projection, so the total fell as they earned more. Volume XP writes
 * one row per fill, so that ceiling is not far away.
 *
 * Sources outside the three named below are counted in totalXp but have no
 * breakdown field; the total is the sum of the rows, not of the fields.
 */
export async function getSeasonXpTotals(
  config: RewardsConfig,
  userId: string,
  seasonId: string,
): Promise<SeasonXpTotals> {
  const rows = await supabaseRequest<Array<{ source: string; xp: string | number }>>(
    config,
    "rpc/rewards_season_xp_totals",
    {
      body: JSON.stringify({ p_season_id: seasonId, p_user_id: userId }),
      headers: buildHeaders(config),
      method: "POST",
    },
  );

  const bySource = new Map(rows.map((row) => [row.source, Number(row.xp ?? 0)]));

  return {
    questXp: bySource.get("quest") ?? 0,
    referralBonusXp: bySource.get("referral_bonus") ?? 0,
    totalXp: rows.reduce((sum, row) => sum + Number(row.xp ?? 0), 0),
    volumeXp: bySource.get("volume_xp") ?? 0,
  };
}

export interface XpProjectionDriftRow {
  driftXp: number;
  ledgerXp: number;
  projectedXp: number;
  userId: string;
}

/**
 * Users whose stored XP disagrees with the ledger. Reports; never writes.
 *
 * A reconciliation tool that mutates by default cannot answer "is anything
 * wrong?", because running it destroys the evidence of what was wrong.
 */
export async function getXpProjectionDrift(
  config: RewardsConfig,
  seasonId: string,
): Promise<XpProjectionDriftRow[]> {
  const rows = await supabaseRequest<
    Array<{ drift: string | number; ledger_xp: string | number; projected_xp: string | number; user_id: string }>
  >(config, "rpc/rewards_xp_projection_drift", {
    body: JSON.stringify({ p_season_id: seasonId }),
    headers: buildHeaders(config),
    method: "POST",
  });

  return rows.map((row) => ({
    driftXp: Number(row.drift ?? 0),
    ledgerXp: Number(row.ledger_xp ?? 0),
    projectedXp: Number(row.projected_xp ?? 0),
    userId: row.user_id,
  }));
}

/** Rebuild the XP projection for a season from the ledger. Returns rows changed. */
export async function rebuildXpProjection(
  config: RewardsConfig,
  seasonId: string,
): Promise<number> {
  const updated = await supabaseRequest<number>(config, "rpc/rewards_rebuild_xp_projection", {
    body: JSON.stringify({ p_season_id: seasonId }),
    headers: buildHeaders(config),
    method: "POST",
  });

  return Number(updated ?? 0);
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

/**
 * Fill keys that already earned volume XP, for deduplicating a fresh fill list.
 *
 * A fill key is `tid:hash:oid` and the idempotency key embedding it is
 * `volume_xp:season:user:tid:hash:oid`. Splitting on ":" and taking the last
 * segment therefore yielded the order id alone, which matches no fill key the
 * grant builder compares against — so the returned set suppressed nothing and
 * every sync re-derived grants across the user's whole history. The unique
 * index on idempotency_key was the only thing stopping that duplicating XP.
 *
 * Prefer the key recorded in metadata; otherwise strip exactly the known
 * prefix, so the remainder is the whole fill key however many colons it holds.
 */
export async function getExistingVolumeXpFillKeys(
  config: RewardsConfig,
  userId: string,
  seasonId: string,
) {
  const rows = await supabaseRequest<
    Array<{ idempotency_key: string; metadata: Record<string, unknown> | null }>
  >(
    config,
    `reward_ledger?user_id=eq.${userId}&season_id=eq.${seasonId}&source=eq.volume_xp&select=idempotency_key,metadata`,
    { headers: buildHeaders(config) },
  );

  const prefix = `volume_xp:${seasonId}:${userId}:`;

  return new Set(
    rows.map((row) => {
      const stored = row.metadata?.fillKey;
      if (typeof stored === "string" && stored.length > 0) {
        return stored;
      }

      return row.idempotency_key.startsWith(prefix)
        ? row.idempotency_key.slice(prefix.length)
        : row.idempotency_key;
    }),
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
        // Still a merge, unlike the append-only ledger write, and
        // deliberately so: this table caches an answer the ledger owns, so
        // overwriting it with a freshly computed value is the entire point.
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
        // Still a merge, unlike the append-only ledger write, and
        // deliberately so: this table caches an answer the ledger owns, so
        // overwriting it with a freshly computed value is the entire point.
        Prefer: "resolution=merge-duplicates,return=representation",
      }),
      method: "POST",
    },
  );

  return rows[0];
}

/**
 * Take exclusive ownership of a week's raffle draw.
 *
 * Returns false when another runner already holds it. See migration
 * 006_weekly_raffle_runs.sql for why the pre-draw winners check was not enough.
 */
export async function claimWeeklyRaffleRun(
  config: RewardsConfig,
  seasonId: string,
  weekStart: string,
): Promise<boolean> {
  const claimed = await supabaseRequest<boolean>(config, "rpc/claim_weekly_raffle_run", {
    body: JSON.stringify({ p_season_id: seasonId, p_week_start: weekStart }),
    headers: buildHeaders(config),
    method: "POST",
  });
  return claimed === true;
}

export async function completeWeeklyRaffleRun(
  config: RewardsConfig,
  seasonId: string,
  weekStart: string,
  winnerCount: number,
  error: string | null = null,
): Promise<void> {
  await supabaseRequest<null>(config, "rpc/complete_weekly_raffle_run", {
    body: JSON.stringify({
      p_error: error,
      p_season_id: seasonId,
      p_week_start: weekStart,
      p_winner_count: winnerCount,
    }),
    headers: buildHeaders(config),
    method: "POST",
  });
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

/**
 * Quests this user has already been paid for, this season.
 *
 * The read path takes trade-derived quest completion from here rather than
 * recomputing it: it has no fills, because ingestion is scheduled and a
 * dashboard read performs no exchange I/O.
 */
export async function getGrantedQuestIds(
  config: RewardsConfig,
  userId: string,
  seasonId: string,
): Promise<QuestId[]> {
  const rows = await supabaseRequest<Array<{ quest_id: string | null }>>(
    config,
    `reward_ledger?user_id=eq.${userId}&season_id=eq.${seasonId}&source=eq.quest&quest_id=not.is.null&select=quest_id`,
    { headers: buildHeaders(config) },
  );

  return [...new Set(rows.map((row) => row.quest_id).filter((id): id is string => Boolean(id)))] as QuestId[];
}

// ---------------------------------------------------------------------------
// Fill ingestion checkpoints
// ---------------------------------------------------------------------------

export interface FillSyncClaim {
  checkpointId: string;
  cursorTime: string;
  fillsIngested: number;
  seasonId: string;
  userId: string;
  walletAddress: string;
}

export interface FillCheckpointStatus {
  cursorTime: string;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  retentionRisk: boolean;
}

/**
 * Claim a bounded batch of accounts to sync.
 *
 * The claim is what stops two overlapping worker runs from fetching the same
 * account and racing each other's cursor advance; see migration 009.
 */
export async function claimFillSyncBatch(
  config: RewardsConfig,
  input: { limit?: number; staleAfterSeconds?: number } = {},
): Promise<FillSyncClaim[]> {
  const rows = await supabaseRequest<
    Array<{
      checkpoint_id: string;
      cursor_time: string;
      fills_ingested: string | number;
      season_id: string;
      user_id: string;
      wallet_address: string;
    }>
  >(config, "rpc/rewards_claim_fill_sync_batch", {
    body: JSON.stringify({
      p_limit: input.limit ?? 25,
      p_stale_after_seconds: input.staleAfterSeconds ?? 900,
    }),
    headers: buildHeaders(config),
    method: "POST",
  });

  return rows.map((row) => ({
    checkpointId: row.checkpoint_id,
    cursorTime: row.cursor_time,
    fillsIngested: Number(row.fills_ingested ?? 0),
    seasonId: row.season_id,
    userId: row.user_id,
    walletAddress: row.wallet_address,
  }));
}

/**
 * Record one account's outcome. Advances the cursor only when one is supplied,
 * so a failure reports itself without disturbing proven progress.
 */
export async function completeFillSync(
  config: RewardsConfig,
  input: {
    checkpointId: string;
    cursorTime?: string;
    errorCode?: string | null;
    fillsIngested?: number;
    retentionRisk?: boolean;
  },
): Promise<void> {
  await supabaseRequest<null>(config, "rpc/rewards_complete_fill_sync", {
    body: JSON.stringify({
      p_checkpoint_id: input.checkpointId,
      p_cursor_time: input.cursorTime ?? null,
      p_error_code: input.errorCode ?? null,
      p_fills_ingested: input.fillsIngested ?? 0,
      p_retention_risk: input.retentionRisk ?? null,
    }),
    headers: buildHeaders(config),
    method: "POST",
  });
}

/** Create checkpoints for wallet-holding users in a season that lack one. */
export async function backfillFillCheckpoints(
  config: RewardsConfig,
  input: { limit?: number; seasonId: string; startAt: string },
): Promise<number> {
  const created = await supabaseRequest<number>(
    config,
    "rpc/rewards_backfill_fill_checkpoints",
    {
      body: JSON.stringify({
        p_limit: input.limit ?? 500,
        p_season_id: input.seasonId,
        p_start_at: input.startAt,
      }),
      headers: buildHeaders(config),
      method: "POST",
    },
  );

  return Number(created ?? 0);
}

/**
 * The ingestion state behind one user's dashboard, or null before a first run.
 *
 * Read-only: the dashboard reports how fresh its numbers are, it does not make
 * them fresher.
 */
export async function getFillCheckpointStatus(
  config: RewardsConfig,
  userId: string,
  seasonId: string,
): Promise<FillCheckpointStatus | null> {
  const rows = await supabaseRequest<
    Array<{
      consecutive_failures: number;
      cursor_time: string;
      last_success_at: string | null;
      retention_risk: boolean;
    }>
  >(
    config,
    `rewards_fill_checkpoints?user_id=eq.${userId}&season_id=eq.${seasonId}&select=cursor_time,last_success_at,consecutive_failures,retention_risk&order=last_success_at.desc.nullslast&limit=1`,
    { headers: buildHeaders(config) },
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    cursorTime: row.cursor_time,
    lastSuccessAt: row.last_success_at,
    retentionRisk: Boolean(row.retention_risk),
  };
}
