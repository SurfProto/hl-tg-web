import type { SupabaseConfig } from "../../_lib/supabase";

interface EnvLike {
  [key: string]: string | undefined;
}

export interface ProfileConfig {
  privyAppId: string;
  privyAppSecret: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

function getRequired(env: EnvLike, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

/**
 * Just the pair that names the database — for a caller that touches Supabase
 * and nothing else (the DB health probe), so a missing Privy variable cannot
 * make a database check answer 500 for a reason unrelated to the database.
 */
export function getSupabaseConfig(env: EnvLike = process.env): SupabaseConfig {
  return {
    supabaseUrl: getRequired(env, "SUPABASE_URL"),
    supabaseServiceRoleKey: getRequired(env, "SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function getProfileConfig(env: EnvLike = process.env): ProfileConfig {
  return {
    privyAppId: env.PROFILE_PRIVY_APP_ID?.trim() || getRequired(env, "VITE_PRIVY_APP_ID"),
    privyAppSecret: getRequired(env, "PRIVY_APP_SECRET"),
    supabaseUrl: getRequired(env, "SUPABASE_URL"),
    supabaseServiceRoleKey: getRequired(env, "SUPABASE_SERVICE_ROLE_KEY"),
  };
}
