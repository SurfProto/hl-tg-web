import type { PortfolioHistoryPoint } from '@repo/types';

export type PortfolioTone = 'positive' | 'negative' | 'neutral';

export function getPortfolioChangePct(history: PortfolioHistoryPoint[]): number {
  if (history.length < 2) return 0;

  const first = history[0]?.value ?? 0;
  const last = history[history.length - 1]?.value ?? 0;

  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) {
    return 0;
  }

  return ((last - first) / first) * 100;
}

export function getPortfolioTone(history: PortfolioHistoryPoint[]): PortfolioTone {
  const changePct = getPortfolioChangePct(history);

  if (changePct > 0) return 'positive';
  if (changePct < 0) return 'negative';
  return 'neutral';
}

export function getPortfolioRangePnl(pnlHistory: PortfolioHistoryPoint[]): number {
  if (pnlHistory.length === 0) return 0;
  if (pnlHistory.length === 1) return pnlHistory[0]?.value ?? 0;

  const first = pnlHistory[0]?.value ?? 0;
  const last = pnlHistory[pnlHistory.length - 1]?.value ?? 0;

  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return 0;
  }

  return last - first;
}

export function getPortfolioMaxDrawdownPct(history: PortfolioHistoryPoint[]): number {
  let peak = 0;
  let maxDrawdownPct = 0;

  for (const point of history) {
    if (!Number.isFinite(point.value) || point.value <= 0) continue;

    peak = Math.max(peak, point.value);
    if (peak <= 0) continue;

    const drawdownPct = ((point.value - peak) / peak) * 100;
    maxDrawdownPct = Math.min(maxDrawdownPct, drawdownPct);
  }

  return Math.abs(maxDrawdownPct);
}
