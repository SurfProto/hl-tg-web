import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import type { Candle } from '@repo/types';

interface ChartProps {
  candles: Candle[];
  interval: string;
  onIntervalChange?: (interval: string) => void;
  currentPrice?: number;
  mode?: 'candlestick' | 'area';
  areaData?: { time: number; value: number }[];
  heightClassName?: string;
}

export function Chart({ candles, interval, onIntervalChange, currentPrice, mode = 'candlestick', areaData, heightClassName = 'h-[300px]' }: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const areaSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const intervals = ['1m', '5m', '15m', '1h', '4h', '1d'];

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#ffffff' },
        textColor: '#6b7280',
      },
      grid: {
        vertLines: { color: '#f3f4f6' },
        horzLines: { color: '#f3f4f6' },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: '#e5e7eb',
      },
      timeScale: {
        borderColor: '#e5e7eb',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
      },
    });

    if (mode === 'area') {
      const areaSeries = chart.addAreaSeries({
        topColor: 'rgba(59, 130, 246, 0.3)',
        bottomColor: 'transparent',
        lineColor: '#3b82f6',
        lineWidth: 2,
      });
      areaSeriesRef.current = areaSeries;
    } else {
      const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderDownColor: '#ef4444',
        borderUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        wickUpColor: '#22c55e',
      });
      candlestickSeriesRef.current = candlestickSeries;
    }

    chartRef.current = chart;
    setIsLoaded(true);

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [mode]);

  // Update area data
  useEffect(() => {
    if (mode !== 'area' || !areaSeriesRef.current || !areaData || areaData.length === 0) return;
    areaSeriesRef.current.setData(
      areaData.map(p => ({ time: (p.time / 1000) as Time, value: p.value }))
    );
    if (chartRef.current) chartRef.current.timeScale().fitContent();
  }, [areaData, mode]);

  // Update candles
  useEffect(() => {
    if (!candlestickSeriesRef.current || candles.length === 0) return;

    const formattedCandles: CandlestickData[] = candles.map((candle) => ({
      time: (candle.t / 1000) as Time,
      open: candle.o,
      high: candle.h,
      low: candle.l,
      close: candle.c,
    }));

    candlestickSeriesRef.current.setData(formattedCandles);

    // Fit content
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [candles]);

  return (
    <div className="w-full">
      {/* Interval Selector — hidden in area mode */}
      {mode !== 'area' && (
        <div className="flex space-x-2 mb-4">
          {intervals.map((int) => (
            <button
              key={int}
              onClick={() => onIntervalChange?.(int)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                interval === int
                  ? 'bg-primary text-white'
                  : 'bg-surface text-gray-600 hover:bg-gray-100'
              }`}
            >
              {int}
            </button>
          ))}
        </div>
      )}

      {/* Chart Container */}
      <div
        ref={chartContainerRef}
        className={`w-full ${heightClassName} bg-white rounded-lg overflow-hidden`}
      >
        {!isLoaded && (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2"></div>
              <p className="text-gray-400 text-sm">Loading chart...</p>
            </div>
          </div>
        )}
      </div>

      {/* Price Info — candlestick mode only */}
      {mode !== 'area' && candles.length > 0 && (
        <div className="flex justify-between mt-4 text-sm">
          <div className="flex space-x-4">
            <div>
              <span className="text-gray-400">O: </span>
              <span className="text-gray-700">
                {candles[candles.length - 1]?.o.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-gray-400">H: </span>
              <span className="text-green-500">
                {candles[candles.length - 1]?.h.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-gray-400">L: </span>
              <span className="text-red-500">
                {candles[candles.length - 1]?.l.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-gray-400">C: </span>
              <span className="text-gray-700">
                {candles[candles.length - 1]?.c.toFixed(2)}
              </span>
            </div>
          </div>
          <div>
            <span className="text-gray-400">Vol: </span>
            <span className="text-gray-700">
              {candles[candles.length - 1]?.v.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
