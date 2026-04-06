import { Link } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useTranslation } from "react-i18next";
import {
  getBuilderAddress,
  isBuilderConfigured,
  useApproveBuilderFee,
  useBuilderFeeApproval,
} from "@repo/hyperliquid-sdk";
import { useHaptics } from "../../hooks/useHaptics";

function formatBuilderAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function AccountSettingsMenu() {
  const haptics = useHaptics();
  const { t } = useTranslation();
  const privy = usePrivy() as any;
  const { data: maxFee, isLoading: builderApprovalLoading } =
    useBuilderFeeApproval();
  const approveBuilderFee = useApproveBuilderFee();
  const builderConfigured = isBuilderConfigured();
  const builderApproved = (maxFee ?? 0) > 0;
  const builderAddress = getBuilderAddress();
  const settingsRoutes = [
    { path: "/account/settings/personal", label: t("accountSettings.personalInfo") },
    { path: "/account/settings/notifications", label: t("accountSettings.notifications") },
    { path: "/account/settings/private-key", label: t("accountSettings.privateKey") },
    { path: "/account/settings/language", label: t("accountSettings.language") },
    { path: "/account/settings/support", label: t("accountSettings.support") },
    { path: "/account/settings/legal", label: t("accountSettings.legal") },
  ];

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <h1 className="text-2xl font-bold text-foreground">{t("accountSettings.title")}</h1>

      <div className="overflow-hidden rounded-2xl border border-separator bg-white shadow-sm">
        {settingsRoutes.map((route, index) => (
          <Link
            key={route.path}
            to={route.path}
            className={`flex w-full items-center justify-between px-4 py-4 text-left text-sm font-semibold text-foreground transition-colors active:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${index < settingsRoutes.length - 1 ? "border-b border-separator" : ""}`}
          >
            <span>{route.label}</span>
            <span className="text-muted" aria-hidden="true">
              {"\u203a"}
            </span>
          </Link>
        ))}
      </div>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {t("account.builderCode")}
            </p>
            <p className="mt-1 text-xs text-muted">
              {formatBuilderAddress(builderAddress)}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              builderApproved
                ? "bg-green-50 text-positive"
                : "bg-yellow-50 text-amber-600"
            }`}
          >
            {!builderConfigured
              ? t("account.disabled")
              : builderApprovalLoading
                ? t("account.checking")
                : builderApproved
                  ? t("account.approved")
                  : t("account.notApproved")}
          </span>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">{t("account.builderAddress")}</p>
            <p className="mt-1 break-all font-mono text-sm text-foreground">
              {builderAddress}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(builderAddress);
              haptics.success();
            }}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-foreground transition-colors active:bg-gray-100"
          >
            {t("common.copy")}
          </button>
        </div>

        {builderConfigured && !builderApproved && !builderApprovalLoading && (
          <button
            type="button"
            onClick={() => approveBuilderFee.mutate()}
            disabled={approveBuilderFee.isPending}
            className="mt-4 w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors active:bg-primary-dark disabled:opacity-60"
          >
            {approveBuilderFee.isPending
              ? t("account.approving")
              : t("account.approveBuilderFee")}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => privy.logout()}
        className="w-full rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-negative transition-colors active:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
      >
        {t("account.logOut")}
      </button>
    </div>
  );
}
