-- The pending-day selection could never reach the days that have data.
--
-- Days were ordered oldest first and capped at seven per run. A day's file only
-- exists when there were builder fills that day, and a missing key answers 403,
-- so a quiet stretch is a run of permanently unavailable days — and those days
-- stay pending forever, because `unpublished` is a retryable state.
--
-- Against the live bucket, 29 July through 20 August are all 403 and 23 and 24
-- August are 200. The oldest-first rule would therefore have fetched the same
-- seven missing July days on every run, in perpetuity, and never once reached
-- the two days that actually hold fills. Nothing would have errored; the
-- reconciliation would simply have reported zero verified fees forever.
--
-- This is the same defect as 017, which is worth saying plainly: a bound meant
-- to cap work per run becomes a bound on which work is ever attempted, unless
-- the ordering guarantees progress. There the fix was to select only rows still
-- needing work; here every pending day needs work and some can never succeed,
-- so the ordering has to demote what keeps failing.
--
-- Never-attempted days come first, newest first, so yesterday's file is read at
-- the first opportunity and a new day never queues behind a stuck backlog.
-- Previously failed days follow, least-attempted first, so the backlog still
-- advances and days that can never succeed sink under their own attempt counts
-- rather than blocking the queue.

create or replace function rewards_pending_builder_fill_days(
  p_from date,
  p_limit int default 7
)
returns table (day date)
language sql
stable
security definer
set search_path = public
as $$
  select d.day
  from (
    select
      g::date as day,
      coalesce(f.attempts, 0) as attempts
    from generate_series(p_from, (now() at time zone 'utc')::date - 1, interval '1 day') g
    left join builder_fill_days f on f.day = g::date
    where f.day is null or f.status <> 'ingested'
  ) d
  order by d.attempts, d.day desc
  limit greatest(1, least(p_limit, 60));
$$;

revoke execute on function public.rewards_pending_builder_fill_days(date, int) from public;
revoke execute on function public.rewards_pending_builder_fill_days(date, int) from anon, authenticated;
