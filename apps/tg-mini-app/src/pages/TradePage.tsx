import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import {
  useSetupTrading,
  useMarketData,
  useMids,
  usePlaceOrder,
  usePlaceSpotOrder,
  useSpotBalance,
  useUserState,
  validateOrderInput,
  getMarketBaseAsset,
  getMarketDisplayName,
} from '@repo/hyperliquid-sdk';
import type { AnyMarket, Order } from '@repo/types';
import { NumPad } from '../components/NumPad';
import { TokenIcon } from '../components/TokenIcon';
import { TradingSetupSheet } from '../components/TradingSetupSheet';
import { useHaptics } from '../hooks/useHaptics';
import { useToast } from '../hooks/useToast';
import { formatPrice } from '../utils/format';

function formatUsdInput(value: number): string {
  const truncated = Math.floor(value * 100) / 100;
  if (Number.isNaN(truncated) || truncated <= 0) return '0';
  return truncated.toFixed(2).replace(/\.00$/u, '').replace(/(\.\d)0$/u, '$1');
}

const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 20, 25, 50];

export function TradePage() {
  const { symbol: rawSymbol = 'BTC' } = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(rawSymbol);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const haptics = useHaptics();
  const toast = useToast();
  const { authenticated, user } = usePrivy();

  const [amount, setAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [step, setStep] = useState<'amount' | 'price'>('amount');
  const [leverage, setLeverage] = useState(1);
  const [tif, setTif] = useState<'Gtc' | 'Alo' | 'Ioc'>('Gtc');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [setupVisible, setSetupVisible] = useState(false);
  const setupWalletRef = useRef<string | null>(null);

  const side: 'buy' | 'sell' = useMemo(() => {
    const requestedSide = searchParams.get('side');
    return requestedSide === 'long' || requestedSide === 'buy' ? 'buy' : 'sell';
  }, [searchParams]);

  const { data: markets } = useMarketData();
  const { data: mids } = useMids();
  const { data: userState } = useUserState();
  const { data: spotBalance } = useSpotBalance();
  const { isReady: tradingReady, isExpired: tradingExpired, setup: tradingSetup } = useSetupTrading();
  const placeOrder = usePlaceOrder();
  const placeSpotOrder = usePlaceSpotOrder();

  const selectedPerpMarket = useMemo(
    () => (markets?.perp as Array<any> | undefined)?.find((market) => market.name === symbol) ?? null,
    [markets, symbol],
  );

  const selectedSpotMarket = useMemo(
    () => (markets?.spot as Array<any> | undefined)?.find((market) => market.name === symbol) ?? null,
    [markets, symbol],
  );

  const isPerp = selectedPerpMarket != null;
  const selectedMarket = isPerp ? selectedPerpMarket : selectedSpotMarket;
  const selectedMarketForDisplay = useMemo<AnyMarket | null>(() => {
    if (selectedSpotMarket) return { ...selectedSpotMarket, type: 'spot' as const };
    if (selectedPerpMarket) return { ...selectedPerpMarket, type: 'perp' as const };
    return null;
  }, [selectedPerpMarket, selectedSpotMarket]);

  const displayName = useMemo(
    () => selectedMarketForDisplay ? getMarketDisplayName(selectedMarketForDisplay) : getMarketDisplayName(symbol),
    [selectedMarketForDisplay, symbol],
  );

  const baseToken = useMemo(
    () => selectedMarketForDisplay ? getMarketBaseAsset(selectedMarketForDisplay) : getMarketBaseAsset(symbol),
    [selectedMarketForDisplay, symbol],
  );

  const maxLeverage = useMemo(
    () => selectedPerpMarket?.maxLeverage ?? 50,
    [selectedPerpMarket],
  );

  const leverageOptions = useMemo(
    () => LEVERAGE_OPTIONS.filter((value) => value <= maxLeverage),
    [maxLeverage],
  );

  const currentPrice = mids?.[symbol] ? parseFloat(mids[symbol]) : null;
  const amountNum = parseFloat(amount) || 0;
  const limitPriceNum = parseFloat(limitPrice) || 0;

  const spotUsdcBalance = useMemo(() => {
    const entry = (spotBalance?.balances as Array<{ coin: string; total: string }> | undefined)
      ?.find((balance) => balance.coin === 'USDC');
    return entry ? parseFloat(entry.total) : 0;
  }, [spotBalance]);

  const spotCoinBalance = useMemo(() => {
    const entry = (spotBalance?.balances as Array<{ coin: string; total: string }> | undefined)
      ?.find((balance) => balance.coin === baseToken);
    return entry ? parseFloat(entry.total) : 0;
  }, [baseToken, spotBalance]);

  const availableMarginUsd = useMemo(
    () => (isPerp ? userState?.withdrawable ?? 0 : 0),
    [isPerp, userState?.withdrawable],
  );

  const spotAvailableUsd = useMemo(() => {
    if (side === 'buy') return spotUsdcBalance;
    return spotCoinBalance * (currentPrice ?? 0);
  }, [currentPrice, side, spotCoinBalance, spotUsdcBalance]);

  const maxPositionUsd = useMemo(
    () => (isPerp ? availableMarginUsd * leverage : spotAvailableUsd),
    [availableMarginUsd, isPerp, leverage, spotAvailableUsd],
  );

  const currentPositionLeverage = useMemo(() => {
    if (!isPerp) return null;
    const position = (userState?.assetPositions ?? [])
      .find((assetPosition) => assetPosition.position.coin === symbol)
      ?.position;
    return position?.leverage.value ?? null;
  }, [isPerp, symbol, userState?.assetPositions]);

  const leverageSourceRef = useRef<{ symbol: string; positionLeverage: number | null }>({
    symbol: '',
    positionLeverage: null,
  });

  useEffect(() => {
    if (!isPerp) return;

    const nextPositionLeverage = currentPositionLeverage ?? null;
    const leverageSourceChanged =
      leverageSourceRef.current.symbol !== symbol
      || leverageSourceRef.current.positionLeverage !== nextPositionLeverage;

    if (leverageSourceChanged) {
      leverageSourceRef.current = {
        symbol,
        positionLeverage: nextPositionLeverage,
      };
      setLeverage(Math.min(Math.max(nextPositionLeverage ?? 1, 1), maxLeverage));
      return;
    }

    if (leverage > maxLeverage) {
      setLeverage(maxLeverage);
    }
  }, [currentPositionLeverage, isPerp, leverage, maxLeverage, symbol]);

  const validationReferencePrice = orderType === 'limit'
    ? limitPriceNum || currentPrice || 0
    : currentPrice || 0;
  const validationAvailableBalance = isPerp ? availableMarginUsd : spotAvailableUsd;

  const validation = useMemo(() => {
    const minSizeUsd = selectedMarket?.minNotionalUsd ?? 10;
    const minMarginUsd = isPerp ? minSizeUsd / Math.max(leverage, 1) : minSizeUsd;

    if (!amount) {
      return {
        isValid: false,
        minMarginUsd,
        minSizeUsd,
        reason: undefined,
      };
    }

    if (!selectedMarket) {
      return {
        isValid: false,
        minMarginUsd,
        minSizeUsd,
        reason: 'Market metadata unavailable.',
      };
    }

    return validateOrderInput(
      {
        coin: symbol,
        side,
        sizeUsd: amountNum,
        limitPx: orderType === 'limit' && limitPriceNum > 0 ? limitPriceNum : undefined,
        orderType,
        reduceOnly: false,
        leverage,
        marketType: isPerp ? 'perp' : 'spot',
      },
      {
        name: selectedMarket.name,
        marketType: isPerp ? 'perp' : 'spot',
        minNotionalUsd: selectedMarket.minNotionalUsd,
        minBaseSize: selectedMarket.minBaseSize,
        szDecimals: selectedMarket.szDecimals,
      },
      validationReferencePrice,
      validationAvailableBalance,
    );
  }, [
    amount,
    amountNum,
    isPerp,
    leverage,
    limitPriceNum,
    orderType,
    selectedMarket,
    side,
    symbol,
    validationAvailableBalance,
    validationReferencePrice,
  ]);

  const liquidationPx = useMemo(() => {
    if (!isPerp || amountNum === 0 || !currentPrice || leverage <= 1) return null;
    return side === 'buy'
      ? currentPrice * (1 - 1 / leverage)
      : currentPrice * (1 + 1 / leverage);
  }, [amountNum, currentPrice, isPerp, leverage, side]);

  const needsSetup = authenticated && (!tradingReady || tradingExpired);

  useEffect(() => {
    const walletAddress = user?.wallet?.address ?? null;

    if (needsSetup) {
      if (setupWalletRef.current !== walletAddress || !setupVisible) {
        tradingSetup.reset();
      }
      setupWalletRef.current = walletAddress;
      setSetupVisible(true);
      return;
    }

    if (!authenticated) {
      setupWalletRef.current = null;
      tradingSetup.reset();
      setSetupVisible(false);
      return;
    }

    if (!tradingSetup.isSuccess) {
      setSetupVisible(false);
    }
  }, [authenticated, needsSetup, setupVisible, tradingSetup, tradingSetup.isSuccess, user?.wallet?.address]);

  const ctaLabel = isPerp
    ? side === 'buy' ? `Long ${displayName}` : `Short ${displayName}`
    : side === 'buy' ? `Buy ${displayName}` : `Sell ${displayName}`;

  const isPending = placeOrder.isPending || placeSpotOrder.isPending;
  const isSubmitDisabled = amountNum === 0 || isPending || !validation.isValid;

  const handleAmountChange = (value: string) => {
    setSubmitError(null);
    setAmount(value);
  };

  const handleLimitPriceChange = (value: string) => {
    setSubmitError(null);
    setLimitPrice(value);
  };

  const handleQuickFill = (pct: number) => {
    haptics.light();
    setSubmitError(null);
    const availableSizeUsd = isPerp ? maxPositionUsd : spotAvailableUsd;
    setAmount(formatUsdInput(availableSizeUsd * pct));
  };

  const handleLeveragePill = (value: number) => {
    haptics.selection();
    setSubmitError(null);
    setLeverage(value);
  };

  const handleOrderTypeToggle = (value: 'market' | 'limit') => {
    haptics.light();
    setSubmitError(null);
    setOrderType(value);
    setStep('amount');
  };

  const handlePrimaryAction = async () => {
    setSubmitError(null);

    if (!validation.isValid) {
      haptics.error();
      setSubmitError(validation.reason ?? 'Check your order details and try again.');
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
      onSuccess: () => {
        haptics.success();
        toast.success(`${side === 'buy' ? 'Long' : 'Short'} ${displayName} order placed`);
        navigate(-1);
      },
      onError: (error) => {
        haptics.error();
        toast.error(error instanceof Error ? error.message : 'Order failed. Please try again.');
      },
    });
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <header className="flex-none px-4 py-3 flex items-center justify-between border-b border-separator bg-white">
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

        <div className="flex bg-surface rounded-lg p-0.5 gap-0.5">
          {(['market', 'limit'] as const).map((value) => (
            <button
              key={value}
              onPointerDown={() => handleOrderTypeToggle(value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all capitalize ${
                orderType === value ? 'bg-white shadow text-foreground' : 'text-gray-500'
              }`}
            >
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>

        <button
          onPointerDown={() => setSettingsOpen(true)}
          className="p-2 rounded-lg text-gray-500 active:bg-gray-100 transition-colors"
          aria-label="Order settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6 flex flex-col items-center gap-5">
        <div className="flex flex-col items-center">
          <div className="text-6xl font-bold text-foreground tabular-nums tracking-tight">
            {step === 'amount'
              ? `$${amountNum === 0 ? '0' : amount}`
              : limitPriceNum === 0 ? '$0' : `$${limitPrice}`}
          </div>
          {step === 'amount' ? (
            <div className="mt-2 text-center text-sm text-gray-400">
              {isPerp ? (
                <>
                  <div>
                    Available margin ${availableMarginUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </div>
                  <div>
                    Max size ${maxPositionUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })} at {leverage}x
                  </div>
                </>
              ) : (
                `Available $${spotAvailableUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-400 mt-2">Limit price</div>
          )}
          {step === 'price' && (
            <button
              onPointerDown={() => {
                setSubmitError(null);
                setStep('amount');
              }}
              className="text-sm text-primary mt-2 active:opacity-60"
            >
              &larr; Edit amount
            </button>
          )}
        </div>

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

        {isPerp && step === 'amount' && (
          <div className="w-full">
            <div className="text-xs text-gray-400 mb-2 font-medium">Leverage</div>
            <div className="flex flex-wrap gap-2">
              {leverageOptions.map((value) => (
                <button
                  key={value}
                  onPointerDown={() => handleLeveragePill(value)}
                  className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                    leverage === value ? 'bg-primary text-white' : 'bg-surface text-gray-600 active:bg-gray-200'
                  }`}
                >
                  {value}x
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex-none pb-1">
        <NumPad
          value={step === 'amount' ? amount : limitPrice}
          onChange={step === 'amount' ? handleAmountChange : handleLimitPriceChange}
          maxDecimals={step === 'amount' ? 2 : 8}
        />
      </div>

      <div className="flex-none px-4 pt-2 pb-4 safe-area-bottom bg-white border-t border-separator">
        {orderType === 'limit' && step === 'amount' ? (
          <button
            onPointerDown={handlePrimaryAction}
            disabled={isSubmitDisabled}
            className="w-full py-4 rounded-xl font-semibold text-sm bg-primary text-white disabled:opacity-40 active:opacity-80 transition-opacity"
          >
            {'Set Price ->'}
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
        {validation.reason && !submitError && (
          <p className="text-xs text-center text-amber-600 mt-1.5">{validation.reason}</p>
        )}
        {submitError && (
          <p className="text-xs text-center text-negative mt-1.5">{submitError}</p>
        )}
      </div>

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex flex-col">
          <div
            className="absolute inset-0 bg-black/40"
            onPointerDown={() => setSettingsOpen(false)}
          />
          <div className="relative mt-auto bg-white rounded-t-2xl px-4 pt-4 pb-8 animate-slide-up">
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
                  onPointerDown={() => {
                    setSubmitError(null);
                    setTif(key);
                    haptics.selection();
                  }}
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
              onPointerDown={() => {
                setSettingsOpen(false);
                haptics.light();
              }}
              className="w-full py-3.5 rounded-xl bg-primary text-white font-semibold text-sm active:opacity-80 transition-opacity"
            >
              Apply to trade
            </button>
          </div>
        </div>
      )}

      {/* 1-click trading setup — shown on first use */}
      <TradingSetupSheet
        isOpen={setupVisible}
        onClose={() => setSetupVisible(false)}
        setup={tradingSetup}
        isExpired={tradingExpired}
      />
    </div>
  );
}
