-- Park outstanding cash entitlements while the rewards program is XP-only.
--
-- Quests, referrals and the weekly raffle used to write 'usdc' and 'raffle'
-- rows that a dashboard request would then try to settle over the wire. Those
-- writers now emit XP only, which stops new entitlements appearing -- but it
-- says nothing about the rows already sitting in the table.
--
-- A 'pending' cash row is a standing instruction to pay somebody the next time
-- something iterates it, and a 'failed' one is an invitation to retry. Neither
-- is true any more: nobody is owed a transfer, and nobody should be retried.
-- 'held' says exactly that -- frozen, awaiting reconciliation, not a claim --
-- and it is deliberately a state no ingestion path knows how to leave.
--
-- 'posted' is not touched, here or anywhere. A row that says money genuinely
-- left the treasury is the evidence reconciliation runs against, and rewriting
-- it would destroy the only record that a transfer happened.

alter table reward_ledger drop constraint if exists reward_ledger_status_check;

alter table reward_ledger
  add constraint reward_ledger_status_check
  check (status in ('posted', 'pending', 'failed', 'held'));

update reward_ledger
   set status = 'held'
 where status in ('pending', 'failed')
   and reward_kind in ('usdc', 'raffle');

-- Held rows are read by reconciliation, never by the user dashboard, and the
-- dashboard's history query filters on reward_kind rather than status. This
-- index serves the admin side without widening what a user can reach.
create index if not exists reward_ledger_held_idx
  on reward_ledger(status, reward_kind)
  where status = 'held';
