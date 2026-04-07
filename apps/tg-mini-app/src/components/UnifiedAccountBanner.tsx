import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function UnifiedAccountBanner() {
  const { t } = useTranslation();

  return (
    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left">
      <p className="text-sm font-semibold text-amber-900">
        {t("unifiedBanner.title")}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-amber-800">
        {t("unifiedBanner.description")}
      </p>
      <Link
        to="/account"
        className="mt-3 inline-flex rounded-full bg-white px-3 py-2 text-xs font-semibold text-amber-900 transition-colors active:bg-amber-100"
      >
        {t("unifiedBanner.cta")}
      </Link>
    </div>
  );
}
