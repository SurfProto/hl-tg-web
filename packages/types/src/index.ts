// Market types
export interface Market {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated: boolean;
  isDelisted: boolean;
  minNotionalUsd: number;
  minBaseSize: number;
  dex?: string;
  dexIndex?: number;
  isHip3?: boolean;
}

export interface SpotMarket extends Market {
  type: 'spot';
  tokens: [number, number];
  index: number;
  baseName: string;
  quoteName: string;
}

export interface PerpMarket extends Market {
  type: 'perp';
  index: number;
}

export type AnyMarket = SpotMarket | PerpMarket;

// Market classification types
export type MarketCategory = 'all' | 'perps' | 'spot' | 'crypto' | 'tradfi' | 'hip3' | 'trending' | 'prelaunch';
export type MarketTag = 'PERP' | 'SPOT' | 'xyz' | 'cash' | 'HIP-3';

export interface EnrichedMarket {
  market: AnyMarket;
  categories: MarketCategory[];
  tags: MarketTag[];
}

// Order types
export type OrderType = 'market' | 'limit';
export type OrderSide = 'buy' | 'sell';
export type MarketType = 'perp' | 'spot';

export interface Order {
  coin: string;
  side: OrderSide;
  sizeUsd: number;
  limitPx?: number;
  orderType: OrderType;
  reduceOnly: boolean;
  leverage?: number;
  marketType?: MarketType;
  cloid?: string;
}

export interface OrderValidationResult {
  isValid: boolean;
  minSizeUsd: number;
  minMarginUsd: number;
  reason?: string;
}

export interface PlacedOrder {
  oid: number;
  coin: string;
  side: OrderSide;
  limitPx: number;
  sz: number;
  timestamp: number;
  orderType: OrderType;
  reduceOnly: boolean;
  postOnly: boolean;
}

export interface OpenOrder {
  oid: number;
  coin: string;
  side: OrderSide;
  limitPx: number;
  sz: number;
  timestamp: number;
  orderType: OrderType;
  reduceOnly: boolean;
  tif?: string | null;
  triggerPx?: number | null;
  isTrigger?: boolean;
  cloid?: string | null;
}

// Position types
export interface Position {
  coin: string;
  szi: number;
  leverage: {
    type: 'isolated' | 'cross';
    value: number;
  };
  entryPx: number;
  positionValue: number;
  unrealizedPnl: number;
  returnOnEquity: number;
  liquidationPx: number | null;
  marginUsed: number;
  maxLeverage: number;
}

// Account types
export interface AccountState {
  marginSummary: {
    accountValue: number;
    totalMarginUsed: number;
    totalNtlPos: number;
    totalRawUsd: number;
  };
  crossMarginSummary: {
    accountValue: number;
    totalMarginUsed: number;
    totalNtlPos: number;
    totalRawUsd: number;
  };
  crossMaintenanceMarginUsed: number;
  withdrawable: number;
  assetPositions: Array<{
    position: Position;
    type: 'oneWay';
  }>;
}

// Orderbook types
export interface OrderbookLevel {
  px: number;
  sz: number;
  n: number;
}

export interface Orderbook {
  coin: string;
  levels: {
    bids: OrderbookLevel[];
    asks: OrderbookLevel[];
  };
  time: number;
}

// Candle types
export interface Candle {
  t: number; // open time
  T: number; // close time
  s: string; // coin
  i: string; // interval
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
  n: number; // number of trades
}

// Fill types
export interface Fill {
  coin: string;
  px: number;
  sz: number;
  side: OrderSide;
  time: number;
  startPosition: number;
  dir: 'Open' | 'Close' | 'Flip';
  closedPnl: number;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: number;
  tid: number;
  cloid?: string | null;
  feeToken?: string;
}

// Builder code types
export interface BuilderCode {
  b: string; // builder address
  f: number; // fee in tenths of basis points
}

// WebSocket message types
export type WsMessage =
  | { channel: 'allMids'; data: Record<string, string> }
  | { channel: 'l2Book'; data: { coin: string; levels: [OrderbookLevel[], OrderbookLevel[]]; time: number } }
  | { channel: 'trades'; data: Array<{ coin: string; side: OrderSide; px: number; sz: number; time: number; hash: string }> }
  | { channel: 'candle'; data: Candle }
  | { channel: 'orderUpdates'; data: Array<{ order: PlacedOrder; status: 'open' | 'filled' | 'canceled' | 'rejected' | 'marginCanceled' }> }
  | { channel: 'userFills'; data: Fill[] }
  | { channel: 'userFundings'; data: Array<{ coin: string; fundingRate: number; premium: number; time: number }> }
  | { channel: 'userNonFundingLedgerUpdates'; data: unknown[] };

// Telegram types
export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface TelegramInitData {
  query_id?: string;
  user?: TelegramUser;
  receiver?: TelegramUser;
  chat_instance?: string;
  chat_type?: string;
  start_param?: string;
  can_send_after?: number;
  auth_date: number;
  hash: string;
}
