import { Link } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useTranslation } from "react-i18next";

export function AccountSettingsMenu() {
  const { t } = useTranslation();
  const privy = usePrivy() as any;
  const settingsRoutes = [
    { path: "/account/settings/approvals", label: t("accountSettings.approvals") },
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
