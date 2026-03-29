import { TokenIcon } from './TokenIcon';

interface MarketListItemProps {
  coin: string;
  marketType: 'perp' | 'spot';
  price: string;
  change24h: number;
  volume?: string;
  maxLeverage?: number;
  isHip3?: boolean;
  onClick: () => void;
}

export function MarketListItem({
  coin,
  marketType,
  price,
  change24h,
  volume,
  maxLeverage,
  isHip3,
  onClick,
}: MarketListItemProps) {
  const isPositive = change24h >= 0;
  const changeText = `${isPositive ? '+' : ''}${change24h.toFixed(2)}%`;

  const displayName = coin.includes(':') ? coin.split(':')[1] : coin;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 bg-white active:bg-gray-50 transition-colors text-left"
    >
      <TokenIcon coin={displayName} size={36} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-foreground text-sm truncate">{displayName}</span>
          {isHip3 && (
            <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">
              HIP-3
            </span>
          )}
          {!isHip3 && (
            <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">
              {marketType === 'perp' ? (maxLeverage ? `${maxLeverage}x` : 'PERP') : 'SPOT'}
            </span>
          )}
        </div>
        {volume && (
          <span className="text-xs text-gray-400">Vol {volume}</span>
        )}
      </div>

      <div className="text-right flex-shrink-0">
        <div className="text-sm font-medium text-foreground">{price}</div>
        <div className={`text-xs font-medium ${isPositive ? 'text-positive' : 'text-negative'}`}>
          {changeText}
        </div>
      </div>
    </button>
  );
}
