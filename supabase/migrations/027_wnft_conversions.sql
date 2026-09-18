-- WNFT — an internal conversion record. Not an on-chain NFT and not money:
-- a durable statement that an account became a genuine repeat trader on P34K,
-- derived only from *reconciled* builder_fills (Hyperliquid's own export of
-- the fills that paid our builder), never from self-reported or
-- unspecified-builder fills.
--
-- One record per user. Status is a one-way review flow:
--   provisional  — the derivation qualified them; nothing is owed and no
--                  bounty is payable. This is the "held" state point 5 asks
--                  for: a human confirms or rejects before anything downstream.
--   confirmed    — a human approved it. Still not money on its own; the cash
--                  bounty is a separate, gated relaunch track.
--   rejected     — a human declined it, with a recorded reason (abuse,
--                  self-referral, recycled funding, coordinated trading, …).
--
-- The qualifying evidence is stored alongside the status so a reviewer sees
-- what qualified the account without re-deriving it: how many distinct
-- qualifying orders, their total notional, and when the second one (the
-- conversion moment) completed.

create table if not exists wnft_conversions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,

  status text not null default 'provisional'
    check (status in ('provisional', 'confirmed', 'rejected')),

  -- Evidence, as of the last derivation.
  qualifying_order_count integer not null default 0,
  qualifying_notional_usd numeric not null default 0,
  -- When the account crossed into "converted": the completion time of the
  -- second qualifying order.
  converted_at timestamptz,

  -- Review outcome. Set together with a terminal status; a rejection without a
  -- reason is not a decision anyone can audit.
  reviewed_at timestamptz,
  reviewed_by text,
  review_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Reviewers work the queue of accounts awaiting a decision.
create index if not exists wnft_conversions_provisional_idx
  on wnft_conversions (converted_at)
  where status = 'provisional';

-- Service-role only, like every table here: RLS on with no policies denies
-- anon and authenticated outright; the API's service role bypasses RLS. A
-- conversion record is operator data, never a client read.
alter table wnft_conversions enable row level security;

-- A terminal status must carry its audit trail. Enforced in the database so no
-- code path can confirm or reject without recording who and why.
alter table wnft_conversions drop constraint if exists wnft_conversions_review_audited;
alter table wnft_conversions add constraint wnft_conversions_review_audited check (
  status = 'provisional'
  or (reviewed_at is not null and reviewed_by is not null)
);
