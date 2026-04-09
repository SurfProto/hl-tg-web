interface EnvLike {
  [key: string]: string | undefined;
}

export interface OnrampConfig {
  baseUrl: string;
  clientId: string;
  secret: string;
  serviceId: string;
  appSymbol: string;
  providerSymbol: string;
  network: string;
  returnUrl: string | null;
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

export function getOnrampConfig(env: EnvLike = process.env): OnrampConfig {
  const appSymbol = env.ONRAMP_SYMBOL ?? "RUB-USDT";

  return {
    baseUrl: getRequired(env, "ONRAMP_BASE_URL").replace(/\/+$/, ""),
    clientId: getRequired(env, "ONRAMP_CLIENT_ID"),
    secret: getRequired(env, "ONRAMP_SECRET"),
    serviceId: getRequired(env, "ONRAMP_SERVICE_ID"),
    appSymbol,
    providerSymbol: env.ONRAMP_PROVIDER_SYMBOL ?? appSymbol,
    network: env.ONRAMP_NETWORK ?? "TRC20",
    returnUrl: env.ONRAMP_RETURN_URL ?? null,
    privyAppId: env.ONRAMP_PRIVY_APP_ID ?? env.VITE_PRIVY_APP_ID ?? null,
    supabaseUrl: getRequired(env, "SUPABASE_URL"),
    supabaseServiceRoleKey: getRequired(env, "SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function getSymbolCurrencies(symbol: string): { payinCurrency: string; payoutCurrency: string } {
  const [payinCurrency, payoutCurrency] = symbol.split("-");
  if (!payinCurrency || !payoutCurrency) {
    throw new Error(`Invalid onramp symbol: ${symbol}`);
  }

  return { payinCurrency, payoutCurrency };
}
