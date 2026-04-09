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
      className="w-full flex items-center gap-3 px-4 py-3 bg-white active:bg-gray-50 transition-colors text-left"
    >
      <TokenIcon coin={iconCoin} size={36} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-foreground text-sm truncate">{displayName}</span>
          <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">
            {marketType === 'perp'
              ? (maxLeverage ? `${maxLeverage}x` : t('trade.perp'))
              : t('common.spot')}
          </span>
        </div>
        {volume && (
          <span className="text-xs text-gray-400">
            {t('marketList.volume', { volume })}
          </span>
        )}
      </div>

      <div className="text-right flex-shrink-0 min-w-[76px]">
        {priceState === 'loading' ? (
          <div className="flex flex-col items-end animate-pulse">
            <div className="h-4 w-14 rounded bg-gray-200" />
            <div className="mt-1.5 h-3 w-10 rounded bg-gray-100" />
          </div>
        ) : priceState === 'error' ? (
          <div className="text-xs font-medium text-gray-400">
            {t('marketList.priceUnavailable')}
          </div>
        ) : (
          <>
            <div className="text-sm font-medium text-foreground">{price}</div>
            <div className={`text-xs font-medium ${isPositive ? 'text-positive' : 'text-negative'}`}>
              {changeText}
            </div>
          </>
        )}
      </div>
    </button>
  );
}
