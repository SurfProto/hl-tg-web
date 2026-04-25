import type { VisibleStableBalance } from "@repo/types";
import { useTranslation } from "react-i18next";

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

interface StableBalanceListProps {
  balances: VisibleStableBalance[];
  compact?: boolean;
}

export function StableBalanceList({
  balances,
  compact = false,
}: StableBalanceListProps) {
  const { t } = useTranslation();

  if (balances.length === 0) return null;

  if (compact) {
    return (
      <div className="mt-4 flex flex-wrap gap-2">
        {balances.map((balance) => (
          <div
            key={balance.asset}
            className="rounded-full border border-border bg-[var(--color-primary-soft)] px-3 py-2"
          >
            <p className="editorial-stat-label">
              {balance.asset}
            </p>
            <p className="editorial-mono mt-1 text-sm font-semibold text-foreground">
              {formatUsd(balance.available)}
            </p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="editorial-card p-4">
      <div className="grid grid-cols-2 gap-3">
        {balances.map((balance) => (
          <div
            key={balance.asset}
            className="rounded-[22px] border border-border bg-[var(--color-primary-soft)] p-3"
          >
            <p className="editorial-stat-label">
              {balance.asset}
            </p>
            <p className="editorial-mono mt-2 text-base font-semibold text-foreground">
              {formatUsd(balance.total)}
            </p>
            {balance.hold > 0 ? (
              <p className="mt-1 text-xs text-muted">
                {t("stableBalances.hold", { amount: formatUsd(balance.hold) })}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted">
                {t("stableBalances.available", {
                  amount: formatUsd(balance.available),
                })}
              </p>
            )}
            {balance.spot && balance.perp ? (
              <p className="mt-2 text-[11px] text-muted">
                {t("stableBalances.breakdown", {
                  perp: formatUsd(balance.perp.total),
                  spot: formatUsd(balance.spot.total),
                })}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
