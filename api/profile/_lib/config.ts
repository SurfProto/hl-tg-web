interface EnvLike {
  [key: string]: string | undefined;
}

export interface ProfileConfig {
  privyAppId: string | null;
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

export function getProfileConfig(env: EnvLike = process.env): ProfileConfig {
  return {
    privyAppId: env.PROFILE_PRIVY_APP_ID ?? env.VITE_PRIVY_APP_ID ?? null,
    supabaseUrl: getRequired(env, "SUPABASE_URL"),
    supabaseServiceRoleKey: getRequired(env, "SUPABASE_SERVICE_ROLE_KEY"),
  };
}
