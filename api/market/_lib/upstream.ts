import { fetchWithTimeout, UpstreamTimeoutError } from "../../_lib/fetch-with-timeout";
import { HttpError } from "./response";

interface MarketStats {
  coin: string;
  markPx: number;
  prevDayPx: number;
  dayNtlVlm: number;
  openInterest: number;
  funding: number;
  oraclePx: number;
  change24h: number;
}

type PortfolioRange = "1d" | "7d" | "30d";

interface PortfolioHistoryPoint {
  time: number;
  value: number;
}

export interface PortfolioPeriodData {
  period: PortfolioRange;
  accountValueHistory: PortfolioHistoryPoint[];
  pnlHistory: PortfolioHistoryPoint[];
  volume: number;
}

const MIN_ORDER_NOTIONAL_USD = 10;
const PERIOD_KEY: Record<string, "day" | "week" | "month"> = {
  "1d": "day",
  "7d": "week",
  "30d": "month",
};

type Network = "mainnet" | "testnet";

interface ResolvedMarket {
  name: string;
}

function apiUrl(network: Network) {
  return network === "testnet"
    ? "https://api.hyperliquid-testnet.xyz/info"
    : "https://api.hyperliquid.xyz/info";
}

function parseNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function postInfo<T>(network: Network, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithTimeout(apiUrl(network), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof UpstreamTimeoutError) {
      throw new HttpError(504, "UPSTREAM_TIMEOUT", "Hyperliquid upstream timed out");
    }
    throw error;
  }

  if (!response.ok) {
    throw new HttpError(502, "UPSTREAM_ERROR", `Hyperliquid upstream failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function bareName(name: string) {
  return name.includes(":") ? name.split(":").pop()! : name;
}

async function getPerpDexs(network: Network) {
  const response = await postInfo<Array<{ name: string } | null>>(network, {
    type: "perpDexs",
  }).catch(() => [null]);
  return response
    .map((entry, dexIndex) => (entry ? { dex: entry.name, dexIndex } : null))
    .filter(Boolean) as Array<{ dex: string; dexIndex: number }>;
}

export async function fetchMarkets(network: Network) {
  const [spotMeta, metaAndCtxs, perpDexs] = await Promise.all([
    postInfo<any>(network, { type: "spotMeta" }),
    postInfo<any>(network, { type: "metaAndAssetCtxs" }),
    getPerpDexs(network),
  ]);
  const tokensByIndex = new Map<number, any>(
    (spotMeta.tokens ?? []).map((token: any) => [token.index, token]),
  );

  const perpMarkets = (metaAndCtxs?.[0]?.universe ?? [])
    .map((market: any, index: number) =>
      market?.isDelisted
        ? null
        : {
            name: market.name,
            szDecimals: market.szDecimals,
            maxLeverage: market.maxLeverage,
            onlyIsolated: Boolean(market.onlyIsolated),
            isDelisted: false,
            index,
            minNotionalUsd: MIN_ORDER_NOTIONAL_USD,
            minBaseSize: 10 ** -market.szDecimals,
          },
    )
    .filter(Boolean);

  const hip3Markets = (
    await Promise.all(
      perpDexs.map(async ({ dex, dexIndex }) => {
        const response = await postInfo<any>(network, {
          type: "metaAndAssetCtxs",
          dex,
        }).catch(() => null);
        return (response?.[0]?.universe ?? [])
          .map((market: any, index: number) => {
            if (!market || market.isDelisted) return null;
            const name = `${dex}:${bareName(market.name)}`;
            return {
              name,
              szDecimals: market.szDecimals,
              maxLeverage: market.maxLeverage,
              onlyIsolated: Boolean(market.onlyIsolated),
              isDelisted: false,
              index,
              minNotionalUsd: MIN_ORDER_NOTIONAL_USD,
              minBaseSize: 10 ** -market.szDecimals,
              dex,
              dexIndex,
              isHip3: true,
            };
          })
          .filter(Boolean);
      }),
    )
  ).flat();

  const spotMarkets = (spotMeta.universe ?? []).map((pair: any) => {
    const baseToken = tokensByIndex.get(pair.tokens?.[0]);
    const quoteToken = tokensByIndex.get(pair.tokens?.[1]);
    return {
      name: pair.name,
      index: pair.index,
      tokens: pair.tokens,
      baseName: baseToken?.name ?? pair.name,
      quoteName: quoteToken?.name ?? "USDC",
      szDecimals: baseToken?.szDecimals ?? 0,
      maxLeverage: 1,
      minNotionalUsd: MIN_ORDER_NOTIONAL_USD,
      minBaseSize: 10 ** -(baseToken?.szDecimals ?? 0),
      onlyIsolated: false,
      isDelisted: false,
    };
  });

  return {
    perp: [...perpMarkets, ...hip3Markets],
    spot: spotMarkets,
    spotTokenNames: (spotMeta.tokens ?? []).map((token: any) => token.name),
  };
}

async function resolveMarket(network: Network, symbol: string): Promise<ResolvedMarket> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    throw new HttpError(400, "INVALID_SYMBOL", "Missing symbol");
  }

  if (normalized.includes(":")) {
    return { name: symbol };
  }

  const markets = await fetchMarkets(network);
  const market = [...markets.perp, ...markets.spot].find(
    (candidate: any) =>
      candidate.name?.toUpperCase() === normalized ||
      candidate.baseName?.toUpperCase() === normalized,
  );

  if (!market) {
    throw new HttpError(404, "MARKET_NOT_FOUND", "Market not found");
  }

  return { name: market.name };
}

export async function fetchMids(network: Network) {
  const perpDexs = await getPerpDexs(network);
  const [baseMids, ...dexMids] = await Promise.all([
    postInfo<Record<string, string>>(network, { type: "allMids" }),
    ...perpDexs.map(({ dex }) =>
      postInfo<Record<string, string>>(network, { type: "allMids", dex }).then(
        (mids) => ({ dex, mids }),
      ),
    ),
  ]);

  const merged = { ...baseMids };
  for (const { dex, mids } of dexMids) {
    Object.entries(mids).forEach(([coin, price]) => {
      merged[`${dex}:${bareName(coin)}`] = price;
    });
  }
  return merged;
}

function mapStats(coin: string, ctx: any): MarketStats {
  const markPx = parseNumber(ctx?.markPx ?? ctx?.midPx);
  const prevDayPx = parseNumber(ctx?.prevDayPx);
  return {
    coin,
    markPx,
    prevDayPx,
    dayNtlVlm: parseNumber(ctx?.dayNtlVlm),
    openInterest: parseNumber(ctx?.openInterest),
    funding: parseNumber(ctx?.funding),
    oraclePx: parseNumber(ctx?.oraclePx ?? ctx?.midPx),
    change24h: prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0,
  };
}

export async function fetchStats(network: Network): Promise<Record<string, MarketStats>> {
  const [metaAndCtxs, spotMetaAndCtxs, perpDexs] = await Promise.all([
    postInfo<any>(network, { type: "metaAndAssetCtxs" }),
    postInfo<any>(network, { type: "spotMetaAndAssetCtxs" }).catch(() => null),
    getPerpDexs(network),
  ]);
  const result: Record<string, MarketStats> = {};
  const universe = metaAndCtxs?.[0]?.universe ?? [];
  const ctxs = metaAndCtxs?.[1] ?? [];

  for (let i = 0; i < universe.length; i += 1) {
    if (!universe[i] || universe[i].isDelisted || !ctxs[i]) continue;
    result[universe[i].name] = mapStats(universe[i].name, ctxs[i]);
  }

  for (const ctx of spotMetaAndCtxs?.[1] ?? []) {
    if (typeof ctx?.coin === "string") {
      result[ctx.coin] = {
        ...mapStats(ctx.coin, ctx),
        openInterest: 0,
        funding: 0,
      };
    }
  }

  await Promise.all(
    perpDexs.map(async ({ dex }) => {
      const response = await postInfo<any>(network, { type: "metaAndAssetCtxs", dex }).catch(
        () => null,
      );
      const hip3Universe = response?.[0]?.universe ?? [];
      const hip3Ctxs = response?.[1] ?? [];
      for (let i = 0; i < hip3Universe.length; i += 1) {
        const meta = hip3Universe[i];
        const ctx = hip3Ctxs[i];
        if (!meta || meta.isDelisted || !ctx) continue;
        const coin = `${dex}:${bareName(meta.name)}`;
        result[coin] = mapStats(coin, ctx);
      }
    }),
  );

  return result;
}

export async function fetchTicker(network: Network, symbol: string): Promise<number | null> {
  const stats = await fetchStats(network);
  const direct = stats[symbol] ?? stats[symbol.toUpperCase()];
  if (direct?.markPx) {
    return direct.markPx;
  }

  const mids = await fetchMids(network);
  const mid = parseNumber(mids[symbol] ?? mids[symbol.toUpperCase()]);
  return mid > 0 ? mid : null;
}

export async function fetchDepth(network: Network, symbol: string, limit: number) {
  const resolved = await resolveMarket(network, symbol);
  const raw = await postInfo<any>(network, {
    type: "l2Book",
    coin: resolved.name,
  });

  return {
    coin: raw.coin,
    time: raw.time,
    levels: {
      bids: (raw.levels?.[0] ?? []).slice(0, limit).map((level: any) => ({
        px: parseNumber(level.px),
        sz: parseNumber(level.sz),
        n: level.n,
      })),
      asks: (raw.levels?.[1] ?? []).slice(0, limit).map((level: any) => ({
        px: parseNumber(level.px),
        sz: parseNumber(level.sz),
        n: level.n,
      })),
    },
  };
}

export async function fetchCandles(network: Network, symbol: string, interval: string) {
  const resolved = await resolveMarket(network, symbol);
  const startTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const raw = await postInfo<any[]>(network, {
    type: "candleSnapshot",
    req: {
      coin: resolved.name,
      interval,
      startTime,
    },
  });

  return raw.map((candle: any) => ({
    t: candle.t,
    T: candle.T,
    s: candle.s,
    i: candle.i,
    o: parseNumber(candle.o),
    h: parseNumber(candle.h),
    l: parseNumber(candle.l),
    c: parseNumber(candle.c),
    v: parseNumber(candle.v),
    n: candle.n,
  }));
}

function parsePortfolioSeries(series: unknown): PortfolioHistoryPoint[] {
  if (!Array.isArray(series)) return [];
  return series
    .map((point: unknown) => {
      if (!Array.isArray(point) || point.length < 2) return null;
      const time = Number(point[0]);
      const value = parseNumber(point[1]);
      return Number.isFinite(time) && Number.isFinite(value) ? { time, value } : null;
    })
    .filter((point: PortfolioHistoryPoint | null): point is PortfolioHistoryPoint => point != null)
    .sort((left, right) => left.time - right.time);
}

export async function mapPortfolioPeriod(
  portfolio: unknown,
  period: string,
): Promise<PortfolioPeriodData> {
  const series = Array.isArray(portfolio)
    ? portfolio
    : Array.isArray((portfolio as any)?.portfolio)
      ? (portfolio as any).portfolio
      : [];
  const periodKey = PERIOD_KEY[period] ?? "week";
  const periodEntry = series.find((entry: any) => Array.isArray(entry) && entry[0] === periodKey);
  const accountValueHistory = parsePortfolioSeries(periodEntry?.[1]?.accountValueHistory);
  const pnlHistory = parsePortfolioSeries(periodEntry?.[1]?.pnlHistory);

  return {
    period: (period === "1d" || period === "30d" ? period : "7d") as PortfolioPeriodData["period"],
    accountValueHistory,
    pnlHistory,
    volume: parseNumber(periodEntry?.[1]?.vlm),
  };
}

export { postInfo };
