import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  type MouseEventParams,
  createChart,
  type AreaData,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type LogicalRange,
  type Time,
} from "lightweight-charts";
import type { Candle } from "@repo/types";

export type ChartVariant = "trading" | "lite-area" | "lite-candles";
export type ChartTone = "positive" | "negative" | "neutral";
export type ChartZoomPreset = "auto-fit" | "interval-default";

export interface ChartRangeOption {
  key: string;
  label: string;
}

export interface LiteCandleInspection {
  candle: Candle;
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
}

interface ChartProps {
  candles: Candle[];
  interval: string;
  onIntervalChange?: (interval: string) => void;
  currentPrice?: number;
  mode?: "candlestick" | "area";
  areaData?: { time: number; value: number }[];
  heightClassName?: string;
  variant?: ChartVariant;
  tone?: ChartTone;
  ranges?: ChartRangeOption[];
  showFooterStats?: boolean;
  showGrid?: boolean;
  showLastPrice?: boolean;
  zoomPreset?: ChartZoomPreset;
  enableLiteCandleInspect?: boolean;
  onLiteCandleInspect?: (inspection: LiteCandleInspection | null) => void;
}

const TRADING_RANGES: ChartRangeOption[] = [
  { key: "1m", label: "1m" },
  { key: "5m", label: "5m" },
  { key: "15m", label: "15m" },
  { key: "1h", label: "1h" },
  { key: "4h", label: "4h" },
  { key: "1d", label: "1d" },
];

const LITE_CANDLE_VIEWPORTS: Record<
  string,
  { visibleBars: number; rightOffset: number }
> = {
  "15m": { visibleBars: 24, rightOffset: 2 },
  "1h": { visibleBars: 32, rightOffset: 3 },
  "4h": { visibleBars: 40, rightOffset: 4 },
  "1d": { visibleBars: 48, rightOffset: 5 },
  "24H": { visibleBars: 48, rightOffset: 5 },
};

const LITE_AREA_VIEWPORTS: Record<
  string,
  { visibleBars: number; rightOffset: number }
> = {
  "1d": { visibleBars: 24, rightOffset: 1 },
  "7d": { visibleBars: 32, rightOffset: 1 },
  "30d": { visibleBars: 40, rightOffset: 1 },
};

function getLiteToneClass(tone: ChartTone): string {
  if (tone === "positive") return "chart-tone-positive";
  if (tone === "negative") return "chart-tone-negative";
  return "chart-tone-neutral";
}

function getAreaSeriesColors(tone: ChartTone) {
  if (tone === "positive") {
    return {
      topColor: "rgba(255, 255, 255, 0.38)",
      bottomColor: "rgba(255, 255, 255, 0.02)",
      lineColor: "#ffffff",
    };
  }

  if (tone === "negative") {
    return {
      topColor: "rgba(255, 255, 255, 0.34)",
      bottomColor: "rgba(255, 255, 255, 0.02)",
      lineColor: "#ffffff",
    };
  }

  return {
    topColor: "rgba(255, 255, 255, 0.36)",
    bottomColor: "rgba(255, 255, 255, 0.02)",
    lineColor: "#ffffff",
  };
}

function getViewportPreset(
  variant: ChartVariant,
  interval: string,
): { visibleBars: number; rightOffset: number } | null {
  if (variant === "lite-candles") {
    return LITE_CANDLE_VIEWPORTS[interval] ?? LITE_CANDLE_VIEWPORTS["1h"];
  }

  if (variant === "lite-area") {
    return LITE_AREA_VIEWPORTS[interval] ?? LITE_AREA_VIEWPORTS["7d"];
  }

  return null;
}

function getVisibleLogicalRange(
  totalBars: number,
  visibleBars: number,
  rightOffset: number,
): LogicalRange | null {
  if (totalBars <= 0) return null;

  const effectiveVisibleBars = Math.min(Math.max(visibleBars, 6), totalBars);
  const clampedRightOffset = Math.max(Math.min(rightOffset, totalBars - 1), 0);
  const to = totalBars - 1 + clampedRightOffset;
  const from = Math.max(to - effectiveVisibleBars + 1, -0.5);

  return { from: from as Logical, to: to as Logical };
}

