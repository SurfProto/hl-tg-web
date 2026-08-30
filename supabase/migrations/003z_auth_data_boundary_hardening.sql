-- Renamed 003_ → 003z_ so a clean-database replay sorts this file after
-- 003_notifications and 003_rewards_v1, matching the order production
-- actually applied (Apr 15 → 16 → 17). It hardens policies on
-- notification_channels, which 003_notifications creates, so sorted ahead of
-- it the replay died on a missing table. 'z' rather than 'b' because the name
-- must outsort both siblings under byte and locale collation alike.
--
-- Migration 003: tighten profile-related RLS after moving profile writes behind
-- authenticated API routes backed by the service role key.
--
-- The tg-mini app no longer needs direct anon access to users or
-- notification_preferences. Leaving the old policies in place would keep a
-- public read surface and an anon insert path that bypass the Privy/API
-- boundary we just introduced.

drop policy if exists "users_select_own" on users;
drop policy if exists "users_update_own" on users;
drop policy if exists "users_insert_any" on users;

create policy "users_service_role_access" on users
  for all
  using (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  )
  with check (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  );

drop policy if exists "notif_prefs_select_own" on notification_preferences;
drop policy if exists "notif_prefs_write_own" on notification_preferences;

create policy "notif_prefs_service_role_access" on notification_preferences
  for all
  using (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  )
  with check (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  );

drop policy if exists "notification_channels_select_own" on notification_channels;

create policy "notification_channels_service_role_access" on notification_channels
  for all
  using (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  )
  with check (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  );
