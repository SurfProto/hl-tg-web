import { createContext, useContext, useState, type ReactNode } from 'react';
import type { PortfolioRange } from '@repo/types';

type PortfolioRangeContextValue = {
  period: PortfolioRange;
  setPeriod: (period: PortfolioRange) => void;
};

const PortfolioRangeContext = createContext<PortfolioRangeContextValue | null>(null);

export function PortfolioRangeProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<PortfolioRange>('7d');

  return (
    <PortfolioRangeContext.Provider value={{ period, setPeriod }}>
      {children}
    </PortfolioRangeContext.Provider>
  );
}

export function usePortfolioRange() {
  const context = useContext(PortfolioRangeContext);

  if (!context) {
    throw new Error('usePortfolioRange must be used within a PortfolioRangeProvider');
  }

  return context;
}
