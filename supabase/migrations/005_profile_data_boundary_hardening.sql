-- Migration 005: make profile identity and notification tables service-role-only.
-- Safe to apply whether or not migration 003_auth_data_boundary_hardening.sql
-- has already been executed.

drop policy if exists "users_select_own" on users;
drop policy if exists "users_update_own" on users;
drop policy if exists "users_insert_any" on users;
drop policy if exists "users_service_role_access" on users;

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
drop policy if exists "notif_prefs_service_role_access" on notification_preferences;

create policy "notif_prefs_service_role_access" on notification_preferences
  for all
  using (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  )
  with check (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  );

drop policy if exists "notification_channels_select_own" on notification_channels;
drop policy if exists "notification_channels_service_write" on notification_channels;
drop policy if exists "notification_channels_service_role_access" on notification_channels;

create policy "notification_channels_service_role_access" on notification_channels
  for all
  using (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  )
  with check (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  );
