import { TokenIcon } from './TokenIcon';
import { useTranslation } from 'react-i18next';

interface MarketListItemProps {
  coin: string;
  displayName: string;
  iconCoin: string;
  marketType: 'perp' | 'spot';
  price: string;
  change24h?: number | null;
  priceState?: 'ready' | 'loading' | 'error';
  volume?: string;
  maxLeverage?: number;
  onClick: () => void;
}

export function MarketListItem({
  coin,
  displayName,
  iconCoin,
  marketType,
  price,
  change24h,
  priceState = 'ready',
  volume,
  maxLeverage,
  onClick,
}: MarketListItemProps) {
  const { t } = useTranslation();
  const resolvedChange = change24h ?? 0;
  const isPositive = resolvedChange >= 0;
  const changeText = `${isPositive ? '+' : ''}${resolvedChange.toFixed(2)}%`;

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 bg-white px-4 py-3.5 text-left transition-colors active:bg-surface"
    >
      <TokenIcon coin={iconCoin} size={36} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-foreground truncate">{displayName}</span>
          {maxLeverage ? (
            <span className="rounded-full bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-muted">
              {maxLeverage}x
            </span>
          ) : null}
        </div>
        <span className="editorial-kicker mt-1 block">
          {marketType}
        </span>
      </div>

      {/* No sparkline: the one that sat here drew one of two fixed paths
          chosen by the sign of the 24h change — an invented price trend on a
          trading screen. The change chip below carries the same signal
          honestly. */}
      <div className="text-right flex-shrink-0 min-w-[72px]">
        {priceState === 'loading' ? (
          <div className="flex flex-col items-end animate-pulse">
            <div className="h-5 w-16 rounded bg-surface" />
            <div className="mt-1 h-3 w-12 rounded bg-surface/60" />
          </div>
        ) : priceState === 'error' ? (
          <div className="text-xs font-medium text-muted">
            {t('marketList.priceUnavailable')}
          </div>
        ) : (
          <>
            <div className="editorial-mono text-base font-semibold text-foreground">{price}</div>
            <div className={`text-xs font-medium mt-0.5 ${isPositive ? 'text-positive' : 'text-negative'}`}>
              {changeText}
            </div>
          </>
        )}
      </div>
    </button>
  );
}
