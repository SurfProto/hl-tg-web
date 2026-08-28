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
  /** The identity the channel-membership quest is verified against. */
  telegram_id: string | null;
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

export interface SeasonUserStanding {
  eligibleVolume: number;
  rank: number | null;
  xp: number;
}

/**
 * The caller's own rank, volume and XP for the season.
 *
 * Ranked across the whole season, so it is correct at any position. The
 * dashboard used to read its own volume out of the leaderboard page — which is
 * the top ten — so anyone below that saw their own trading volume as zero.
 */
export async function getSeasonUserStanding(
  config: RewardsConfig,
  seasonId: string,
  userId: string,
): Promise<SeasonUserStanding> {
  const rows = await supabaseRequest<
    Array<{ eligible_volume: string | number; rank: string | number; xp: string | number }>
  >(config, "rpc/rewards_season_user_standing", {
    body: JSON.stringify({ p_season_id: seasonId, p_user_id: userId }),
    headers: buildHeaders(config),
    method: "POST",
  });

  const row = rows[0];
  return {
    eligibleVolume: Number(row?.eligible_volume ?? 0),
    rank: row?.rank == null ? null : Number(row.rank),
    xp: Number(row?.xp ?? 0),
  };
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

/**
 * Money that arrived in this account, from wherever it came.
 *
 * This used to read `onramp_orders`, which records only card purchases we
 * brokered — so a user who bridged their own USDC in had funded nothing as far
 * as the quests were concerned. The account's own ledger is a superset: an
 * onramp purchase lands on it as a `deposit` like any other bridge transfer.
 * See migration 020.
 *
 * Inflows only. Withdrawals are stored on the same table with a negative
 * amount, and the referral rung nets them off, but a quest asking "have you
 * ever deposited" is answered by arrivals.
 */
export async function getQualifyingDeposits(
  config: RewardsConfig,
  userId: string,
  since: string,
) {
  const rows = await supabaseRequest<
    Array<{ amount_usd: string | number; id: string; occurred_at: string }>
  >(
    config,
    `hl_deposits?user_id=eq.${userId}&is_external=is.true&amount_usd=gt.0&occurred_at=gte.${encodeURIComponent(
      since,
    )}&select=id,amount_usd,occurred_at&order=occurred_at.asc`,
    { headers: buildHeaders(config) },
  );

  return rows.map((row) => ({
    amountUsd: Number(row.amount_usd ?? 0),
    id: row.id,
    occurredAt: row.occurred_at,
  }));
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

  const events = await supabaseRequest<Array<{ amount_usd: string | number; user_id: string }>>(
    config,
    `hl_deposits?user_id=in.${formatInList(
      referredUsers.map((user) => user.id),
    )}&is_external=is.true&amount_usd=gt.0&occurred_at=gte.${encodeURIComponent(
      seasonStart,
    )}&select=user_id,amount_usd`,
    { headers: buildHeaders(config) },
  );

  const volumeByUser = new Map<string, number>();
  for (const event of events) {
    const amount = Number(event.amount_usd ?? 0);
    if (amount <= 0) {
      continue;
    }

    volumeByUser.set(event.user_id, (volumeByUser.get(event.user_id) ?? 0) + amount);
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
  /** XP for showing up, as opposed to trading. */
  checkInXp: number;
  questXp: number;
  referralBonusXp: number;
  /** Rank multiplier, carried as its own source rather than folded into the rest. */
  tierBonusXp: number;
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
    checkInXp: bySource.get("daily_check_in") ?? 0,
    questXp: bySource.get("quest") ?? 0,
    referralBonusXp: bySource.get("referral_bonus") ?? 0,
    tierBonusXp: bySource.get("tier_bonus") ?? 0,
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

// ---------------------------------------------------------------------------
// Deposit ledger ingestion
// ---------------------------------------------------------------------------

export interface DepositEventInsert {
  amountUsd: number;
  eventKey: string;
  eventType: string;
  isExternal: boolean;
  occurredAt: string;
  userId: string;
  walletAddress: string;
}

/**
 * The instant this account's ledger has provably been read to, creating the
 * checkpoint on first sight. New checkpoints start at the epoch, so a first run
 * reads the account's whole history.
 */
export async function openDepositSync(
  config: RewardsConfig,
  account: { userId: string; walletAddress: string },
): Promise<string> {
  const cursor = await supabaseRequest<string | null>(config, "rpc/rewards_open_deposit_sync", {
    body: JSON.stringify({
      p_user_id: account.userId,
      p_wallet_address: account.walletAddress,
    }),
    headers: buildHeaders(config),
    method: "POST",
  });

  return cursor ?? new Date(0).toISOString();
}

/** Record the outcome. Advances the cursor only when one is supplied. */
export async function completeDepositSync(
  config: RewardsConfig,
  input: {
    cursorTime?: string;
    errorCode?: string | null;
    eventsIngested?: number;
    userId: string;
    walletAddress: string;
  },
): Promise<void> {
  await supabaseRequest<null>(config, "rpc/rewards_complete_deposit_sync", {
    body: JSON.stringify({
      p_cursor_time: input.cursorTime ?? null,
      p_error_code: input.errorCode ?? null,
      p_events_ingested: input.eventsIngested ?? 0,
      p_user_id: input.userId,
      p_wallet_address: input.walletAddress,
    }),
    headers: buildHeaders(config),
    method: "POST",
  });
}

/**
 * Append ledger events, ignoring ones already recorded.
 *
 * `ignore-duplicates` rather than `merge-duplicates` for the same reason the
 * reward ledger uses it: this is a record of what the exchange said happened,
 * and re-reading a window may add to it but must never restate it. A change to
 * how events are classified is therefore a recomputation over the stored type
 * and amount, not a silent rewrite on the next sync.
 */
export async function upsertDepositEvents(
  config: RewardsConfig,
  events: DepositEventInsert[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }

  await supabaseRequest<null>(config, "hl_deposits?on_conflict=user_id,event_key", {
    body: JSON.stringify(
      events.map((event) => ({
        amount_usd: event.amountUsd,
        event_key: event.eventKey,
        event_type: event.eventType,
        is_external: event.isExternal,
        occurred_at: event.occurredAt,
        user_id: event.userId,
        wallet_address: event.walletAddress,
      })),
    ),
    headers: buildHeaders(config, {
      Prefer: "resolution=ignore-duplicates,return=minimal",
    }),
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface ReconciliationReport {
  accountsTotal: number;
  accountsNeverSynced: number;
  accountsStale: number;
  accountsFailing: number;
  accountsRetentionRisk: number;
  maxIngestionLagSeconds: number;
  oldestCursorTime: string | null;
  fillsIngested: number;
  walletsWithoutCheckpoint: number;
  driftAccounts: number;
  driftTotalXp: number;
  heldCashRows: number;
  heldCashAmount: number;
}

/**
 * Program health for one season, as a single row.
 *
 * Every fact here was already available, but only as six unrelated queries
 * somebody had to know to run and how to read. Nobody runs that, so drift got
 * found by a user noticing their XP was wrong.
 */
export async function getReconciliationReport(
  config: RewardsConfig,
  seasonId: string,
  options: { failingAfterAttempts?: number; staleAfterSeconds?: number } = {},
): Promise<ReconciliationReport> {
  const rows = await supabaseRequest<
    Array<Record<string, string | number | null>>
  >(config, "rpc/rewards_reconciliation_report", {
    body: JSON.stringify({
      p_failing_after_attempts: options.failingAfterAttempts ?? 3,
      p_season_id: seasonId,
      p_stale_after_seconds: options.staleAfterSeconds ?? 1800,
    }),
    headers: buildHeaders(config),
    method: "POST",
  });

  const row = rows[0] ?? {};
  const num = (key: string) => Number(row[key] ?? 0);

  return {
    accountsFailing: num("accounts_failing"),
    accountsNeverSynced: num("accounts_never_synced"),
    accountsRetentionRisk: num("accounts_retention_risk"),
    accountsStale: num("accounts_stale"),
    accountsTotal: num("accounts_total"),
    driftAccounts: num("drift_accounts"),
    driftTotalXp: num("drift_total_xp"),
    fillsIngested: num("fills_ingested"),
    heldCashAmount: num("held_cash_amount"),
    heldCashRows: num("held_cash_rows"),
    maxIngestionLagSeconds: num("max_ingestion_lag_seconds"),
    oldestCursorTime: (row.oldest_cursor_time as string | null) ?? null,
    walletsWithoutCheckpoint: num("wallets_without_checkpoint"),
  };
}

/**
 * Rebuild the season's leaderboard projections from the ledger.
 *
 * Called once per ingestion run rather than written incrementally, so the
 * projection reconciles itself continuously instead of depending on every
 * writer being correct. That property is why `total_volume` was able to sit
 * frozen and undetected once the dashboard stopped writing it.
 */
export async function rebuildProjections(
  config: RewardsConfig,
  seasonId: string,
): Promise<{ pointsRows: number; weeklyRows: number }> {
  const rows = await supabaseRequest<
    Array<{ points_rows: string | number; weekly_rows: string | number }>
  >(config, "rpc/rewards_rebuild_projections", {
    body: JSON.stringify({ p_season_id: seasonId }),
    headers: buildHeaders(config),
    method: "POST",
  });

  const row = rows[0];
  return {
    pointsRows: Number(row?.points_rows ?? 0),
    weeklyRows: Number(row?.weekly_rows ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Streaks and lifetime XP
// ---------------------------------------------------------------------------

export interface CheckInStreak {
  availableToday: boolean;
  currentDays: number;
  lastCheckInAt: string | null;
  longestDays: number;
}

/**
 * Check-in streak, derived from dated ledger rows rather than a counter.
 *
 * A counter would need its own correctness argument about timezones and
 * double-increments, and could drift from the grants it describes with no way
 * to rebuild it. The grants are already dated, so this cannot disagree with
 * what was actually paid.
 */
export async function getCheckInStreak(
  config: RewardsConfig,
  userId: string,
  seasonId: string,
  now = new Date(),
): Promise<CheckInStreak> {
  const rows = await supabaseRequest<
    Array<{
      available_today: boolean;
      current_days: number;
      last_check_in_at: string | null;
      longest_days: number;
    }>
  >(config, "rpc/rewards_check_in_streak", {
    body: JSON.stringify({
      p_now: now.toISOString(),
      p_season_id: seasonId,
      p_user_id: userId,
    }),
    headers: buildHeaders(config),
    method: "POST",
  });

  const row = rows[0];
  return {
    availableToday: row?.available_today ?? true,
    currentDays: Number(row?.current_days ?? 0),
    lastCheckInAt: row?.last_check_in_at ?? null,
    longestDays: Number(row?.longest_days ?? 0),
  };
}

/** XP across every season. Never resets; season XP is a separate number. */
export async function getLifetimeXp(
  config: RewardsConfig,
  userId: string,
): Promise<number> {
  const total = await supabaseRequest<number>(config, "rpc/rewards_lifetime_xp", {
    body: JSON.stringify({ p_user_id: userId }),
    headers: buildHeaders(config),
    method: "POST",
  });

  return Number(total ?? 0);
}

// ---------------------------------------------------------------------------
// Referral funnel
// ---------------------------------------------------------------------------

export type ReferralMilestone = "funded" | "traded" | "retained";

export interface ReferralMilestoneRow {
  milestone: ReferralMilestone;
  qualifiedAt: string | null;
  refereeId: string;
  referrerId: string;
}

/**
 * Every referral rung currently earned, as (referrer, referee, milestone).
 *
 * Returns all qualifying rungs rather than only new ones. The caller writes
 * them to an append-only ledger keyed by referee and milestone, so there is no
 * cursor to keep and a missed run cannot lose a milestone.
 */
export async function getReferralMilestones(
  config: RewardsConfig,
): Promise<ReferralMilestoneRow[]> {
  const rows = await supabaseRequest<
    Array<{
      milestone: string;
      qualified_at: string | null;
      referee_id: string;
      referrer_id: string;
    }>
  >(config, "rpc/rewards_referral_milestones", {
    body: JSON.stringify({}),
    headers: buildHeaders(config),
    method: "POST",
  });

  return rows.map((row) => ({
    milestone: row.milestone as ReferralMilestone,
    qualifiedAt: row.qualified_at,
    refereeId: row.referee_id,
    referrerId: row.referrer_id,
  }));
}

export interface ReferralFunnel {
  dry: number;
  funded: number;
  retained: number;
  traded: number;
}

/**
 * Funnel counts for reconciliation.
 *
 * `dry` earns nothing, but the ratio between it and the paying rungs is the
 * clearest signal that somebody is manufacturing accounts.
 */
export async function getReferralFunnel(config: RewardsConfig): Promise<ReferralFunnel> {
  const rows = await supabaseRequest<
    Array<{ dry: string | number; funded: string | number; retained: string | number; traded: string | number }>
  >(config, "rpc/rewards_referral_funnel", {
    body: JSON.stringify({}),
    headers: buildHeaders(config),
    method: "POST",
  });

  const row = rows[0];
  return {
    dry: Number(row?.dry ?? 0),
    funded: Number(row?.funded ?? 0),
    retained: Number(row?.retained ?? 0),
    traded: Number(row?.traded ?? 0),
  };
}
