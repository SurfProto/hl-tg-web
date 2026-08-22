import { useEffect, useMemo, useState } from "react";
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

const HOME_ROW_COUNT = 6;

// Rendering the whole universe cost 404 rows and ~5,600 DOM nodes on first
// paint, inside a phone WebView. The list stays inline and the full set is one
// tap away rather than behind a sheet — 419bbb1 deliberately removed the
// all-markets and search sheets, and HomePage.test.tsx pins that.
const HOME_MARKET_LIMIT = 20;
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
  const [query, setQuery] = useState("");
  const [showAllMarkets, setShowAllMarkets] = useState(false);

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

    if (query.trim()) {
      const normalizedQuery = query.trim().toLowerCase();
      result = result.filter(({ market }) => {
        const marketIdentity = `${market.name} ${getMarketDisplayName(market)}`.toLowerCase();
        return marketIdentity.includes(normalizedQuery);
      });
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
  }, [enriched, marketStats, query, selectedCategory, selectedSubCategory]);

  const visibleMarkets = useMemo(
    () => (showAllMarkets ? sortedFiltered : sortedFiltered.slice(0, HOME_MARKET_LIMIT)),
    [showAllMarkets, sortedFiltered],
  );

  // Collapse again whenever the visible set changes underneath, so a filter or
  // a search does not silently hand back an expanded 400-row list.
  useEffect(() => {
    setShowAllMarkets(false);
  }, [query, selectedCategory, selectedSubCategory]);

  return (
    <div className="editorial-page pb-6">
      <BalanceHero />

      <div className="px-4 pb-3 pt-7">
        <h2 className="editorial-section-title">{t("nav.markets")}</h2>
        <label htmlFor="home-market-search" className="sr-only">
          {t("home.ariaSearch")}
        </label>
        <div className="relative mt-4">
          <svg
            className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5-5m2-6a8 8 0 11-16 0 8 8 0 0116 0z" />
          </svg>
          <input
            id="home-market-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search.placeholder")}
            className="p34k-input"
            aria-label={t("home.ariaSearch")}
          />
        </div>
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
        <div className="overflow-hidden rounded-[18px] border border-border bg-white">
        {homeMarketViewState === "loading" ? (
          <div className="divide-y divide-separator">
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
        {!showAllMarkets && sortedFiltered.length > HOME_MARKET_LIMIT && (
          <button
            type="button"
            onClick={() => setShowAllMarkets(true)}
            className="editorial-button-secondary mt-3 w-full"
          >
            {t("home.seeAllMarkets", { count: sortedFiltered.length })}
          </button>
        )}
      </div>

    </div>
  );
}
