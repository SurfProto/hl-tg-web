import { useMemo, useState } from "react";
import {
  SUPPORTED_STABLE_SWAP_ASSETS,
  useSpotBalance,
  useStableSwap,
  useUserState,
} from "@repo/hyperliquid-sdk";
import { useTranslation } from "react-i18next";
import type { StableSwapAsset } from "@repo/types";
import { StableBalanceList } from "../../components/StableBalanceList";

function StableAssetPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: StableSwapAsset;
  onChange: (asset: StableSwapAsset) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {SUPPORTED_STABLE_SWAP_ASSETS.map((asset) => {
          const active = asset === value;

          return (
            <button
              key={asset}
              type="button"
              onClick={() => onChange(asset)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                active
                  ? "bg-primary text-white"
                  : "border border-separator bg-white text-foreground active:bg-surface"
              }`}
            >
              {asset}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SwapPage() {
  const { t, i18n } = useTranslation();
  const [fromAsset, setFromAsset] = useState<StableSwapAsset>("USDC");
  const [toAsset, setToAsset] = useState<StableSwapAsset>("USDH");
  const [amount, setAmount] = useState("");
  const swap = useStableSwap();
  const { data: userState } = useUserState();
  const { data: spotBalance } = useSpotBalance();
  const isUnifiedLike =
    userState?.abstractionMode === "unifiedAccount" ||
    userState?.abstractionMode === "portfolioMargin" ||
    userState?.abstractionMode === "dexAbstraction";
  const visibleStableBalances = userState?.visibleStableBalances ?? [];

  const perpUsdcBalance = userState?.withdrawable ?? 0;
  const spotBalances = useMemo(() => {
    const next = new Map<StableSwapAsset, number>();

    for (const asset of SUPPORTED_STABLE_SWAP_ASSETS) {
      const entry = spotBalance?.balances?.find(
        (balance: any) => balance.coin?.toUpperCase() === asset,
      );
      const total = Number.parseFloat(entry?.total ?? "0") || 0;
      const hold = Number.parseFloat(entry?.hold ?? "0") || 0;
      next.set(asset, Math.max(0, total - hold));
    }

    return next;
  }, [spotBalance]);
  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      }),
    [i18n.language],
  );

  const sourceBalance =
    isUnifiedLike
      ? (userState?.stableBalances[fromAsset]?.available ?? 0)
      : fromAsset === "USDC"
        ? perpUsdcBalance
        : (spotBalances.get(fromAsset) ?? 0);
  const destinationLabel =
    isUnifiedLike
      ? t("swap.unifiedDestination", { asset: toAsset })
      : toAsset === "USDC"
        ? t("swap.returnToPerps")
        : t("swap.stayInSpot", { asset: toAsset });
  const parsedAmount = Number.parseFloat(amount);
  const isInvalidAmount =
    !amount || Number.isNaN(parsedAmount) || parsedAmount <= 0;
  const isSameAsset = fromAsset === toAsset;

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("swap.title")}</h1>
        <p className="mt-1 text-sm text-muted">
          {isUnifiedLike
            ? t("swap.descriptionUnified")
            : t("swap.description")}
        </p>
      </div>

      <StableBalanceList balances={visibleStableBalances} />

      <div className="rounded-3xl border border-separator bg-white p-4 shadow-sm">
        <StableAssetPicker
          label={t("swap.from")}
          value={fromAsset}
          onChange={(asset) => {
            setFromAsset(asset);
            if (asset === toAsset) {
              setToAsset(fromAsset);
            }
          }}
        />

        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => {
              setFromAsset(toAsset);
              setToAsset(fromAsset);
              setAmount("");
            }}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface text-lg text-foreground transition-colors active:bg-gray-200"
            aria-label={t("swap.flipDirection")}
          >
            {"\u21c5"}
          </button>
        </div>

        <StableAssetPicker
          label={t("swap.to")}
          value={toAsset}
          onChange={(asset) => {
            setToAsset(asset);
            if (asset === fromAsset) {
              setFromAsset(toAsset);
            }
          }}
        />

        <div className="mt-5 rounded-2xl bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="swap-amount"
              className="text-sm font-semibold text-foreground"
            >
              {t("swap.amount", { asset: fromAsset })}
            </label>
            <span className="text-xs text-muted">
              {t("swap.availableBalance", {
                amount: numberFormatter.format(sourceBalance),
                asset:
                  !isUnifiedLike && fromAsset === "USDC"
                    ? t("swap.perpUsdc")
                    : fromAsset,
              })}
            </span>
          </div>

          <div className="mt-3 flex gap-2">
            <input
              id="swap-amount"
              type="number"
              name="swap-amount"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              className="flex-1 rounded-2xl border border-separator bg-white px-4 py-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              type="button"
              onClick={() =>
                setAmount(
                  sourceBalance > 0
                    ? sourceBalance.toFixed(6).replace(/\.?0+$/, "")
                    : "",
                )
              }
              className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-primary transition-colors active:bg-gray-50"
            >
              MAX
            </button>
          </div>

          <div className="mt-4 rounded-2xl border border-separator bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted">
              {t("swap.routing")}
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {isUnifiedLike
                ? t("swap.routeUnified", { fromAsset, toAsset })
                : fromAsset === "USDC"
                ? t("swap.routePerpToSpot")
                : toAsset === "USDC"
                  ? t("swap.routeSpotToPerps", { fromAsset })
                  : t("swap.routeSpotToSpot", { fromAsset, toAsset })}
            </p>
            <p className="mt-1 text-xs text-muted">{destinationLabel}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            swap.mutate({
              fromAsset,
              toAsset,
              amount: parsedAmount,
            })
          }
          disabled={isInvalidAmount || isSameAsset || swap.isPending}
          className="mt-5 w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors disabled:opacity-50"
        >
          {swap.isPending
            ? t("swap.swapping")
            : t("swap.cta", { fromAsset, toAsset })}
        </button>

        {isSameAsset && (
          <p className="mt-3 text-sm text-negative">
            {t("swap.selectDifferentAssets")}
          </p>
        )}
        {swap.isSuccess && (
          <p className="mt-3 text-sm text-positive">{swap.data.message}</p>
        )}
        {swap.isError && (
          <p className="mt-3 text-sm text-negative">
            {swap.error instanceof Error ? swap.error.message : t("swap.failed")}
          </p>
        )}
      </div>
    </div>
  );
}
