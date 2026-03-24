import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import type { Candle } from '@repo/types';

interface ChartProps {
  candles: Candle[];
  interval: string;
  onIntervalChange?: (interval: string) => void;
  currentPrice?: number;
}

export function Chart({ candles, interval, onIntervalChange, currentPrice }: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const intervals = ['1m', '5m', '15m', '1h', '4h', '1d'];

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#1a1a1a' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#2d2d2d' },
        horzLines: { color: '#2d2d2d' },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: '#2d2d2d',
      },
      timeScale: {
        borderColor: '#2d2d2d',
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

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      wickUpColor: '#22c55e',
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
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
  }, []);

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
      {/* Interval Selector */}
      <div className="flex space-x-2 mb-4">
        {intervals.map((int) => (
          <button
            key={int}
            onClick={() => onIntervalChange?.(int)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              interval === int
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {int}
          </button>
        ))}
      </div>

      {/* Chart Container */}
      <div
        ref={chartContainerRef}
        className="w-full h-[400px] bg-gray-900 rounded-lg overflow-hidden"
      >
        {!isLoaded && (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-2"></div>
              <p className="text-gray-500 text-sm">Loading chart...</p>
            </div>
          </div>
        )}
      </div>

      {/* Price Info */}
      {candles.length > 0 && (
        <div className="flex justify-between mt-4 text-sm">
          <div className="flex space-x-4">
            <div>
              <span className="text-gray-500">O: </span>
              <span className="text-gray-300">
                {candles[candles.length - 1]?.o.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-gray-500">H: </span>
              <span className="text-green-500">
                {candles[candles.length - 1]?.h.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-gray-500">L: </span>
              <span className="text-red-500">
                {candles[candles.length - 1]?.l.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-gray-500">C: </span>
              <span className="text-gray-300">
                {candles[candles.length - 1]?.c.toFixed(2)}
              </span>
            </div>
          </div>
          <div>
            <span className="text-gray-500">Vol: </span>
            <span className="text-gray-300">
              {candles[candles.length - 1]?.v.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
