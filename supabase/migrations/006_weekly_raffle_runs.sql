-- Serialise the weekly raffle draw.
--
-- runWeeklyRaffle checked for existing winners, then drew, then upserted. Two
-- concurrent firings — Vercel retries a cron, or an operator triggers the admin
-- route while the cron is running — both saw no winners and both drew, and the
-- per-user idempotency key on the ledger meant the result was the *union* of two
-- independent draws: more winners than weeklyWinnerCount, each paid a prize
-- picked by their index in whichever draw they landed in.
--
-- A runner now has to claim (season, week) before drawing.

create table if not exists weekly_raffle_runs (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  week_start timestamptz not null,
  status text not null default 'drawing' check (status in ('drawing', 'completed', 'failed')),
  winner_count int not null default 0,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  unique (season_id, week_start)
);

alter table weekly_raffle_runs enable row level security;

drop policy if exists "weekly_raffle_runs_service_write" on weekly_raffle_runs;
create policy "weekly_raffle_runs_service_write" on weekly_raffle_runs for all
  using (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

/**
 * Claim the draw for a (season, week).
 *
 * Returns true only for the caller that inserted the row. A run left in
 * 'drawing' for longer than p_stale_after_seconds is treated as abandoned and
 * may be reclaimed, so a crashed run does not block the week forever.
 */
create or replace function claim_weekly_raffle_run(
  p_season_id uuid,
  p_week_start timestamptz,
  p_stale_after_seconds int default 900
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  insert into weekly_raffle_runs (season_id, week_start)
  values (p_season_id, p_week_start)
  on conflict (season_id, week_start) do nothing;

  if found then
    return true;
  end if;

  update weekly_raffle_runs
     set status = 'drawing',
         claimed_at = now(),
         error = null
   where season_id = p_season_id
     and week_start = p_week_start
     and status = 'drawing'
     and claimed_at < now() - make_interval(secs => p_stale_after_seconds)
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

create or replace function complete_weekly_raffle_run(
  p_season_id uuid,
  p_week_start timestamptz,
  p_winner_count int,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update weekly_raffle_runs
     set status = case when p_error is null then 'completed' else 'failed' end,
         winner_count = p_winner_count,
         completed_at = now(),
         error = p_error
   where season_id = p_season_id
     and week_start = p_week_start;
end;
$$;
