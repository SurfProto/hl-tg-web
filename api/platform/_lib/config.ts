interface EnvLike {
  [key: string]: string | undefined;
}

export interface PlatformConfig {
  highRiskCountries: string[];
  platformAdminKey: string | null;
  prohibitedCountries: string[];
  privyAppId: string | null;
  quoteSigningSecret: string | null;
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

function parseCountryList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
}

export function getPlatformConfig(env: EnvLike = process.env): PlatformConfig {
  return {
    highRiskCountries: parseCountryList(env.PLATFORM_HIGH_RISK_COUNTRIES),
    platformAdminKey: env.PLATFORM_ADMIN_KEY ?? null,
    prohibitedCountries: parseCountryList(env.PLATFORM_PROHIBITED_COUNTRIES),
    privyAppId: env.ONRAMP_PRIVY_APP_ID ?? env.VITE_PRIVY_APP_ID ?? null,
    // Falls back to the webhook secret so an existing deployment keeps working,
    // but they should be separate keys.
    quoteSigningSecret: env.PLATFORM_QUOTE_SECRET ?? env.PLATFORM_WEBHOOK_SECRET ?? null,
    supabaseServiceRoleKey: getRequired(env, "SUPABASE_SERVICE_ROLE_KEY"),
    supabaseUrl: getRequired(env, "SUPABASE_URL").replace(/\/+$/, ""),
    webhookSecret: env.PLATFORM_WEBHOOK_SECRET ?? null,
  };
}

export function isProhibitedCorridor(config: PlatformConfig, country: string): boolean {
  const normalized = country.trim().toUpperCase();
  return config.prohibitedCountries.includes(normalized);
}
