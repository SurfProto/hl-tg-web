-- Which migrations are actually applied? Until now that question could not be
-- answered from the repository: application is manual, there is no tracking
-- table, and the one audit lives in HANDOFF.md as prose. This function checks
-- one marker object per migration, so /api/health/migrations (admin-keyed)
-- can report drift between the directory and the live database.
--
-- A marker proves the migration ran, not that every statement in it holds.
-- Migrations whose whole content is policies or flags (003z, 005_profile,
-- 007, 010) get the nearest checkable proxy or none; absence of a row here
-- means "not verifiable this way", not "not applied". This function verifies
-- itself by existing: if the endpoint answers, 026 is applied.

create or replace function migrations_report()
returns table (migration text, marker text, present boolean)
language sql
stable
security definer
set search_path = public
as $$
  with markers(migration, kind, marker) as (
    values
      ('000_baseline_schema', 'table', 'users'),
      ('001_identity_and_rls', 'table', 'notification_preferences'),
      ('002_onramp_v1', 'table', 'onramp_orders'),
      ('003_notifications', 'table', 'notification_events'),
      ('003_rewards_v1', 'table', 'reward_ledger'),
      ('004_platform_orchestration', 'table', 'merchants'),
      ('005_platform_hardening', 'table', 'user_risk_profiles'),
      ('006_weekly_raffle_runs', 'table', 'weekly_raffle_runs'),
      ('008_rewards_xp_accounting', 'function', 'rewards_season_xp_totals'),
      ('009_rewards_fill_checkpoints', 'table', 'rewards_fill_checkpoints'),
      ('011_rewards_leaderboard_privacy', 'function', 'rewards_season_leaderboard'),
      ('012_rewards_atomicity', 'function', 'rewards_claim_referrer'),
      ('013_rewards_reconciliation', 'function', 'rewards_reconciliation_report'),
      ('014_rewards_rebuildable_projections', 'function', 'rewards_rebuild_projections'),
      ('015_notifications_status', 'function', 'notifications_status_report'),
      ('016_rewards_streaks_and_lifetime', 'function', 'rewards_check_in_streak'),
      ('017_rewards_backfill_and_standing', 'function', 'rewards_season_user_standing'),
      ('018_rewards_attribution_recovery', 'function', 'rewards_rewind_fill_cursors'),
      ('019_rewards_referral_milestones', 'function', 'rewards_referral_milestones'),
      ('020_hl_deposit_ledger', 'table', 'hl_deposits'),
      ('021_builder_fill_verification', 'table', 'builder_fills'),
      ('022_builder_fill_day_ordering', 'function', 'rewards_pending_builder_fill_days'),
      ('023_largest_trade_progress', 'function', 'rewards_largest_trade_usd'),
      ('024_price_alerts', 'table', 'price_alerts'),
      ('025_ramp_provenance', 'column', 'hl_deposits.source_rail'),
      ('026_migrations_report', 'function', 'migrations_report')
  )
  select
    m.migration,
    m.marker,
    case m.kind
      when 'table' then to_regclass('public.' || m.marker) is not null
      when 'column' then exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = split_part(m.marker, '.', 1)
          and c.column_name = split_part(m.marker, '.', 2)
      )
      else exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = m.marker
      )
    end as present
  from markers m
  order by m.migration;
$$;

-- security definer. Revoking from PUBLIC alone is not enough — see
-- 008_rewards_xp_accounting.sql.
revoke execute on function public.migrations_report() from public;
revoke execute on function public.migrations_report() from anon, authenticated;
