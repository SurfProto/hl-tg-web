import { createClient } from '@supabase/supabase-js';
import { log } from './logger';

interface EnsureUserInput {
  telegramId?: string;
  privyUserId?: string;
  username?: string;
  walletAddress?: string;
  email?: string;
  language?: string;
}

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

  try {
    if (input.telegramId) {
      // Telegram user: upsert on telegram_id (the natural unique key)
      const payload = {
        telegram_id: input.telegramId,
        wallet_address: input.walletAddress ?? null,
        privy_user_id: input.privyUserId ?? null,
        username: input.username ?? null,
        email: input.email ?? null,
        language: input.language ?? 'en',
      };
      const { data, error } = await supabase
        .from('users')
        .upsert(payload, { onConflict: 'telegram_id' })
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    } else {
      // Wallet-only user: upsert on wallet_address, telegram_id stays NULL
      const payload = {
        wallet_address: input.walletAddress!,
        privy_user_id: input.privyUserId ?? null,
        username: input.username ?? null,
        email: input.email ?? null,
        language: input.language ?? 'en',
      };
      const { data, error } = await supabase
        .from('users')
        .upsert(payload, { onConflict: 'wallet_address' })
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    }
  } catch (err) {
    log.warn('[supabase] ensureUser failed', { error: err, input });
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
  } catch (err) {
    log.warn('[supabase] getCurrentUserRecord failed', {
      error: err,
      walletAddress,
    });
    return null;
  }
}
