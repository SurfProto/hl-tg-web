import btcIcon from '../assets/coins/btc.svg';
import ethIcon from '../assets/coins/eth.svg';
import hypeIcon from '../assets/coins/hype.svg';
import solIcon from '../assets/coins/sol.svg';
import usdcIcon from '../assets/coins/usdc.svg';
import usdtIcon from '../assets/coins/usdt.svg';
import { getIconInitials, getIconSymbol } from '../lib/icon-symbol';

interface TokenIconProps {
  coin: string;
  size?: number;
}

const LOCAL_COIN_ICONS: Record<string, string> = {
  BTC: btcIcon,
  ETH: ethIcon,
  HYPE: hypeIcon,
  SOL: solIcon,
  USDC: usdcIcon,
  USDT: usdtIcon,
};

export function TokenIcon({ coin, size = 32 }: TokenIconProps) {
  // Callers hold different shapes: fill.coin is dex-prefixed and quote-suffixed,
  // a market list passes a display name, a plain perp is just BTC. Resolve to
  // the symbol first, so a dex-listed BTC finds the BTC icon and two markets on
  // one dex do not both render that dex's first two letters.
  const symbol = getIconSymbol(coin);
  const icon = LOCAL_COIN_ICONS[symbol.toUpperCase()];
  const initials = getIconInitials(coin);

  if (!icon) {
    return (
      <div
        style={{ width: size, height: size, fontSize: size * 0.35 }}
        className="rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold flex-shrink-0"
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      src={icon}
      alt={symbol || coin}
      width={size}
      height={size}
      className="rounded-full flex-shrink-0"
      style={{ width: size, height: size }}
    />
  );
}
