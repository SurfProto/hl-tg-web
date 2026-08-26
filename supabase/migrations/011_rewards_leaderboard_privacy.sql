-- Rank in the database, and stop publishing who people are.
--
-- Two problems, one query.
--
-- The leaderboard identified traders by Telegram username, falling back to the
-- first six characters of their wallet address. Both were shown to every other
-- user. A Telegram username is a real-world identity and a wallet prefix is a
-- durable on-chain handle; neither is something a trader opted into publishing
-- by placing a trade. An opaque per-user alias is enough to render a table.
--
-- And the ranking loaded every `user_points` row for the season, then every
-- `users` row behind them, into a serverless function, to sort them in JS and
-- return ten. That is unbounded work and unbounded memory on a request path,
-- growing with the size of the program rather than the size of the answer.

-- ---------------------------------------------------------------------------
-- Alias
-- ---------------------------------------------------------------------------

alter table users add column if not exists leaderboard_alias text;

-- Unique so an alias identifies one account. This also makes a later
-- self-chosen display name a change of how the column is populated rather than
-- a change of shape -- though that feature needs moderation, impersonation and
-- rename policy that this deliberately does not attempt.
create unique index if not exists users_leaderboard_alias_key
  on users(leaderboard_alias)
  where leaderboard_alias is not null;

/**
 * Assign an opaque alias derived from the internal id.
 *
 * Derived rather than random so it is stable and reproducible, and one-way so
 * the alias reveals nothing about the account. The id is already a random uuid
 * and is not published, so a plain digest of it is sufficient here -- this is a
 * display name, not an authentication boundary.
 *
 * Eight hex characters over a few thousand users makes a collision very
 * unlikely, but "very unlikely" against a unique index is a failed signup for a
 * real person, so a clash simply slides one character along the digest.
 */
create or replace function rewards_assign_leaderboard_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_alias text;
  v_offset int := 1;
begin
  if new.leaderboard_alias is not null then
    return new;
  end if;

  -- Two digests concatenated, so there is room to slide without rehashing.
  v_hash := md5(new.id::text) || md5('alias:' || new.id::text);

  loop
    v_alias := 'Trader-' || upper(substr(v_hash, v_offset, 8));
    exit when not exists (
      select 1 from users u where u.leaderboard_alias = v_alias
    );

    v_offset := v_offset + 1;
    if v_offset > 24 then
      -- Exhausted the digest: fall back to something certainly unique rather
      -- than failing the insert.
      v_alias := 'Trader-' || upper(substr(md5(new.id::text || clock_timestamp()::text), 1, 8));
      exit;
    end if;
  end loop;

  new.leaderboard_alias := v_alias;
  return new;
end;
$$;

drop trigger if exists users_assign_leaderboard_alias on users;
create trigger users_assign_leaderboard_alias
  before insert on users
  for each row
  execute function rewards_assign_leaderboard_alias();

-- Backfill. The trigger only fires on insert, and every existing account needs
-- an alias before the leaderboard can stop reading usernames.
update users u
   set leaderboard_alias = 'Trader-' || upper(substr(md5(u.id::text), 1, 8))
 where u.leaderboard_alias is null;

-- ---------------------------------------------------------------------------
-- Ranking
-- ---------------------------------------------------------------------------

-- Serves the ordering below directly, so the top N is a bounded index scan
-- rather than a sort of the whole season.
create index if not exists user_points_season_volume_idx
  on user_points(season_id, total_volume desc, user_id);

/**
 * The season leaderboard, ranked and truncated by the database.
 *
 * Returns at most p_limit rows and no identifying information: an alias, the
 * numbers, and whether the row is the caller's own. `is_current_user` is what
 * lets the client highlight the caller without every other row carrying an
 * internal user id it has no use for.
 *
 * Ordering is by eligible volume, with the internal id as a tiebreak so equal
 * volumes rank deterministically rather than shuffling between requests.
 */
create or replace function rewards_season_leaderboard(
  p_season_id uuid,
  p_user_id uuid,
  p_limit int default 10
)
returns table (
  rank bigint,
  alias text,
  xp numeric,
  eligible_volume numeric,
  is_current_user boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    row_number() over (order by coalesce(p.total_volume, 0) desc, p.user_id),
    coalesce(u.leaderboard_alias, 'Trader'),
    coalesce(p.xp, 0)::numeric,
    coalesce(p.total_volume, 0)::numeric,
    p.user_id = p_user_id
  from user_points p
  join users u on u.id = p.user_id
  where p.season_id = p_season_id
  order by coalesce(p.total_volume, 0) desc, p.user_id
  limit greatest(1, least(p_limit, 100));
$$;

/**
 * The caller's own rank, which is usually outside the page above.
 *
 * Separate from the leaderboard query because they answer different questions:
 * one is "who is at the top", the other is "where am I". Merging them would
 * mean either ranking every row to render ten, or returning a page that is
 * sometimes eleven rows long for reasons the client has to special-case.
 */
create or replace function rewards_season_user_rank(
  p_season_id uuid,
  p_user_id uuid
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select rank from (
    select
      p.user_id,
      row_number() over (order by coalesce(p.total_volume, 0) desc, p.user_id) as rank
    from user_points p
    where p.season_id = p_season_id
  ) ranked
  where ranked.user_id = p_user_id;
$$;

-- security definer, and the leaderboard reads across every user in a season.
-- Revoking from PUBLIC alone is not enough: default privileges grant EXECUTE on
-- new functions in `public` to anon and authenticated by name. See the note in
-- 008_rewards_xp_accounting.sql.
revoke execute on function public.rewards_season_leaderboard(uuid, uuid, int) from public;
revoke execute on function public.rewards_season_user_rank(uuid, uuid) from public;
revoke execute on function public.rewards_assign_leaderboard_alias() from public;

revoke execute on function public.rewards_season_leaderboard(uuid, uuid, int) from anon, authenticated;
revoke execute on function public.rewards_season_user_rank(uuid, uuid) from anon, authenticated;
revoke execute on function public.rewards_assign_leaderboard_alias() from anon, authenticated;
