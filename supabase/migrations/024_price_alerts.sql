-- Price alerts: a user asks to be told once when a coin crosses a level.
--
-- One-shot by design: the alert row is the arming, triggered_at is the
-- consumption, and the notification event's idempotency key is the alert id —
-- so however many worker passes race over a crossing, one message goes out.
-- Re-arming is creating a new alert.

create table if not exists price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  coin text not null,
  target_px numeric not null check (target_px > 0),
  direction text not null check (direction in ('above', 'below')),
  created_at timestamptz not null default now(),
  triggered_at timestamptz
);

-- The worker scans active alerts every minute; triggered rows are history.
create index if not exists price_alerts_active_idx
  on price_alerts (user_id)
  where triggered_at is null;

-- Service-role only, like every table here: RLS on with no policies denies
-- anon and authenticated outright, and the API's service role bypasses RLS.
alter table price_alerts enable row level security;

-- The events table's topic list is a CHECK constraint, so a new topic is a
-- constraint swap. The name is the one Postgres auto-assigns to an inline
-- check on this column.
alter table notification_events drop constraint if exists notification_events_topic_check;
alter table notification_events add constraint notification_events_topic_check
  check (topic in ('liquidation_risk', 'order_fill', 'usdc_deposit', 'price_alert'));
