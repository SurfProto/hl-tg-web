import {
  type ComponentType,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  SUB_FILTERS,
  enrichMarkets,
  getMarketBaseAsset,
  getMarketDisplayName,
  useMarketData,
  useMarketStats,
} from "@repo/hyperliquid-sdk";
import type { AnyMarket, MarketCategory, MarketSubCategory } from "@repo/types";
import { BalanceHero } from "../components/BalanceHero";
import { CategoryPills } from "../components/CategoryPills";
import { MarketListItem } from "../components/MarketListItem";
import { MarketListItemSkeleton } from "../components/MarketListItemSkeleton";
import { log } from "../lib/logger";
import { getHomeMarketDisplayState } from "./home-market-state";
import { getHomeMarketViewState } from "./home-state";

function lazyNamedModule<T extends Record<string, ComponentType<any>>>(
  loader: () => Promise<T>,
  exportName: keyof T,
) {
  return lazy(async () => {
    const module = await loader();
    return { default: module[exportName] as ComponentType<any> };
  });
}

const SearchSheet = lazyNamedModule(
  () => import("../components/SearchSheet"),
  "SearchSheet",
);
const AllMarketsSheet = lazyNamedModule(
  () => import("../components/AllMarketsSheet"),
  "AllMarketsSheet",
);
const HOME_ROW_COUNT = 6;
const DEFERRED_ROUTE_PREFETCHERS = [
  () => import("./TradePage"),
  () => import("./AccountPage"),
  () => import("./PositionsPage"),
  () => import("./CoinDetailPage"),
];

