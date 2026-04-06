import { formatPrice } from "../utils/format";
import { useTranslation } from "react-i18next";
import type {
  ProtectionDraft,
  ProtectionKind,
  PositionDirection,
} from "../lib/protection";
import {
  getProtectionPnl,
  getProtectionPresetPrice,
  parseProtectionPrice,
} from "../lib/protection";

interface ProtectionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => void;
  draft: ProtectionDraft;
  onChange: (draft: ProtectionDraft) => void;
  direction: PositionDirection;
  marketLabel: string;
  currentPrice: number | null;
  referencePrice: number | null;
  size: number;
  submitLabel: string;
  isSubmitting?: boolean;
  disabledNotice?: string | null;
}

function formatPnl(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function getRuleCopy(
  direction: PositionDirection,
  kind: ProtectionKind,
  t: (key: string) => string,
): string {
  if (direction === "long") {
    return kind === "stopLoss"
      ? t("protection.longSlRule")
      : t("protection.longTpRule");
  }

  return kind === "stopLoss"
    ? t("protection.shortSlRule")
    : t("protection.shortTpRule");
}

export function ProtectionSheet({
  isOpen,
  onClose,
  onSubmit,
  draft,
  onChange,
  direction,
  marketLabel,
  currentPrice,
  referencePrice,
  size,
  submitLabel,
  isSubmitting = false,
  disabledNotice,
}: ProtectionSheetProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const pricePresets = [2, 5, 10];

  const updateDraft = (next: Partial<ProtectionDraft>) => {
    onChange({ ...draft, ...next });
  };

  const renderProtectionSection = (
    kind: ProtectionKind,
    label: string,
    accentClassName: string,
  ) => {
    const enabledKey =
      kind === "stopLoss" ? "stopLossEnabled" : "takeProfitEnabled";
    const valueKey = kind === "stopLoss" ? "stopLossPx" : "takeProfitPx";
    const enabled = draft[enabledKey];
    const rawValue = draft[valueKey];
    const parsedValue = parseProtectionPrice(rawValue);
    const helperPnl = getProtectionPnl(
      parsedValue,
      referencePrice,
      size,
      direction,
    );
    const inputId = `${kind}-trigger-px`;
    const helperId = `${kind}-helper`;

    return (
      <div className="rounded-[22px] border border-separator bg-surface px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{label}</p>
            <p className="mt-1 text-xs text-muted">
              {getRuleCopy(direction, kind, t)}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              updateDraft({
                [enabledKey]: !enabled,
              } as Partial<ProtectionDraft>)
            }
            aria-pressed={enabled}
            className={`min-w-[74px] rounded-full px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 ${
              enabled ? accentClassName : "bg-white text-gray-500 shadow-sm"
            }`}
          >
            {enabled ? t("protection.on") : t("protection.off")}
          </button>
        </div>

        {enabled && (
          <div className="mt-4 space-y-3">
            <label htmlFor={inputId} className="block">
              <span className="text-xs font-medium text-muted">
                {t("protection.triggerPrice")}
              </span>
              <input
                id={inputId}
                name={inputId}
                type="number"
                inputMode="decimal"
                step="any"
                value={rawValue}
                onChange={(event) =>
                  updateDraft({
                    [valueKey]: event.target.value,
                  } as Partial<ProtectionDraft>)
                }
                aria-describedby={helperId}
                className="mt-2 h-12 w-full rounded-2xl border border-separator bg-white px-4 text-base font-semibold text-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                placeholder={t("protection.pricePlaceholder")}
              />
            </label>

            {currentPrice != null && (
              <div className="flex flex-wrap gap-2">
                {pricePresets.map((percent) => (
                  <button
                    key={`${kind}-${percent}`}
                    type="button"
                    onClick={() =>
                      updateDraft({
                        [valueKey]: getProtectionPresetPrice(
                          currentPrice,
                          direction,
                          kind,
                          percent,
                        ),
                      } as Partial<ProtectionDraft>)
                    }
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 active:bg-gray-100"
                  >
                    {kind === "stopLoss" ? "-" : "+"}
                    {percent}%
                  </button>
                ))}
              </div>
            )}

            <div
              id={helperId}
              className="rounded-2xl bg-white/80 px-3 py-2 text-xs text-muted"
            >
              {parsedValue != null && helperPnl != null
                ? t("protection.estimatedPnl", { pnl: formatPnl(helperPnl) })
                : t("protection.enterTriggerPreview")}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label={t("protection.ariaClose")}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="protection-sheet-title"
        className="relative mt-auto max-h-[88vh] overflow-hidden rounded-t-[28px] bg-white animate-slide-up motion-reduce:animate-none"
      >
        <div className="flex max-h-[88vh] flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-4">
            <div className="flex justify-center">
              <div className="h-1 w-10 rounded-full bg-gray-300" />
            </div>

            <div className="mt-5 flex items-start justify-between gap-3">
              <div>
                <h3
                  id="protection-sheet-title"
                  className="text-lg font-bold text-foreground"
                >
                  {t("protection.title")}
                </h3>
                <p className="mt-1 text-sm text-muted">
                  {t("protection.subtitle", { market: marketLabel })}
                </p>
              </div>
              {currentPrice != null && (
                <div className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-foreground tabular-nums">
                  {t("protection.markPrice", { price: formatPrice(currentPrice) })}
                </div>
              )}
            </div>

            {disabledNotice && (
              <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                {disabledNotice}
              </div>
            )}

            <div className="mt-5 space-y-3 pb-4">
              {renderProtectionSection(
                "stopLoss",
                t("protection.stopLoss"),
                "bg-rose-500 text-white",
              )}
              {renderProtectionSection(
                "takeProfit",
                t("protection.takeProfit"),
                "bg-emerald-500 text-white",
              )}
            </div>

            <div className="mt-1 rounded-[22px] bg-surface px-4 py-3 text-sm text-muted">
              {referencePrice != null
                ? t("protection.referenceInfo", {
                    price: formatPrice(referencePrice),
                    size: Math.abs(size).toLocaleString("en-US", {
                      maximumFractionDigits: 6,
                    }),
                  })
                : t("protection.reducedOnlyInfo")}
            </div>
          </div>

          <div className="shrink-0 border-t border-separator bg-white px-4 pt-4 bottom-dock-safe">
            <button
              type="button"
              onClick={onSubmit}
              disabled={isSubmitting}
              className="w-full rounded-full bg-primary px-4 py-3.5 text-sm font-semibold text-white transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50 active:opacity-80"
            >
              {isSubmitting ? t("protection.saving") : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
