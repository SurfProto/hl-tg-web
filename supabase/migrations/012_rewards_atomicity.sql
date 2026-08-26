-- Make "one season" and "one referrer" invariants the database enforces.
--
-- Both were check-then-write in application code, which is only correct when
-- exactly one request is in flight.

-- ---------------------------------------------------------------------------
-- Seasons
-- ---------------------------------------------------------------------------

-- `is_active` was never a reliable answer and this migration does not pretend
-- otherwise. getOrCreateActiveSeason inserts a season with is_active = true and
-- never clears the flag on the one before it, so at the time of writing both
-- April 2026 (ended 2026-05-01) and August 2026 were flagged active. Nothing
-- broke only because every read also filters on the date window, which means
-- the flag has been decorative for months.
--
-- So the invariant is placed where the meaning actually lives: no two seasons
-- may cover the same instant. That is what "the active season" depends on, and
-- it is checkable. A unique index on is_active would enforce a weaker rule that
-- the current data already violates.
update seasons
   set is_active = false
 where is_active
   and ends_at <= now();

-- Ranges are half-open: a season ending 2026-05-01T00:00 and one starting at
-- that instant do not overlap, which is exactly the boundary the monthly
-- rollover lands on.
alter table seasons drop constraint if exists seasons_no_overlapping_window;
alter table seasons
  add constraint seasons_no_overlapping_window
  exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&);

/**
 * The season covering p_now, creating it only if no season covers that instant.
 *
 * Two first-visitors in the same instant used to be able to create two seasons,
 * splitting the program's accounting in half with no way to tell which was
 * canonical. The insert is now guarded by the exclusion constraint above: at
 * most one concurrent caller can win, and the loser re-reads the winner's row
 * rather than failing.
 *
 * ON CONFLICT cannot express this — it requires a unique index, and an
 * exclusion constraint raises instead — so the conflict is caught by name.
 */
create or replace function rewards_get_or_create_active_season(
  p_now timestamptz default now(),
  p_weekly_pool numeric default null
)
returns seasons
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season seasons;
  v_start timestamptz := date_trunc('month', p_now);
  v_end timestamptz := date_trunc('month', p_now) + interval '1 month';
begin
  select * into v_season
    from seasons
   where p_now >= starts_at and p_now < ends_at
   order by starts_at
   limit 1;

  if found then
    return v_season;
  end if;

  begin
    insert into seasons (name, starts_at, ends_at, is_active, reward_pool_weekly)
    values (
      to_char(v_start, 'FMMonth YYYY'),
      v_start,
      v_end,
      true,
      p_weekly_pool
    )
    returning * into v_season;
  exception when exclusion_violation then
    -- Another caller created it between the select and the insert.
    select * into v_season
      from seasons
     where p_now >= starts_at and p_now < ends_at
     order by starts_at
     limit 1;
  end;

  return v_season;
end;
$$;

-- ---------------------------------------------------------------------------
-- Referrals
-- ---------------------------------------------------------------------------

/**
 * Link a referrer, but only if none is set and it is not the user themselves.
 *
 * applyReferralCode read `referred_by`, decided it was null, and then patched —
 * so two codes applied at once could both pass the check and the second would
 * silently overwrite the first. The condition now lives in the UPDATE, so the
 * database decides the winner and the loser is told it lost.
 *
 * Returns an outcome rather than a boolean so the caller can answer
 * "already linked" differently from "that is your own code" without a second
 * query that could itself be racing.
 */
create or replace function rewards_claim_referrer(
  p_user_id uuid,
  p_referrer_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  if p_user_id = p_referrer_id then
    return 'self_referral';
  end if;

  update users
     set referred_by = p_referrer_id
   where id = p_user_id
     and referred_by is null;

  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    return 'ok';
  end if;

  return 'already_set';
end;
$$;

-- security definer, and both write. Revoking from PUBLIC alone is not enough:
-- default privileges grant EXECUTE on new functions in `public` to anon and
-- authenticated by name. See the note in 008_rewards_xp_accounting.sql.
revoke execute on function public.rewards_get_or_create_active_season(timestamptz, numeric) from public;
revoke execute on function public.rewards_claim_referrer(uuid, uuid) from public;

revoke execute on function public.rewards_get_or_create_active_season(timestamptz, numeric) from anon, authenticated;
revoke execute on function public.rewards_claim_referrer(uuid, uuid) from anon, authenticated;
