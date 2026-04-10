import { useTranslation } from 'react-i18next';

export function PointsPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <div className="rounded-3xl bg-primary px-5 py-6 text-white shadow-sm">
        <p className="text-xs uppercase tracking-[0.24em] text-blue-100">{t('points.seasonOne')}</p>
        <p className="mt-3 text-4xl font-bold">{t('points.zeroXp')}</p>
        <p className="mt-2 text-sm text-blue-100">{t('points.emptyDescription')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          [t('points.totalVolume'), '\u2014'],
          [t('points.xpEarned'), '\u2014'],
          [t('points.referralVolume'), '\u2014'],
          [t('points.referrals'), '\u2014'],
          [t('points.multiplier'), '1.0x'],
          [t('points.weeklyPool'), 'TBD'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-foreground">{t('points.inviteToEarn')}</p>
        <div className="mt-3 flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <div>
            <p className="text-xs text-muted">{t('points.referralCode')}</p>
            <p className="mt-1 font-mono text-sm font-semibold text-foreground">XXXXXX</p>
          </div>
          <button className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-muted border border-separator" disabled>
            {t('common.share')}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-foreground">{t('points.affiliateTiers')}</p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {[t('points.tier1'), t('points.tier2'), t('points.tier3')].map((tier) => (
            <div key={tier} className="rounded-2xl bg-surface p-4 text-center">
              <p className="text-xs text-muted">{tier}</p>
              <p className="mt-2 text-lg font-semibold text-foreground">$0.00</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-foreground">{t('points.tradingRewards')}</p>
        <p className="mt-2 text-sm text-muted">{t('points.weeklyPoolTbd')}</p>
        <p className="mt-1 text-sm text-muted">{t('points.yourVolume')}</p>
        <button disabled className="mt-4 w-full rounded-full bg-surface px-4 py-3 text-sm font-semibold text-muted">
          {t('points.claimComingSoon')}
        </button>
      </div>

      <div className="rounded-2xl border border-dashed border-separator bg-white p-6 text-center shadow-sm">
        <p className="text-base font-semibold text-foreground">{t('points.awardsComingSoon')}</p>
        <p className="mt-2 text-sm text-muted">{t('points.awardsDescription')}</p>
      </div>
    </div>
  );
}
