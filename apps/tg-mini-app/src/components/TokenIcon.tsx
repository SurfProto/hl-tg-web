import { useState } from 'react';

interface TokenIconProps {
  coin: string;
  size?: number;
}

export function TokenIcon({ coin, size = 32 }: TokenIconProps) {
  const [imgError, setImgError] = useState(false);

  const cdnUrl = `https://app.hyperliquid.xyz/coins/${coin.toUpperCase()}.svg`;
  const initials = coin.replace(/[^A-Z0-9]/gi, '').slice(0, 2).toUpperCase();

  if (imgError) {
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
      src={cdnUrl}
      alt={coin}
      width={size}
      height={size}
      className="rounded-full flex-shrink-0"
      style={{ width: size, height: size }}
      onError={() => setImgError(true)}
    />
  );
}
