import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

// Rendered by the catch-all route. It carries its own way out because the
// bottom nav is hidden on several route prefixes (see SUB_ROUTES_HIDE_NAV),
// so an unmatched path under one of them would otherwise leave no navigation
// at all — Telegram's BackButton is the only other escape and it is not
// available on every client.
export function NotFoundPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="editorial-page px-4 py-5">
      <div className="rounded-[18px] border border-separator bg-white p-10 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface">
          <svg
            className="h-7 w-7 text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <p className="text-base font-semibold text-foreground">
          {t("notFound.title")}
        </p>
        <p className="mt-1 text-sm text-muted">{t("notFound.body")}</p>
        <button
          type="button"
          onClick={() => navigate("/", { replace: true })}
          className="editorial-button-primary mt-5"
        >
          {t("notFound.action")}
        </button>
      </div>
    </div>
  );
}
