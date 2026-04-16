import {
  DEFAULT_FIRST_TRADE_THRESHOLD_USD,
  DEFAULT_FUNDED_DEPOSIT_THRESHOLD_USD,
  DEFAULT_XP_PER_USD,
} from "./engine";

export interface RewardsConfig {
  firstTradeThresholdUsd: number;
  fundedDepositThresholdUsd: number;
  hyperliquidTestnet: boolean;
  privyAppId: string | null;
  rafflePrizeAmounts: number[];
  rewardsAdminKey: string | null;
  supabaseServiceRoleKey: string;
  supabaseUrl: string;
  treasuryPrivateKey: `0x${string}` | null;
  weeklyRewardPoolUsd: number;
  weeklyTopTraderCohortSize: number;
  weeklyWinnerCount: number;
  xpPerUsd: number;
}

function getRequired(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
}

function getNumber(env: NodeJS.ProcessEnv, key: string, fallback: number) {
  const rawValue = env[key];
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPrizeAmounts(env: NodeJS.ProcessEnv, winnerCount: number, defaultPool: number) {
  const rawValue = env.REWARDS_RAFFLE_PRIZES_USDC;
  if (!rawValue) {
    if (winnerCount <= 1) {
      return [defaultPool];
    }

    const firstPrize = Math.max(defaultPool * 0.5, 1);
    const secondPrize = Math.max(defaultPool * 0.3, 1);
    const remaining = Math.max(defaultPool - firstPrize - secondPrize, 0);
    return [firstPrize, secondPrize, remaining].slice(0, winnerCount);
  }

  return rawValue
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, winnerCount);
}

export function getRewardsConfig(env: NodeJS.ProcessEnv = process.env): RewardsConfig {
  const weeklyRewardPoolUsd = getNumber(env, "REWARDS_WEEKLY_REWARD_POOL_USDC", 100);
  const weeklyWinnerCount = Math.max(1, Math.floor(getNumber(env, "REWARDS_WEEKLY_WINNER_COUNT", 3)));

  return {
    firstTradeThresholdUsd: getNumber(
      env,
      "REWARDS_FIRST_TRADE_THRESHOLD_USD",
      DEFAULT_FIRST_TRADE_THRESHOLD_USD,
    ),
    fundedDepositThresholdUsd: getNumber(
      env,
      "REWARDS_FUNDED_DEPOSIT_THRESHOLD_USD",
      DEFAULT_FUNDED_DEPOSIT_THRESHOLD_USD,
    ),
    hyperliquidTestnet: env.VITE_HYPERLIQUID_TESTNET === "true",
    privyAppId: env.VITE_PRIVY_APP_ID ?? null,
    rafflePrizeAmounts: getPrizeAmounts(env, weeklyWinnerCount, weeklyRewardPoolUsd),
    rewardsAdminKey: env.REWARDS_ADMIN_KEY ?? null,
    supabaseServiceRoleKey: getRequired(env, "SUPABASE_SERVICE_ROLE_KEY"),
    supabaseUrl: getRequired(env, "SUPABASE_URL"),
    treasuryPrivateKey: (env.REWARDS_TREASURY_PRIVATE_KEY as `0x${string}` | undefined) ?? null,
    weeklyRewardPoolUsd,
    weeklyTopTraderCohortSize: Math.max(
      1,
      Math.floor(getNumber(env, "REWARDS_WEEKLY_TOP_TRADER_COHORT_SIZE", 10)),
    ),
    weeklyWinnerCount,
    xpPerUsd: getNumber(env, "REWARDS_XP_PER_USD", DEFAULT_XP_PER_USD),
  };
}
