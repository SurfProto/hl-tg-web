import { useState } from 'react';
import { useSpotBalance, useUsdClassTransfer, useUserState } from '@repo/hyperliquid-sdk';
import { useTranslation } from 'react-i18next';

export function TransferPage() {
  const { t, i18n } = useTranslation();
  const [direction, setDirection] = useState<'perps-to-spot' | 'spot-to-perps'>('perps-to-spot');
  const [amount, setAmount] = useState('');
  const transfer = useUsdClassTransfer();
  const { data: userState } = useUserState();
  const { data: spotBalance } = useSpotBalance();
  const isUnifiedLike =
    userState?.abstractionMode === 'unifiedAccount' ||
    userState?.abstractionMode === 'portfolioMargin' ||
    userState?.abstractionMode === 'dexAbstraction';

  const perpsTransferable =
    userState?.stableBalances.USDC?.perp?.available ??
    userState?.stableBalances.USDC?.available ??
    userState?.withdrawableBalance ??
    0;
  const spotUsdcEntry = spotBalance?.balances?.find((balance: any) => balance.coin === 'USDC');
  const spotUsdcAvailable = spotUsdcEntry
    ? Math.max(0, parseFloat(spotUsdcEntry.total ?? '0') - parseFloat(spotUsdcEntry.hold ?? '0'))
    : 0;
  const fromBalance = direction === 'perps-to-spot' ? perpsTransferable : spotUsdcAvailable;
  const formattedBalance = fromBalance.toLocaleString(i18n.language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <h1 className="text-2xl font-bold text-foreground">{t('transfer.title')}</h1>
      {isUnifiedLike && (
        <p className="text-sm text-muted">
          {t('transfer.unifiedHint')}
        </p>
      )}

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-4">
        <div className="flex items-center justify-center gap-3">
          <span className={`text-sm font-semibold ${direction === 'perps-to-spot' ? 'text-foreground' : 'text-muted'}`}>{t('common.perps')}</span>
          <button
            type="button"
            onClick={() => {
              setDirection((current) => current === 'perps-to-spot' ? 'spot-to-perps' : 'perps-to-spot');
              setAmount('');
            }}
            className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-primary"
            aria-label={t('transfer.flipDirection')}
          >
            {'\u21c4'}
          </button>
          <span className={`text-sm font-semibold ${direction === 'spot-to-perps' ? 'text-foreground' : 'text-muted'}`}>{t('common.spot')}</span>
        </div>

        <div className="flex items-center justify-between">
          <label htmlFor="transfer-amount" className="text-sm font-semibold text-foreground">{t('transfer.amount')}</label>
          <span className="text-xs text-muted">{t('transfer.availableToTransfer', { amount: formattedBalance })}</span>
        </div>

        <div className="flex gap-2">
          <input
            id="transfer-amount"
            type="number"
            name="transfer-amount"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            className="flex-1 rounded-2xl border border-separator bg-surface px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          <button type="button" onClick={() => setAmount(fromBalance.toFixed(2))} className="rounded-2xl bg-surface px-4 py-3 text-sm font-semibold text-primary">
            {t('common.max')}
          </button>
        </div>

        <button
          type="button"
          onClick={() => transfer.mutate({ amount, toPerp: direction === 'spot-to-perps' })}
          disabled={!amount || parseFloat(amount) <= 0 || transfer.isPending}
          className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {transfer.isPending ? t('common.submitting') : t('transfer.confirm')}
        </button>
        {transfer.isSuccess && <p className="text-sm text-positive">{t('transfer.success')}</p>}
        {transfer.isError && <p className="text-sm text-negative">{transfer.error instanceof Error ? transfer.error.message : t('transfer.failed')}</p>}
      </div>
    </div>
  );
}
