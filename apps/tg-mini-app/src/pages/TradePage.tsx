import { useMemo, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import {
  useMids,
  useMarketData,
  useUserState,
  useSpotBalance,
  usePlaceOrder,
  usePlaceSpotOrder,
  useUpdateLeverage,
  useBuilderFeeApproval,
  useApproveBuilderFee,
  isBuilderConfigured,
} from '@repo/hyperliquid-sdk';
import type { Order } from '@repo/types';
import { NumPad } from '../components/NumPad';
import { TokenIcon } from '../components/TokenIcon';
import { useHaptics } from '../hooks/useHaptics';

function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(6)}`;
}

const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 20, 25, 50];

export function TradePage() {
  const { symbol: rawSymbol = 'BTC' } = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(rawSymbol);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const haptics = useHaptics();
  const { authenticated } = usePrivy();

  const [amount, setAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [step, setStep] = useState<'amount' | 'price'>('amount');
  const [leverage, setLeverage] = useState(1);
  const [tif, setTif] = useState<'Gtc' | 'Alo' | 'Ioc'>('Gtc');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const side: 'buy' | 'sell' = useMemo(() => {
    const s = searchParams.get('side');
    return s === 'long' || s === 'buy' ? 'buy' : 'sell';
  }, [searchParams]);

  const { data: markets } = useMarketData();
  const { data: mids } = useMids();
  const { data: userState } = useUserState();
  const { data: spotBalance } = useSpotBalance();
  const { data: maxBuilderFee, isLoading: isApprovalLoading } = useBuilderFeeApproval();
  const approveBuilder = useApproveBuilderFee();
  const placeOrder = usePlaceOrder();
  const placeSpotOrder = usePlaceSpotOrder();
  const updateLeverage = useUpdateLeverage();

  // Display name helpers
  const displayName = useMemo(() => {
    const withoutDex = symbol.includes(':') ? symbol.split(':')[1] : symbol;
    return withoutDex.includes('/') ? withoutDex.split('/')[0] : withoutDex;
  }, [symbol]);

  const baseToken = useMemo(
    () => (displayName.includes('/') ? displayName.split('/')[0] : displayName),
    [displayName],
  );

  const isPerp = useMemo(
    () => markets?.perp?.some((m: any) => m.name === symbol) ?? false,
    [markets, symbol],
  );

  const maxLeverage = useMemo(
    () => (markets?.perp as any[])?.find((m) => m.name === symbol)?.maxLeverage ?? 50,
    [markets, symbol],
  );

  const leverageOptions = useMemo(
    () => LEVERAGE_OPTIONS.filter((lv) => lv <= maxLeverage),
    [maxLeverage],
  );

  const currentPrice = mids?.[symbol] ? parseFloat(mids[symbol]) : null;

  const spotUsdcBalance = useMemo(() => {
    const entry = (spotBalance?.balances as Array<{ coin: string; total: string }> | undefined)
      ?.find((b) => b.coin === 'USDC');
    return entry ? parseFloat(entry.total) : 0;
  }, [spotBalance]);

  const spotCoinBalance = useMemo(() => {
    const entry = (spotBalance?.balances as Array<{ coin: string; total: string }> | undefined)
      ?.find((b) => b.coin === baseToken);
    return entry ? parseFloat(entry.total) : 0;
  }, [spotBalance, baseToken]);

  const availableUsd = useMemo(() => {
    if (isPerp) return (userState as any)?.withdrawable ?? 0;
    if (side === 'buy') return spotUsdcBalance;
    return spotCoinBalance * (currentPrice ?? 0);
  }, [isPerp, side, userState, spotUsdcBalance, spotCoinBalance, currentPrice]);

  const amountNum = parseFloat(amount) || 0;
  const limitPriceNum = parseFloat(limitPrice) || 0;

  const liquidationPx = useMemo(() => {
    if (!isPerp || amountNum === 0 || !currentPrice || leverage <= 1) return null;
    return side === 'buy'
      ? currentPrice * (1 - 1 / leverage)
      : currentPrice * (1 + 1 / leverage);
  }, [isPerp, amountNum, currentPrice, leverage, side]);

  const builderConfigured = isBuilderConfigured();
  const isBuilderApproved = (maxBuilderFee ?? 0) > 0;
  const needsApproval = authenticated && builderConfigured && !isApprovalLoading && !isBuilderApproved;

  const ctaLabel = isPerp
    ? side === 'buy' ? `Long ${displayName}` : `Short ${displayName}`
    : side === 'buy' ? `Buy ${displayName}` : `Sell ${displayName}`;

  const isPending = placeOrder.isPending || placeSpotOrder.isPending;
  const isSubmitDisabled = amountNum === 0 || isPending;

  // ── Event handlers ──────────────────────────────────

  const handleQuickFill = (pct: number) => {
    haptics.light();
    setAmount(String(Math.floor(availableUsd * pct * 100) / 100));
  };

  const handleLeveragePill = (lv: number) => {
    haptics.selection();
    setLeverage(lv);
    updateLeverage.mutate({ coin: symbol, leverage: lv });
  };

  const handleOrderTypeToggle = (type: 'market' | 'limit') => {
    haptics.light();
    setOrderType(type);
    setStep('amount');
  };

  const handlePrimaryAction = async () => {
    setSubmitError(null);

    if (needsApproval) {
      try {
        haptics.medium();
        await approveBuilder.mutateAsync();
        haptics.success();
      } catch {
        haptics.error();
      }
      return;
    }

    if (orderType === 'limit' && step === 'amount') {
      haptics.light();
      setStep('price');
      return;
    }

    haptics.medium();

    const order: Order = {
      coin: symbol,
      side,
      sizeUsd: amountNum,
      orderType,
      reduceOnly: false,
      ...(isPerp && { leverage, marketType: 'perp' as const }),
      ...(!isPerp && { marketType: 'spot' as const }),
      ...(orderType === 'limit' && { limitPx: limitPriceNum, tif }),
    };

    const mutation = isPerp ? placeOrder : placeSpotOrder;
    mutation.mutate(order, {
      onSuccess: () => { haptics.success(); navigate(-1); },
      onError: (err) => {
        haptics.error();
        setSubmitError(err instanceof Error ? err.message : 'Order failed — please try again');
      },
    });
  };

  // ── Render ───────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-background">

      {/* ── Header ── */}
      <header className="flex-none px-4 py-3 flex items-center justify-between border-b border-separator bg-white">
        {/* Token identity */}
        <div className="flex items-center gap-2.5">
          <TokenIcon coin={baseToken} size={32} />
          <div>
            <span className="font-bold text-foreground">{displayName}</span>
            <span className="text-xs text-gray-400 ml-1">{isPerp ? 'PERP' : 'SPOT'}</span>
          </div>
          {currentPrice != null && (
            <span className="text-sm font-medium text-gray-600 tabular-nums ml-1">
              {formatPrice(currentPrice)}
            </span>
          )}
        </div>

        {/* Market / Limit toggle */}
        <div className="flex bg-surface rounded-lg p-0.5 gap-0.5">
          {(['market', 'limit'] as const).map((type) => (
            <button
              key={type}
              onPointerDown={() => handleOrderTypeToggle(type)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all capitalize ${
                orderType === type ? 'bg-white shadow text-foreground' : 'text-gray-500'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>

        {/* Gear / settings */}
        <button
          onPointerDown={() => setSettingsOpen(true)}
          className="p-2 rounded-lg text-gray-500 active:bg-gray-100 transition-colors"
          aria-label="Order settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </header>

      {/* ── Scrollable middle ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6 flex flex-col items-center gap-5">

        {/* Amount / price display */}
        <div className="flex flex-col items-center">
          <div className="text-6xl font-bold text-foreground tabular-nums tracking-tight">
            {step === 'amount'
              ? `$${amountNum === 0 ? '0' : amount}`
              : limitPriceNum === 0 ? '$0' : `$${limitPrice}`}
          </div>
          <div className="text-sm text-gray-400 mt-2">
            {step === 'amount'
              ? `Available $${availableUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
              : 'Limit price'}
          </div>
          {step === 'price' && (
            <button
              onPointerDown={() => setStep('amount')}
              className="text-sm text-primary mt-2 active:opacity-60"
            >
              ← Edit amount
            </button>
          )}
        </div>

        {/* Quick fill pills — amount step only */}
        {step === 'amount' && (
          <div className="flex gap-2">
            {[{ label: '10%', pct: 0.1 }, { label: '25%', pct: 0.25 }, { label: '50%', pct: 0.5 }, { label: 'Max', pct: 1 }].map(({ label, pct }) => (
              <button
                key={label}
                onPointerDown={() => handleQuickFill(pct)}
                className="px-3.5 py-1.5 rounded-full bg-surface text-sm font-medium text-gray-600 active:bg-gray-200 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Leverage picker — perps, amount step only */}
        {isPerp && step === 'amount' && (
          <div className="w-full">
            <div className="text-xs text-gray-400 mb-2 font-medium">Leverage</div>
            <div className="flex flex-wrap gap-2">
              {leverageOptions.map((lv) => (
                <button
                  key={lv}
                  onPointerDown={() => handleLeveragePill(lv)}
                  className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                    leverage === lv ? 'bg-primary text-white' : 'bg-surface text-gray-600 active:bg-gray-200'
                  }`}
                >
                  {lv}x
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── NumPad ── */}
      <div className="flex-none pb-1">
        <NumPad
          value={step === 'amount' ? amount : limitPrice}
          onChange={step === 'amount' ? setAmount : setLimitPrice}
          maxDecimals={step === 'amount' ? 2 : 8}
        />
      </div>

      {/* ── Submit CTA ── */}
      <div className="flex-none px-4 pt-2 pb-4 safe-area-bottom bg-white border-t border-separator">
        {needsApproval ? (
          <button
            onPointerDown={handlePrimaryAction}
            disabled={approveBuilder.isPending}
            className="w-full py-4 rounded-xl font-semibold text-sm bg-amber-500 text-white disabled:opacity-50 active:opacity-80 transition-opacity"
          >
            {approveBuilder.isPending ? 'Approving...' : 'Approve Builder Fee to Trade'}
          </button>
        ) : orderType === 'limit' && step === 'amount' ? (
          <button
            onPointerDown={handlePrimaryAction}
            disabled={amountNum === 0}
            className="w-full py-4 rounded-xl font-semibold text-sm bg-primary text-white disabled:opacity-40 active:opacity-80 transition-opacity"
          >
            Set Price →
          </button>
        ) : (
          <button
            onPointerDown={handlePrimaryAction}
            disabled={isSubmitDisabled}
            className={`w-full py-4 rounded-xl font-semibold text-sm text-white disabled:opacity-40 active:opacity-80 transition-opacity ${
              side === 'buy' ? 'bg-primary' : 'bg-secondary'
            }`}
          >
            {isPending ? 'Placing order...' : ctaLabel}
          </button>
        )}

        {liquidationPx != null && (
          <p className="text-xs text-center text-gray-400 mt-1.5">
            Liquidation at {formatPrice(liquidationPx)}
          </p>
        )}
        {submitError && (
          <p className="text-xs text-center text-negative mt-1.5">{submitError}</p>
        )}
      </div>

      {/* ── Settings sheet ── */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex flex-col">
          <div
            className="absolute inset-0 bg-black/40"
            onPointerDown={() => setSettingsOpen(false)}
          />
          <div className="relative mt-auto bg-white rounded-t-2xl px-4 pt-4 pb-8 animate-slide-up">
            {/* Drag handle */}
            <div className="flex justify-center mb-5">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>

            <h3 className="text-base font-bold text-foreground mb-5">Order Settings</h3>

            <div className="mb-3 text-sm font-medium text-gray-500">Time in Force</div>
            <div className="flex gap-2 mb-6">
              {([
                { key: 'Gtc', label: 'GTC', desc: 'Good Till Cancelled' },
                { key: 'Alo', label: 'ALO', desc: 'Add Liquidity Only' },
                { key: 'Ioc', label: 'IOC', desc: 'Immediate or Cancel' },
              ] as const).map(({ key, label, desc }) => (
                <button
                  key={key}
                  onPointerDown={() => { setTif(key); haptics.selection(); }}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                    tif === key
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-gray-600 border-gray-200'
                  }`}
                >
                  <div>{label}</div>
                  <div className={`text-xs font-normal mt-0.5 ${tif === key ? 'text-blue-100' : 'text-gray-400'}`}>
                    {desc}
                  </div>
                </button>
              ))}
            </div>

            <button
              onPointerDown={() => { setSettingsOpen(false); haptics.light(); }}
              className="w-full py-3.5 rounded-xl bg-primary text-white font-semibold text-sm active:opacity-80 transition-opacity"
            >
              Apply to trade
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