function formatBadgePrice(value: number): string {
  if (value >= 1000) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  if (value >= 1) {
    return value.toFixed(2);
  }

  return value.toFixed(4);
}

export function Chart({
  candles,
  interval,
  onIntervalChange,
  currentPrice,
  mode = "candlestick",
  areaData,
  heightClassName = "h-[300px]",
  variant = "trading",
  tone = "neutral",
  ranges,
  showFooterStats,
  showGrid,
  showLastPrice = false,
  zoomPreset = "auto-fit",
  enableLiteCandleInspect = false,
  onLiteCandleInspect,
}: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const areaSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [lastPriceY, setLastPriceY] = useState<number | null>(null);
  const [isLiteCandleInspecting, setIsLiteCandleInspecting] = useState(false);

  const seriesKind: "candlestick" | "area" = useMemo(() => {
    if (variant === "lite-area") return "area";
    if (variant === "lite-candles") return "candlestick";
    return mode;
  }, [mode, variant]);

  const lastPriceRef = useRef<number | null>(null);
  const variantRef = useRef(variant);
  const intervalRef = useRef(interval);
  const seriesKindRef = useRef(seriesKind);
  const zoomPresetRef = useRef(zoomPreset);
  const showLastPriceRef = useRef(showLastPrice);
  const candleCountRef = useRef(candles.length);
  const areaPointCountRef = useRef(areaData?.length ?? 0);
  const liteCandleInspectRef = useRef(enableLiteCandleInspect);
  const onLiteCandleInspectRef = useRef(onLiteCandleInspect);
  const candlesByTimeRef = useRef<Map<number, Candle>>(new Map());
  const isLiteCandleInspectingRef = useRef(false);

  const liteCandleInspectEnabled =
    variant === "lite-candles" && enableLiteCandleInspect;

  const resolvedRanges = useMemo(() => {
    if (ranges) return ranges;
    return variant === "trading" ? TRADING_RANGES : [];
  }, [ranges, variant]);

  const resolvedShowFooterStats =
    showFooterStats ?? (variant === "trading" && seriesKind === "candlestick");
  const resolvedShowGrid =
    showGrid ?? (variant === "trading" || variant === "lite-candles");

  const lastCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];

  const lastPrice = useMemo(() => {
    if (variant !== "lite-candles" || !showLastPrice) return null;
    const source = currentPrice ?? lastCandle?.c;
    return Number.isFinite(source) ? source : null;
  }, [currentPrice, lastCandle, showLastPrice, variant]);

  const lastPriceTone = useMemo(() => {
    if (lastPrice == null || !previousCandle) return "neutral";
    if (lastPrice > previousCandle.c) return "positive";
    if (lastPrice < previousCandle.c) return "negative";
    return "neutral";
  }, [lastPrice, previousCandle]);

  const chartOptions = useMemo(() => {
    const showAxes = variant === "trading";
    const showTimeLabels = variant === "trading";
    const viewportPreset = getViewportPreset(variant, interval);

    return {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: variant === "trading" ? "#6b7280" : "rgba(17, 24, 39, 0.52)",
      },
      grid: {
        vertLines: {
          visible: resolvedShowGrid,
          color:
            variant === "lite-candles" ? "rgba(187, 194, 211, 0.3)" : "#f3f4f6",
          style:
            variant === "lite-candles" ? LineStyle.Dashed : LineStyle.Solid,
        },
        horzLines: {
          visible: resolvedShowGrid && variant !== "lite-area",
          color:
            variant === "lite-candles"
              ? "rgba(187, 194, 211, 0.18)"
              : "#f3f4f6",
          style: LineStyle.Solid,
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { visible: variant === "trading" },
        horzLine: { visible: variant === "trading" },
      },
      rightPriceScale: {
        visible: showAxes,
        borderVisible: false,
      },
      leftPriceScale: {
        visible: false,
        borderVisible: false,
      },
      timeScale: {
        visible: showTimeLabels,
        borderVisible: false,
        timeVisible: variant === "trading",
        secondsVisible: false,
        rightOffset:
          viewportPreset?.rightOffset ?? (variant === "lite-candles" ? 3 : 0),
        barSpacing: variant === "lite-candles" ? 10 : 6,
      },
      handleScroll: {
        mouseWheel: variant === "trading",
        pressedMouseMove: variant === "trading",
        horzTouchDrag: variant === "trading",
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: variant === "trading",
        pinch: variant === "trading",
        axisPressedMouseMove: variant === "trading",
      },
    };
  }, [interval, resolvedShowGrid, variant]);

  const areaSeriesOptions = useMemo(() => {
    if (variant === "lite-area") {
      const colors = getAreaSeriesColors(tone);

      return {
        ...colors,
        lineWidth: 2 as const,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      };
    }

    return {
      topColor: "rgba(59, 130, 246, 0.3)",
      bottomColor: "transparent",
      lineColor: "#3b82f6",
      lineWidth: 2 as const,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    };
  }, [tone, variant]);

  const candlestickSeriesOptions = useMemo(() => {
    if (variant === "lite-candles") {
      return {
        upColor: "#22c55e",
        downColor: "#ec6ab7",
        borderUpColor: "#22c55e",
        borderDownColor: "#ec6ab7",
        wickUpColor: "#22c55e",
        wickDownColor: "#ec6ab7",
        priceLineVisible: false,
        lastValueVisible: false,
      };
    }

    return {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderDownColor: "#ef4444",
      borderUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      wickUpColor: "#22c55e",
    };
  }, [variant]);

  useEffect(() => {
    variantRef.current = variant;
    intervalRef.current = interval;
    seriesKindRef.current = seriesKind;
    zoomPresetRef.current = zoomPreset;
    showLastPriceRef.current = showLastPrice;
    candleCountRef.current = candles.length;
    areaPointCountRef.current = areaData?.length ?? 0;
    liteCandleInspectRef.current = liteCandleInspectEnabled;
    onLiteCandleInspectRef.current = onLiteCandleInspect;
    candlesByTimeRef.current = new Map(
      candles.map((candle) => [candle.t / 1000, candle]),
    );
  }, [
    areaData?.length,
    candles,
    interval,
    liteCandleInspectEnabled,
    onLiteCandleInspect,
    seriesKind,
    showLastPrice,
    variant,
    zoomPreset,
  ]);

  function updateLiteCandleInspecting(next: boolean) {
    if (isLiteCandleInspectingRef.current === next) return;
    isLiteCandleInspectingRef.current = next;
    setIsLiteCandleInspecting(next);
  }

  function publishLiteCandleInspect(inspection: LiteCandleInspection | null) {
    updateLiteCandleInspecting(inspection !== null);
    onLiteCandleInspectRef.current?.(inspection);
  }

  // Uses refs so it's safe to call from ResizeObserver or any async context.
  function updateLastPriceCoordinate(price: number | null) {
    if (
      !showLastPriceRef.current ||
      variantRef.current !== "lite-candles" ||
      price == null ||
      !candlestickSeriesRef.current
    ) {
      setLastPriceY(null);
      return;
    }

    const coordinate = candlestickSeriesRef.current.priceToCoordinate(price);
    if (coordinate == null || Number.isNaN(coordinate)) {
      setLastPriceY(null);
      return;
    }

    setLastPriceY(coordinate);
  }

  // Uses refs so it's safe to call from ResizeObserver or any async context.
  function applyViewport(totalPoints: number) {
    if (!chartRef.current || totalPoints === 0) return;

    if (zoomPresetRef.current === "interval-default" && variantRef.current !== "trading") {
      const viewportPreset = getViewportPreset(variantRef.current, intervalRef.current);
      const visibleRange = viewportPreset
        ? getVisibleLogicalRange(
            totalPoints,
            viewportPreset.visibleBars,
            viewportPreset.rightOffset,
          )
        : null;

      if (visibleRange) {
        chartRef.current.timeScale().setVisibleLogicalRange(visibleRange);
        return;
      }
    }

    chartRef.current.timeScale().fitContent();
  }

  function handleResize(width: number, height: number) {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      width: Math.max(width, 0),
      height: Math.max(height, 0),
    });
    const totalPoints =
      seriesKindRef.current === "area"
        ? areaPointCountRef.current
        : candleCountRef.current;
    if (totalPoints > 0) {
      applyViewport(totalPoints);
    }
    updateLastPriceCoordinate(lastPriceRef.current);
  }

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      ...chartOptions,
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    });

    chartRef.current = chart;
    setIsLoaded(true);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      handleResize(width, height);
    });

    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      candlestickSeriesRef.current = null;
      areaSeriesRef.current = null;
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions(chartOptions);
  }, [chartOptions]);

  useEffect(() => {
    if (!chartRef.current) return;

    if (seriesKind === "area") {
      if (candlestickSeriesRef.current) {
        chartRef.current.removeSeries(candlestickSeriesRef.current);
        candlestickSeriesRef.current = null;
      }

      if (!areaSeriesRef.current) {
        areaSeriesRef.current =
          chartRef.current.addAreaSeries(areaSeriesOptions);
      } else {
        areaSeriesRef.current.applyOptions(areaSeriesOptions);
      }

      return;
    }

    if (areaSeriesRef.current) {
      chartRef.current.removeSeries(areaSeriesRef.current);
      areaSeriesRef.current = null;
    }

    if (!candlestickSeriesRef.current) {
      candlestickSeriesRef.current = chartRef.current.addCandlestickSeries(
        candlestickSeriesOptions,
      );
    } else {
      candlestickSeriesRef.current.applyOptions(candlestickSeriesOptions);
    }
  }, [areaSeriesOptions, candlestickSeriesOptions, seriesKind]);

  useEffect(() => {
    if (seriesKind !== "area" || !areaSeriesRef.current || !chartRef.current)
      return;

    const formattedAreaData: AreaData<Time>[] = (areaData ?? []).map(
      (point) => ({
        time: (point.time / 1000) as Time,
        value: point.value,
      }),
    );

    areaSeriesRef.current.setData(formattedAreaData);

    if (formattedAreaData.length === 0) return;
    applyViewport(formattedAreaData.length);
  }, [areaData, interval, seriesKind, variant, zoomPreset]);

  useEffect(() => {
    if (
      seriesKind !== "candlestick" ||
      !candlestickSeriesRef.current ||
      !chartRef.current
    ) {
      return;
    }

    const formattedCandles: CandlestickData<Time>[] = candles.map((candle) => ({
      time: (candle.t / 1000) as Time,
      open: candle.o,
      high: candle.h,
      low: candle.l,
      close: candle.c,
    }));

    candlestickSeriesRef.current.setData(formattedCandles);

    if (formattedCandles.length === 0) return;
    applyViewport(formattedCandles.length);
  }, [candles, interval, seriesKind, variant, zoomPreset]);

  useEffect(() => {
    lastPriceRef.current = lastPrice;
    updateLastPriceCoordinate(lastPrice);
  }, [candles, currentPrice, interval, lastPrice, showLastPrice, variant]);

  useEffect(() => {
    publishLiteCandleInspect(null);
  }, [candles, interval, liteCandleInspectEnabled]);

  useEffect(() => {
    if (
      !liteCandleInspectEnabled ||
      seriesKind !== "candlestick" ||
      !chartRef.current ||
      !candlestickSeriesRef.current ||
      !chartContainerRef.current
    ) {
      return;
    }

    const chart = chartRef.current;
    const series = candlestickSeriesRef.current;
    const container = chartContainerRef.current;

    const clearInspection = () => publishLiteCandleInspect(null);

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (!liteCandleInspectRef.current) {
        clearInspection();
        return;
      }

      const point = param.point;
      if (
        !point ||
        point.x < 0 ||
        point.y < 0 ||
        point.x > container.clientWidth ||
        point.y > container.clientHeight
      ) {
        clearInspection();
        return;
      }

      const hoveredTime =
        typeof param.time === "number" ? param.time : null;
      if (hoveredTime == null) {
        clearInspection();
        return;
      }

      const candle = candlesByTimeRef.current.get(hoveredTime);
      const seriesData = param.seriesData.get(
        series,
      ) as CandlestickData<Time> | undefined;

      if (
        !candle ||
        !seriesData ||
        typeof seriesData.open !== "number" ||
        typeof seriesData.high !== "number" ||
        typeof seriesData.low !== "number" ||
        typeof seriesData.close !== "number"
      ) {
        clearInspection();
        return;
      }

      const coordinate = series.priceToCoordinate(seriesData.close);
      publishLiteCandleInspect({
        candle,
        x: point.x,
        y: coordinate ?? point.y,
        containerWidth: container.clientWidth,
        containerHeight: container.clientHeight,
      });
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    container.addEventListener("pointerleave", clearInspection);
    container.addEventListener("pointerup", clearInspection);
    container.addEventListener("touchend", clearInspection);
    container.addEventListener("touchcancel", clearInspection);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      container.removeEventListener("pointerleave", clearInspection);
      container.removeEventListener("pointerup", clearInspection);
      container.removeEventListener("touchend", clearInspection);
      container.removeEventListener("touchcancel", clearInspection);
    };
  }, [candles, liteCandleInspectEnabled, seriesKind]);

  const rangeSelector =
    resolvedRanges.length > 0 && onIntervalChange ? (
      <div
        className={
          variant === "trading"
            ? "mb-4 flex flex-wrap gap-2"
            : "mt-4 flex justify-center"
        }
      >
        <div
          className={
            variant === "trading"
              ? "contents"
              : "chart-range-pill inline-flex items-center gap-1 rounded-full px-1.5 py-1"
          }
        >
          {resolvedRanges.map((range) => {
            const active = interval === range.key;

            return (
              <button
                key={range.key}
                type="button"
                onClick={() => onIntervalChange(range.key)}
                aria-pressed={active}
                className={
                  variant === "trading"
                    ? `rounded-lg px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                        active
                          ? "bg-primary text-white"
                          : "bg-surface text-gray-600 hover:bg-gray-100"
                      }`
                    : `min-w-[42px] rounded-full px-3 py-1.5 text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 ${
                        active
                          ? "bg-white text-foreground shadow-sm"
                          : "text-gray-400"
                      }`
                }
              >
                {range.label}
              </button>
            );
          })}
        </div>
      </div>
    ) : null;

  const latestCandle = candles[candles.length - 1];
  const priceBadgeClass =
    lastPriceTone === "positive"
      ? "bg-[#22c55e] text-white"
      : lastPriceTone === "negative"
        ? "bg-[#ec6ab7] text-white"
        : "bg-slate-700 text-white";

  return (
    <div className="w-full">
      {variant === "trading" ? rangeSelector : null}

      <div
        className={[
          "relative w-full overflow-hidden",
          heightClassName,
          variant === "trading"
            ? "rounded-lg border border-separator bg-white"
            : variant === "lite-area"
              ? `chart-surface chart-surface--lite-area ${getLiteToneClass(tone)} rounded-[30px]`
              : "chart-surface chart-surface--lite-candles rounded-[28px]",
        ].join(" ")}
      >
        <div ref={chartContainerRef} className="absolute inset-0" />

        {showLastPrice &&
          variant === "lite-candles" &&
          lastPrice != null &&
          lastPriceY != null &&
          !isLiteCandleInspecting && (
            <div
              className="pointer-events-none absolute right-3 z-10 -translate-y-1/2"
              style={{ top: `${lastPriceY}px` }}
            >
              <div
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums shadow-sm ${priceBadgeClass}`}
              >
                {formatBadgePrice(lastPrice)}
              </div>
            </div>
          )}

        {!isLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-2 h-8 w-8 rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none animate-spin" />
              <p className="text-sm text-gray-400">Loading chart...</p>
            </div>
          </div>
        )}
      </div>

      {variant !== "trading" ? rangeSelector : null}

      {resolvedShowFooterStats && latestCandle && (
        <div className="mt-4 flex justify-between text-sm">
          <div className="flex space-x-4">
            <div>
              <span className="text-gray-400">O: </span>
              <span className="text-gray-700">{latestCandle.o.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-gray-400">H: </span>
              <span className="text-green-500">
                {latestCandle.h.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-gray-400">L: </span>
              <span className="text-red-500">{latestCandle.l.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-gray-400">C: </span>
              <span className="text-gray-700">{latestCandle.c.toFixed(2)}</span>
            </div>
          </div>
          <div>
            <span className="text-gray-400">Vol: </span>
            <span className="text-gray-700">{latestCandle.v.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
