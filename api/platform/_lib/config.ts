interface EnvLike {
  [key: string]: string | undefined;
}

export interface PlatformConfig {
  platformAdminKey: string | null;
  privyAppId: string | null;
  supabaseServiceRoleKey: string;
  supabaseUrl: string;
  webhookSecret: string | null;
}

function getRequired(env: EnvLike, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

export function getPlatformConfig(env: EnvLike = process.env): PlatformConfig {
  return {
    platformAdminKey: env.PLATFORM_ADMIN_KEY ?? null,
    privyAppId: env.ONRAMP_PRIVY_APP_ID ?? env.VITE_PRIVY_APP_ID ?? null,
    supabaseServiceRoleKey: getRequired(env, "SUPABASE_SERVICE_ROLE_KEY"),
    supabaseUrl: getRequired(env, "SUPABASE_URL").replace(/\/+$/, ""),
    webhookSecret: env.PLATFORM_WEBHOOK_SECRET ?? null,
  };
}
