-- The referral funnel, as evidence rather than as a single event.
--
-- Today a referral pays once, when a friend's first deposit lands, and the
-- idempotency key is `quest:{season}:{referrer}:referral_funded_friend:xp` —
-- one row per referrer per season. Refer ten funded friends and get paid for
-- one. The key needs the referred user in it, and the funnel needs more than
-- one rung.
--
-- Each rung below is a claim about behaviour that costs something real to fake:
--
--   funded    money arrived and stayed put for a holding period, so deposit,
--             trigger, withdraw earns nothing
--   traded    two distinct orders that paid us builder fees — orders, not
--             fills, so one order filling in pieces is still one order
--   retained  activity spread across separate days including one late in the
--             month, which is the only rung that cannot be compressed into an
--             afternoon
--
-- Wallet creation pays nothing at all. An empty wallet costs an attacker
-- nothing, and if XP ever backs an allocation, paying for one means paying out
-- cap table for a bot. It is recorded for analytics and nothing more.
--
-- Attribution is direct only: no multi-level tree. Paying people for their
-- recruits' recruits recruits recruiters, not traders.
--
-- Everything here is derived from evidence already in the database — onramp
-- orders and the builder fee now recorded on every volume grant — so it is
-- recomputable, and a rung once earned cannot be un-earned by a later query.

/**
 * Referral rungs that have been earned, as (referrer, referee, milestone).
 *
 * Returns every qualifying rung on every call rather than only newly qualified
 * ones. The caller writes them to an append-only ledger keyed by referee and
 * milestone, so re-writing an existing grant is free and there is no cursor to
 * keep, no diff to compute, and no way for a missed run to lose a milestone.
 *
 * Thresholds are parameters because they will be tuned; the defaults are the
 * ones in the moat design.
 */
create or replace function rewards_referral_milestones(
  p_funded_min_usd numeric default 50,
  p_funded_hold_hours int default 72,
  p_traded_min_orders int default 2,
  p_traded_min_fee_usd numeric default 0.10,
  p_traded_within_days int default 30,
  p_retained_min_days int default 3,
  p_retained_min_fee_usd numeric default 1.00,
  p_retained_late_from_day int default 22,
  p_retained_late_to_day int default 30
)
returns table (
  referrer_id uuid,
  referee_id uuid,
  milestone text,
  qualified_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with referred as (
    select u.id as referee_id, u.referred_by as referrer_id
    from users u
    where u.referred_by is not null
      -- Self-referral cannot be reached through the apply mutation, but a rung
      -- that pays real XP should not depend on that staying true.
      and u.referred_by <> u.id
  ),
  -- Funding that arrived and stayed. The hold is what makes deposit-trigger-
  -- withdraw worthless.
  funded as (
    select
      r.referee_id,
      min(o.created_at) as funded_at
    from referred r
    join onramp_orders o on o.user_id = r.referee_id
    where o.app_state = 'success'
      and coalesce(o.payout_amount, o.payin_amount, '0')::numeric >= p_funded_min_usd
      and o.created_at <= now() - make_interval(hours => p_funded_hold_hours)
    group by r.referee_id
  ),
  -- Trading that paid us. The order id is the third segment of the fill key
  -- (tid:hash:oid), so a single order filling in pieces counts once.
  trades as (
    select
      l.user_id as referee_id,
      l.created_at,
      split_part(l.metadata->>'fillKey', ':', 3) as order_id,
      coalesce((l.metadata->>'builderFeeUsd')::numeric, 0) as fee
    from reward_ledger l
    where l.source = 'volume_xp'
      and l.status = 'posted'
      and l.metadata ? 'fillKey'
  ),
  traded as (
    select
      f.referee_id,
      max(t.created_at) as qualified_at
    from funded f
    join trades t
      on t.referee_id = f.referee_id
     and t.created_at >= f.funded_at
     and t.created_at < f.funded_at + make_interval(days => p_traded_within_days)
    group by f.referee_id
    having count(distinct t.order_id) >= p_traded_min_orders
       and sum(t.fee) >= p_traded_min_fee_usd
  ),
  retained as (
    select
      f.referee_id,
      max(t.created_at) as qualified_at
    from funded f
    join trades t on t.referee_id = f.referee_id and t.created_at >= f.funded_at
    group by f.referee_id
    having count(distinct (t.created_at at time zone 'utc')::date) >= p_retained_min_days
       and sum(t.fee) >= p_retained_min_fee_usd
       -- The rung that cannot be compressed into one afternoon: something has
       -- to happen late in the month.
       and count(*) filter (
             where t.created_at >= f.funded_at + make_interval(days => p_retained_late_from_day)
               and t.created_at < f.funded_at + make_interval(days => p_retained_late_to_day + 1)
           ) > 0
  )
  select r.referrer_id, r.referee_id, 'funded'::text, f.funded_at
  from referred r join funded f on f.referee_id = r.referee_id
  union all
  select r.referrer_id, r.referee_id, 'traded'::text, t.qualified_at
  from referred r join traded t on t.referee_id = r.referee_id
  union all
  select r.referrer_id, r.referee_id, 'retained'::text, x.qualified_at
  from referred r join retained x on x.referee_id = r.referee_id;
$$;

/**
 * Referral funnel counts, for the reconciliation surface.
 *
 * `dry` is every referred account, including those that never funded. It earns
 * nothing, but the ratio between it and the paying rungs is the clearest signal
 * that somebody is manufacturing accounts.
 */
create or replace function rewards_referral_funnel()
returns table (
  dry bigint,
  funded bigint,
  traded bigint,
  retained bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with m as (select * from rewards_referral_milestones())
  select
    (select count(*) from users where referred_by is not null),
    (select count(*) from m where milestone = 'funded'),
    (select count(*) from m where milestone = 'traded'),
    (select count(*) from m where milestone = 'retained');
$$;

revoke execute on function public.rewards_referral_milestones(numeric, int, int, numeric, int, int, numeric, int, int) from public;
revoke execute on function public.rewards_referral_funnel() from public;

revoke execute on function public.rewards_referral_milestones(numeric, int, int, numeric, int, int, numeric, int, int) from anon, authenticated;
revoke execute on function public.rewards_referral_funnel() from anon, authenticated;
