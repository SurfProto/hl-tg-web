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

// Simple sparkline SVG that mimics a price trend
function MiniSparkline({ isPositive }: { isPositive: boolean }) {
  const color = isPositive ? '#00C076' : '#dc2626';
  // Different path patterns for visual variety
  const paths = isPositive
    ? 'M0,20 L8,18 L16,15 L24,16 L32,12 L40,8 L48,10 L56,5'
    : 'M0,5 L8,8 L16,6 L24,10 L32,12 L40,15 L48,14 L56,18';
  
  return (
    <svg
      width="56"
      height="24"
      viewBox="0 0 56 24"
      fill="none"
      className="flex-shrink-0"
    >
      <path
        d={paths}
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
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
      className="w-full rounded-[24px] border border-transparent bg-white px-4 py-3.5 text-left transition-colors active:bg-slate-50"
    >
      <TokenIcon coin={iconCoin} size={40} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-foreground truncate">{displayName}</span>
        </div>
        <span className="editorial-kicker mt-1 block">
          {marketType}
        </span>
      </div>

      {/* Mini sparkline chart */}
      <div className="flex-shrink-0">
        <MiniSparkline isPositive={isPositive} />
      </div>

      <div className="text-right flex-shrink-0 min-w-[72px]">
        {priceState === 'loading' ? (
          <div className="flex flex-col items-end animate-pulse">
            <div className="h-5 w-16 rounded bg-gray-200" />
            <div className="mt-1 h-3 w-12 rounded bg-gray-100" />
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
