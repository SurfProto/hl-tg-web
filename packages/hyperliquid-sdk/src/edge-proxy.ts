import type {
  AccountState,
  AssetCtx,
  Candle,
  Fill,
  MarketStats,
  OpenOrder,
  Orderbook,
  PortfolioPeriodData,
  PortfolioRange,
} from "@repo/types";

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: string;
  code?: string;
}

export interface AccountSnapshot {
  userState: AccountState;
  spotBalance: any;
}

function looksLikeHtml(body: string) {
  const trimmed = body.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const rawBody = await response.text();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("text/html") || looksLikeHtml(rawBody)) {
    throw new Error(`API ${path} returned HTML instead of JSON`);
  }

  let payload: Envelope<T>;
  try {
    payload = JSON.parse(rawBody) as Envelope<T>;
  } catch {
    throw new Error(`API ${path} returned an invalid JSON response`);
  }

  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? "API request failed");
  }

  return payload.data;
}

function params(input: Record<string, string | number | null | undefined>) {
  const searchParams = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value != null) {
      searchParams.set(key, String(value));
    }
  });
  return searchParams.toString();
}

function getTelegramInitData() {
  const telegram = (window as Window & {
    Telegram?: {
      WebApp?: {
        initData?: string;
      };
    };
  }).Telegram;
  return telegram?.WebApp?.initData ?? "";
}

function accountHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "X-Telegram-Init-Data": getTelegramInitData(),
  };
}

export function fetchEdgeMarkets() {
  return requestJson<{
    perp: any[];
    spot: any[];
    spotTokenNames: string[];
  }>("/api/market/markets").then((markets) => ({
    ...markets,
    spotTokenNames: new Set(markets.spotTokenNames),
  }));
}

export function fetchEdgeMarketStats() {
  return requestJson<Record<string, MarketStats>>("/api/market/stats");
}

/**
 * One market's stats.
 *
 * This used to fetch every market and pick a row, so opening a coin page
 * downloaded 29KB and parsed 1037 objects to render one. The server filters
 * from the same cached blob, so this costs no extra rebuild.
 */
export async function fetchEdgeAssetCtx(coin: string): Promise<AssetCtx | null> {
  return requestJson<AssetCtx | null>(
    `/api/market/stats?${params({ symbol: coin })}`,
  );
}

export function fetchEdgeMids() {
  return requestJson<Record<string, string>>("/api/market/mids");
}

export function fetchEdgeMarketPrice(coin: string) {
  return requestJson<number | null>(`/api/market/ticker?${params({ symbol: coin })}`);
}

export function fetchEdgeOrderbook(coin: string, limit = 20) {
  return requestJson<Orderbook>(
    `/api/market/depth?${params({ symbol: coin, limit })}`,
  );
}

export function fetchEdgeCandles(coin: string, interval = "1h") {
  return requestJson<Candle[]>(
    `/api/market/candles?${params({ symbol: coin, interval })}`,
  );
}

export function fetchAccountSnapshot(accessToken: string) {
  return requestJson<AccountSnapshot>("/api/account/snapshot", {
    headers: accountHeaders(accessToken),
  });
}

export function fetchAccountOrders(accessToken: string) {
  return requestJson<OpenOrder[]>("/api/account/orders", {
    headers: accountHeaders(accessToken),
  });
}

export function fetchAccountFills(accessToken: string) {
  return requestJson<Fill[]>("/api/account/fills", {
    headers: accountHeaders(accessToken),
  });
}

export function fetchAccountPortfolio(accessToken: string, period: PortfolioRange) {
  return requestJson<PortfolioPeriodData>(
    `/api/account/portfolio?${params({ period })}`,
    {
      headers: accountHeaders(accessToken),
    },
  );
}
