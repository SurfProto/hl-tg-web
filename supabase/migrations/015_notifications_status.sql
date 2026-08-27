-- Make it possible to tell a quiet notification pipeline from a broken one.
--
-- The worker was reported dead. It was not: it runs every minute, both users'
-- cursors are current, preferences are on, the channel is active, and the one
-- event ever created was delivered successfully. There had simply been nothing
-- to send since the fills cursor caught up with the last trade.
--
-- That is the actual defect. `detectFillEvents` adopts the newest fill as its
-- cursor on first run and emits nothing, which is right — enabling alerts
-- should not replay your whole history — but it means a first successful run
-- after an outage silently swallows whatever happened during it. From outside,
-- "working and quiet" and "broken" look identical, and nobody can tell which
-- they have.
--
-- Reports only. Nothing here writes.

/**
 * Pipeline health in one row.
 *
 * `worker_lag_seconds` is the load-bearing number: the worker touches runtime
 * state on every pass, so a lag much above the cron interval means it has
 * stopped, whatever the event counts say.
 *
 * `cursors_uninitialised` is the counterpart — accounts the worker has never
 * completed a pass for, which will silently swallow their first batch when it
 * finally does.
 */
create or replace function notifications_status_report(
  p_stale_after_seconds int default 300
)
returns table (
  channels_total bigint,
  channels_active bigint,
  channels_failing bigint,
  users_with_preferences bigint,
  cursors_tracked bigint,
  cursors_uninitialised bigint,
  worker_last_run_at timestamptz,
  worker_lag_seconds numeric,
  worker_stale boolean,
  events_pending bigint,
  events_failed bigint,
  events_sent bigint,
  events_sent_24h bigint,
  oldest_pending_seconds numeric,
  last_error_code text
)
language sql
stable
security definer
set search_path = public
as $$
  with runtime as (
    select max(updated_at) as last_run,
           count(*) as tracked,
           count(*) filter (where coalesce((state->>'initialized')::boolean, false) = false)
             as uninitialised
    from notification_runtime_state
  ),
  ch as (
    select count(*) as total,
           count(*) filter (where status = 'active') as active,
           count(*) filter (where status <> 'active') as failing
    from notification_channels
  ),
  ev as (
    select
      count(*) filter (where status = 'pending') as pending,
      count(*) filter (where status = 'failed') as failed,
      count(*) filter (where status = 'sent') as sent,
      count(*) filter (where status = 'sent' and sent_at > now() - interval '24 hours')
        as sent_24h,
      coalesce(
        max(extract(epoch from (now() - created_at))) filter (where status = 'pending'),
        0
      )::numeric as oldest_pending,
      (
        select e.last_error_code from notification_events e
        where e.last_error_code is not null
        order by e.updated_at desc limit 1
      ) as last_error
    from notification_events
  )
  select
    ch.total,
    ch.active,
    ch.failing,
    (select count(*) from notification_preferences),
    runtime.tracked,
    runtime.uninitialised,
    runtime.last_run,
    coalesce(extract(epoch from (now() - runtime.last_run)), 0)::numeric,
    coalesce(extract(epoch from (now() - runtime.last_run)), 0) > p_stale_after_seconds,
    ev.pending,
    ev.failed,
    ev.sent,
    ev.sent_24h,
    ev.oldest_pending,
    ev.last_error
  from runtime, ch, ev;
$$;

-- security definer and it reads across every account. Revoking from PUBLIC
-- alone is not enough: default privileges grant EXECUTE on new functions in
-- `public` to anon and authenticated by name. See 008_rewards_xp_accounting.sql.
revoke execute on function public.notifications_status_report(int) from public;
revoke execute on function public.notifications_status_report(int) from anon, authenticated;