export function HomePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedSubCategory, setSelectedSubCategory] =
    useState<MarketSubCategory | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [allMarketsOpen, setAllMarketsOpen] = useState(false);

  const {
    data: markets,
    error: marketsError,
    isError: marketsQueryFailed,
    isLoading: marketsLoading,
    refetch: refetchMarkets,
  } = useMarketData();
  const {
    data: marketStats,
    error: marketStatsError,
    isError: marketStatsQueryFailed,
    isLoading: marketStatsLoading,
  } = useMarketStats();
  const visibleCategories = CATEGORY_ORDER.filter(
    (category) => category !== "spot",
  );

  const subFilters = SUB_FILTERS[selectedCategory as MarketCategory] ?? null;

  useEffect(() => {
    setSelectedSubCategory(null);
  }, [selectedCategory]);

  useEffect(() => {
    if (!markets || marketsQueryFailed) return;

    const prefetchDeferredRoutes = () => {
      for (const prefetchRoute of DEFERRED_ROUTE_PREFETCHERS) {
        void prefetchRoute();
      }
    };

    const requestIdleCallback = window.requestIdleCallback?.bind(window);
    const cancelIdleCallback = window.cancelIdleCallback?.bind(window);

    if (requestIdleCallback && cancelIdleCallback) {
      const idleId = requestIdleCallback(prefetchDeferredRoutes, {
        timeout: 500,
      });
      return () => cancelIdleCallback(idleId);
    }

    const timeoutId = window.setTimeout(prefetchDeferredRoutes, 120);
    return () => window.clearTimeout(timeoutId);
  }, [markets, marketsQueryFailed]);

  const allMarkets: AnyMarket[] = useMemo(
    () => [
      ...(markets?.perp ?? []).map((market: any) => ({
        ...market,
        type: "perp" as const,
      })),
    ],
    [markets],
  );
  const homeMarketViewState = getHomeMarketViewState({
    marketsLoading,
    marketsError: marketsQueryFailed,
    marketCount: allMarkets.length,
  });

  useEffect(() => {
    if (marketsQueryFailed) {
      log.warn("[home] market metadata query failed", { error: marketsError });
    }
  }, [marketsError, marketsQueryFailed]);

  useEffect(() => {
    if (marketStatsQueryFailed) {
      log.warn("[home] market stats query failed", { error: marketStatsError });
    }
  }, [marketStatsError, marketStatsQueryFailed]);

  const priceChanges: Record<string, number> = useMemo(() => {
    if (!marketStats) return {};
    return Object.fromEntries(
      Object.entries(marketStats).map(([coin, stats]) => [
        coin,
        stats.change24h,
      ]),
    );
  }, [marketStats]);

  const enriched = useMemo(
    () => enrichMarkets(allMarkets, priceChanges, markets?.spotTokenNames),
    [allMarkets, priceChanges, markets?.spotTokenNames],
  );

  const sortedFiltered = useMemo(() => {
    let result =
      selectedCategory === "all"
        ? enriched
        : enriched.filter(({ categories }) =>
            categories.includes(selectedCategory as MarketCategory),
          );

    if (selectedSubCategory) {
      result = result.filter(
        ({ subCategory }) => subCategory === selectedSubCategory,
      );
    }

    return [...result].sort((left, right) => {
      const leftVolume = marketStats?.[left.market.name]?.dayNtlVlm ?? 0;
      const rightVolume = marketStats?.[right.market.name]?.dayNtlVlm ?? 0;

      if (rightVolume !== leftVolume) {
        return rightVolume - leftVolume;
      }

      return getMarketDisplayName(left.market).localeCompare(
        getMarketDisplayName(right.market),
      );
    });
  }, [enriched, marketStats, selectedCategory, selectedSubCategory]);

  const visibleMarkets = sortedFiltered.slice(0, HOME_ROW_COUNT);

  return (
    <div className="editorial-page pb-6">
      <BalanceHero />

      <div className="px-4 pb-2 pt-7">
        <p className="editorial-kicker">{t("nav.markets")}</p>
      </div>

      <div className="px-4 pb-3 flex items-end justify-between gap-3">
        <h2 className="editorial-section-title">{t("nav.markets")}</h2>
        <button
          type="button"
          onClick={() => setAllMarketsOpen(true)}
          className="editorial-button-ghost"
        >
          {t("home.seeAll")}
        </button>
      </div>

      <div className="px-4 mb-3">
        <CategoryPills
          categories={visibleCategories}
          labels={CATEGORY_LABELS}
          selected={selectedCategory}
          onChange={setSelectedCategory}
        />
      </div>

      {subFilters && (
        <div className="px-4 mb-3 flex gap-2 overflow-x-auto scrollbar-hide">
          <button
            type="button"
            onClick={() => setSelectedSubCategory(null)}
            className={`editorial-chip flex-shrink-0 ${
              selectedSubCategory === null
                ? "editorial-chip-active"
                : ""
            }`}
          >
            {t("common.all")}
          </button>
          {subFilters.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedSubCategory(key)}
              className={`editorial-chip flex-shrink-0 ${
                selectedSubCategory === key
                  ? "editorial-chip-active"
                  : ""
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="px-4">
        <div className="editorial-card overflow-hidden px-2 py-2">
        {homeMarketViewState === "loading" ? (
          <div className="space-y-2">
            {Array.from({ length: HOME_ROW_COUNT }, (_, index) => (
              <MarketListItemSkeleton key={index} />
            ))}
          </div>
        ) : homeMarketViewState === "error" ? (
          <div className="px-4 py-16 text-center">
            <p className="text-sm text-muted">
              {t("home.marketDataUnavailable")}
            </p>
            <button
              type="button"
              onClick={() => void refetchMarkets()}
              className="editorial-button-primary mt-4"
            >
              {t("common.retry")}
            </button>
          </div>
        ) : homeMarketViewState === "empty" || sortedFiltered.length === 0 ? (
          <div className="py-16 text-center text-muted text-sm">
            {t("home.noMarkets")}
          </div>
        ) : (
          <div className="space-y-2">
            {visibleMarkets.map(({ market }) => {
              const coin = market.name;
              const displayName = getMarketDisplayName(market);
              const iconCoin = getMarketBaseAsset(market);
              const marketDisplayState = getHomeMarketDisplayState({
                stats: marketStats?.[coin],
                marketStatsFailed:
                  marketStatsQueryFailed && !marketStatsLoading,
              });

              return (
                <MarketListItem
                  key={coin}
                  coin={coin}
                  displayName={displayName}
                  iconCoin={iconCoin}
                  marketType={market.type}
                  price={marketDisplayState.price ?? ""}
                  priceState={marketDisplayState.dataState}
                  change24h={
                    marketDisplayState.dataState === "ready"
                      ? marketDisplayState.change24h
                      : null
                  }
                  volume={marketDisplayState.volume ?? undefined}
                  maxLeverage={
                    market.type === "perp" ? market.maxLeverage : undefined
                  }
                  onClick={() => navigate(`/coin/${encodeURIComponent(coin)}`)}
                />
              );
            })}
          </div>
        )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="fixed floating-above-bottom-nav right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-[0_18px_36px_rgba(78,123,255,0.32)] transition-colors active:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        aria-label={t("home.ariaSearch")}
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0"
          />
        </svg>
      </button>

      {searchOpen && (
        <Suspense fallback={null}>
          <SearchSheet
            isOpen={searchOpen}
            onClose={() => setSearchOpen(false)}
            onSelect={(coin: string) =>
              navigate(`/coin/${encodeURIComponent(coin)}`)
            }
          />
        </Suspense>
      )}

      {allMarketsOpen && (
        <Suspense fallback={null}>
          <AllMarketsSheet
            isOpen={allMarketsOpen}
            onClose={() => setAllMarketsOpen(false)}
            markets={sortedFiltered}
            marketStats={marketStats}
            marketStatsError={marketStatsQueryFailed}
            onSelect={(coin: string) => {
              setAllMarketsOpen(false);
              navigate(`/coin/${encodeURIComponent(coin)}`);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
