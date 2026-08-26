-- Close the last two tables that anon could read and write.
--
-- `seasons` and `bridge_sponsorship_events` had RLS disabled, and Supabase's
-- default grants give `anon` full DML on such a table — including TRUNCATE.
-- Anyone holding the publishable key could rewrite the active season's dates,
-- deactivate it, or insert one of their own. An anon key is not a secret by
-- design; it ships in client bundles as a matter of course.
--
-- Nothing this app publishes opens that door today — the built bundle carries
-- neither the Supabase URL nor an anon key — but that is a property of the
-- current build, not of the schema, and it is the wrong thing to be relying on.
--
-- No policies are added, which is the point. RLS with no policy is deny-all for
-- `anon` and `authenticated`, while `service_role` bypasses RLS entirely. Every
-- read and write of both tables goes through an API route holding the service
-- key, so this closes the hole without changing a single code path:
--
--   * `seasons` is touched only by api/rewards/_lib/supabase-admin.ts, via
--     getActiveSeason and getOrCreateActiveSeason, both service-role.
--   * `bridge_sponsorship_events` is referenced nowhere in the codebase at all.
--
-- This matches the posture already in place on user_points, weekly_rewards,
-- awards and referral_earnings, each of which has RLS on and no policies.

alter table seasons enable row level security;
alter table bridge_sponsorship_events enable row level security;
