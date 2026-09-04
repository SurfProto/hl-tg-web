-- First-touch attribution — where an account came from, recorded once.
--
-- Immutable by construction: user_id is the primary key and every write is
-- insert-if-absent, so the first authenticated session's captured source wins
-- and nothing later can overwrite it. This is the "immutable campaign code
-- preserved through reopening, authentication and wallet creation" of the
-- growth spec's point 3 — the preservation is client-side (the code is held in
-- the mini app's storage from the first open until the first authenticated
-- call), and the permanence is here (first write sticks forever).
--
-- Deliberately not an affiliate portal. One row per user: the channel they
-- arrived through, the raw Telegram start_param it came from, and when.
--   source 'campaign'  — arrived via a marketing deep link with a code
--   source 'referral'  — arrived via a user's referral link (the referral
--                        system records who; this only notes the channel)
--   source 'direct'    — no attribution on the first open

create table if not exists user_attribution (
  user_id uuid primary key references users(id) on delete cascade,
  source text not null check (source in ('campaign', 'referral', 'direct')),
  -- Null for 'referral' and 'direct'. Lowercase, [a-z0-9_-], as sanitised on
  -- the way in.
  campaign_code text,
  -- The exact start_param, kept verbatim for audit even when the derived code
  -- is null — so a malformed or unexpected link is still traceable.
  raw_start_param text,
  first_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists user_attribution_campaign_idx
  on user_attribution (campaign_code)
  where campaign_code is not null;

-- Service-role only, like every table here.
alter table user_attribution enable row level security;
