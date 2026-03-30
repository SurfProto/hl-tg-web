export function PointsPage() {
  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <div className="rounded-3xl bg-primary px-5 py-6 text-white shadow-sm">
        <p className="text-xs uppercase tracking-[0.24em] text-blue-100">Season One</p>
        <p className="mt-3 text-4xl font-bold">0 XP</p>
        <p className="mt-2 text-sm text-blue-100">Season XP, referrals, and weekly rewards will show up here.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          ['Total Volume', '—'],
          ['XP Earned', '—'],
          ['Referral Volume', '—'],
          ['Referrals', '—'],
          ['Multiplier', '1.0x'],
          ['Weekly Pool', 'TBD'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-foreground">Invite to earn</p>
        <div className="mt-3 flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <div>
            <p className="text-xs text-muted">Referral code</p>
            <p className="mt-1 font-mono text-sm font-semibold text-foreground">XXXXXX</p>
          </div>
          <button className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-muted border border-separator" disabled>
            Share
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-foreground">Affiliate tiers</p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {['Tier 1', 'Tier 2', 'Tier 3'].map((tier) => (
            <div key={tier} className="rounded-2xl bg-surface p-4 text-center">
              <p className="text-xs text-muted">{tier}</p>
              <p className="mt-2 text-lg font-semibold text-foreground">$0.00</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-foreground">Trading rewards</p>
        <p className="mt-2 text-sm text-muted">Weekly pool: TBD</p>
        <p className="mt-1 text-sm text-muted">Your volume: $0.00</p>
        <button disabled className="mt-4 w-full rounded-full bg-surface px-4 py-3 text-sm font-semibold text-muted">
          Claim coming soon
        </button>
      </div>

      <div className="rounded-2xl border border-dashed border-separator bg-white p-6 text-center shadow-sm">
        <p className="text-base font-semibold text-foreground">Awards coming soon</p>
        <p className="mt-2 text-sm text-muted">Badges, streaks, and referral unlocks will appear here in a later phase.</p>
      </div>
    </div>
  );
}
