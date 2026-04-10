import btcIcon from '../assets/coins/btc.svg';
import ethIcon from '../assets/coins/eth.svg';
import hypeIcon from '../assets/coins/hype.svg';
import solIcon from '../assets/coins/sol.svg';
import usdcIcon from '../assets/coins/usdc.svg';
import usdtIcon from '../assets/coins/usdt.svg';

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
  const normalizedCoin = coin.toUpperCase();
  const icon = LOCAL_COIN_ICONS[normalizedCoin];
  const initials = coin.replace(/[^A-Z0-9]/gi, '').slice(0, 2).toUpperCase();

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
      alt={coin}
      width={size}
      height={size}
      className="rounded-full flex-shrink-0"
      style={{ width: size, height: size }}
    />
  );
}
