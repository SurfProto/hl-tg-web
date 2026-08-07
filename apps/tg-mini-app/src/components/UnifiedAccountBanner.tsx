import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function UnifiedAccountBanner() {
  const { t } = useTranslation();

  return (
    <div className="mt-5 rounded-[18px] border border-primary/15 bg-[var(--color-primary-soft)] px-4 py-3 text-left">
      <p className="text-sm font-semibold text-foreground">
        {t("unifiedBanner.title")}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
        {t("unifiedBanner.description")}
      </p>
      <Link
        to="/account"
        className="mt-3 inline-flex rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors active:bg-primary-dark"
      >
        {t("unifiedBanner.cta")}
      </Link>
    </div>
  );
}
