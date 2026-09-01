import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslation } from 'react-i18next';
import {
  truncateToDecimals,
  useArbitrumUsdcBalance,
  useUserState,
  useWithdraw,
} from '@repo/hyperliquid-sdk';
import { StableBalanceList } from '../../components/StableBalanceList';

/** USDC is quoted to cents here, and Max already offers no more than that. */
const AMOUNT_MAX_DECIMALS = 2;

/**
 * Reject the keystroke rather than reshaping the number.
 *
 * Deliberately identical in behaviour to the guard on the trade screen, so the
 * two can become one helper once both have landed. Truncating or rounding what
 * somebody typed into an amount field is the failure this file already carries
 * a comment about: `toFixed` turned 10.996 into "11.00", which is more than the
 * account held, and the exchange refused it.
 */
function acceptDecimalInput(
  next: string,
  previous: string,
  maxDecimals: number,
): string {
  if (next === '') return '';
  if (!/^\d*\.?\d*$/u.test(next)) return previous;
  const decimals = next.split('.')[1] ?? '';
  if (decimals.length > maxDecimals) return previous;
  return next.replace(/^0+(?=\d)/u, '');
}

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
  const withdrawable =
    userState?.stableBalances.USDC?.available ??
    userState?.withdrawableBalance ??
    0;
  const destination = user?.wallet?.address;
  // Polls every 10s, which is what makes the arrival visible: the balance
  // ticks up on this screen a few minutes after submitting, on the same screen
  // the user is already looking at.
  const { data: walletUsdc } = useArbitrumUsdcBalance(destination);
  // Cut, never round: toFixed turned 10.996 into "11.00", and the exchange
  // rejects a withdrawal of more than the account holds. The label uses the
  // same cut so "Available" never promises what Max cannot set.
  const withdrawableCut = truncateToDecimals(withdrawable, AMOUNT_MAX_DECIMALS);

  // Max was guarded and typing was not. Nothing sat between this field and
  // `withdraw3` — no decimal limit, and no upper bound at all, so any number
  // could be submitted and the exchange was left to refuse it.
  const amountNum = parseFloat(amount);
  const hasAmount = amount !== '' && Number.isFinite(amountNum) && amountNum > 0;
  // Against the untruncated balance: Max offers the cut value, but a user who
  // types the extra fractional cents is asking for something they do hold.
  const exceedsBalance = hasAmount && amountNum > withdrawable;

  return (
    <div className="editorial-page px-4 py-5 space-y-4">
      <div>
        <p className="editorial-kicker">{t('nav.account')}</p>
        <h1 className="editorial-heading text-foreground">{t('withdraw.title')}</h1>
      </div>

      <StableBalanceList balances={visibleStableBalances} />

      <div className="rounded-[18px] border border-separator bg-white p-4 space-y-3">
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
        {/* The address alone told the user nothing. A withdrawal leaves the
            trading account entirely and lands in their own wallet, so every
            balance on the account screen correctly reads zero afterwards --
            which reads as the money having disappeared unless we say this. */}
        <p className="text-xs text-muted">{t('withdraw.destinationHint')}</p>
        <div className="flex items-center justify-between border-t border-separator pt-3">
          <span className="text-sm text-muted">{t('withdraw.walletBalance')}</span>
          <span className="font-semibold text-foreground">
            {t('withdraw.walletBalanceAmount', {
              amount: truncateToDecimals(walletUsdc ?? 0, 2),
            })}
          </span>
        </div>
        {isUnifiedLike && (
          <p className="text-xs text-muted">{t('withdraw.unifiedHint')}</p>
        )}
      </div>

      <div className="rounded-[18px] border border-separator bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="withdraw-amount" className="text-sm font-semibold text-foreground">{t('withdraw.amount')}</label>
          <span className="text-xs text-muted">{t('withdraw.available', { amount: withdrawableCut })}</span>
        </div>
        <div className="flex gap-2">
          <input
            id="withdraw-amount"
            type="number"
            name="withdraw-amount"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) =>
              setAmount((previous) =>
                acceptDecimalInput(event.target.value, previous, AMOUNT_MAX_DECIMALS),
              )
            }
            placeholder="0.00"
            className="flex-1 rounded-xl border border-separator bg-surface px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          <button type="button" onClick={() => setAmount(withdrawableCut)} className="rounded-xl bg-surface px-4 py-3 text-sm font-semibold text-primary">
            {t('common.max')}
          </button>
        </div>
        <button
          type="button"
          onClick={() => withdraw.mutate({ destination: destination ?? '', amount })}
          disabled={!destination || !hasAmount || exceedsBalance || withdraw.isPending}
          className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {withdraw.isPending ? t('common.submitting') : t('withdraw.withdrawButton')}
        </button>
        {/* Says why the button is dead. A disabled control with no explanation
            reads as the app being broken rather than the amount being wrong. */}
        {exceedsBalance && (
          <p className="text-sm text-negative">
            {t('withdraw.exceedsBalance', { amount: withdrawableCut })}
          </p>
        )}
        {withdraw.isSuccess && <p className="text-sm text-positive">{t('withdraw.withdrawSubmitted')}</p>}
        {withdraw.isError && <p className="text-sm text-negative">{withdraw.error instanceof Error ? withdraw.error.message : t('withdraw.withdrawFailed')}</p>}
        <p className="text-xs text-muted">{t('withdraw.withdrawFee')}</p>
      </div>
    </div>
  );
}
