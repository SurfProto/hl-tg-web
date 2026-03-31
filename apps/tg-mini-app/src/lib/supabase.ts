import { createClient } from '@supabase/supabase-js';

type EnsureUserInput = {
  privyUserId?: string;
  telegramId?: string;
  username?: string;
  walletAddress?: string;
  language?: string;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export function getTelegramProfile() {
  return window.Telegram?.WebApp?.initDataUnsafe?.user;
}

export async function ensureUser(input: EnsureUserInput) {
  if (!supabase) return null;
  if (!input.telegramId && !input.walletAddress) return null;

  const payload = {
    privy_user_id: input.privyUserId ?? null,
    telegram_id: input.telegramId ?? null,
    wallet_address: input.walletAddress ?? null,
    username: input.username ?? null,
    language: input.language ?? 'en',
  };

  // Conflict target depends on which identifier is present:
  // - Telegram users are keyed by telegram_id (partial unique index WHERE NOT NULL)
  // - Wallet-only users are keyed by wallet_address
  const onConflict = input.telegramId ? 'telegram_id' : 'wallet_address';

  try {
    const { data, error } = await supabase
      .from('users')
      .upsert(payload, { onConflict })
      .select()
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (error) {
    console.warn('[supabase] ensureUser failed', error);
    return null;
  }
}

export async function getCurrentUserRecord(walletAddress?: string) {
  if (!supabase || !walletAddress) return null;

  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (error) {
    console.warn('[supabase] getCurrentUserRecord failed', error);
    return null;
  }
}
