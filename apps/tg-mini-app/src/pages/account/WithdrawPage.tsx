import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslation } from 'react-i18next';
import { useUserState, useWithdraw } from '@repo/hyperliquid-sdk';
import { StableBalanceList } from '../../components/StableBalanceList';

export function WithdrawPage() {
  const { user } = usePrivy();
  const { t } = useTranslation();
  const { data: userState } = useUserState();
  const withdraw = useWithdraw();
  const [amount, setAmount] = useState('');

  const isUnifiedLike =
    userState?.abstractionMode === 'unifiedAccount' ||
    userState?.abstractionMode === 'portfolioMargin' ||
    userState?.abstractionMode === 'dexAbstraction';
  const visibleStableBalances = userState?.visibleStableBalances ?? [];
  const withdrawable = isUnifiedLike
    ? (userState?.stableBalances.USDC?.available ?? 0)
    : (userState?.withdrawable ?? 0);
  const destination = user?.wallet?.address;

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <h1 className="text-2xl font-bold text-foreground">{t('withdraw.title')}</h1>

      <StableBalanceList balances={visibleStableBalances} />

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">{t('withdraw.asset')}</span>
          <span className="font-semibold text-foreground">{t('common.usdc')}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">{t('withdraw.chain')}</span>
          <span className="font-semibold text-foreground">{t('common.arbitrum')}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="min-w-0 truncate text-sm text-muted">{t('withdraw.destination')}</span>
          <span className="flex-shrink-0 text-right font-mono text-xs text-foreground">{destination ? `${destination.slice(0, 6)}...${destination.slice(-4)}` : t('withdraw.noWallet')}</span>
        </div>
        {isUnifiedLike && (
          <p className="text-xs text-muted">{t('withdraw.unifiedHint')}</p>
        )}
      </div>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="withdraw-amount" className="text-sm font-semibold text-foreground">{t('withdraw.amount')}</label>
          <span className="text-xs text-muted">{t('withdraw.available', { amount: withdrawable.toFixed(2) })}</span>
        </div>
        <div className="flex gap-2">
          <input
            id="withdraw-amount"
            type="number"
            name="withdraw-amount"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            className="flex-1 rounded-2xl border border-separator bg-surface px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          <button type="button" onClick={() => setAmount(withdrawable.toFixed(2))} className="rounded-2xl bg-surface px-4 py-3 text-sm font-semibold text-primary">
            {t('common.max')}
          </button>
        </div>
        <button
          type="button"
          onClick={() => withdraw.mutate({ destination: destination ?? '', amount })}
          disabled={!destination || !amount || parseFloat(amount) <= 0 || withdraw.isPending}
          className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {withdraw.isPending ? t('common.submitting') : t('withdraw.withdrawButton')}
        </button>
        {withdraw.isSuccess && <p className="text-sm text-positive">{t('withdraw.withdrawSubmitted')}</p>}
        {withdraw.isError && <p className="text-sm text-negative">{withdraw.error instanceof Error ? withdraw.error.message : t('withdraw.withdrawFailed')}</p>}
        <p className="text-xs text-muted">{t('withdraw.withdrawFee')}</p>
      </div>
    </div>
  );
}
