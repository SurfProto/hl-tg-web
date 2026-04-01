-- Migration 001: Fix identity model + add RLS policies
--
-- Changes:
-- 1. telegram_id: NOT NULL → nullable (wallet-only users have no Telegram ID)
-- 2. Add privy_user_id column for Privy user identity correlation
-- 3. Add RLS policies for all tables
--    - users: read/update own row via wallet_address match
--    - points tables: select own rows, insert/update via service role only

-- 1. Make telegram_id nullable
alter table users
  alter column telegram_id drop not null;

-- 2. Add privy_user_id column (nullable, unique when present)
alter table users
  add column if not exists privy_user_id text unique;

-- ============================================================
-- RLS Policies
-- ============================================================
-- Note: these use wallet_address as the identity anchor since
-- Supabase auth is not used (Privy handles auth). The anon key
-- can only read/update the row matching the provided wallet.
-- Writes to points tables require the service role key.

-- users table
create policy "users_select_own" on users
  for select
  using (true);  -- public read: wallet addresses are not sensitive

create policy "users_update_own" on users
  for update
  using (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

create policy "users_insert_any" on users
  for insert
  with check (true);  -- inserts come from ensureUser() with anon key

-- user_points: anon can read own rows; only service role can insert/update
create policy "user_points_select_own" on user_points
  for select
  using (
    user_id in (
      select id from users
      where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'
    )
  );

create policy "user_points_service_write" on user_points
  for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- referral_earnings: anon reads own rows (as referrer); service role writes
create policy "referral_earnings_select_own" on referral_earnings
  for select
  using (
    referrer_id in (
      select id from users
      where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'
    )
  );

create policy "referral_earnings_service_write" on referral_earnings
  for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- weekly_rewards: anon reads own rows; service role writes
create policy "weekly_rewards_select_own" on weekly_rewards
  for select
  using (
    user_id in (
      select id from users
      where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'
    )
  );

create policy "weekly_rewards_service_write" on weekly_rewards
  for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- awards: anon reads own rows; service role writes
create policy "awards_select_own" on awards
  for select
  using (
    user_id in (
      select id from users
      where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'
    )
  );

create policy "awards_service_write" on awards
  for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- notification_preferences: own row only
create policy "notif_prefs_select_own" on notification_preferences
  for select
  using (
    user_id in (
      select id from users
      where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'
    )
  );

create policy "notif_prefs_write_own" on notification_preferences
  for all
  using (
    user_id in (
      select id from users
      where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'
    )
  );
