import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useUserState } from "@repo/hyperliquid-sdk";
import { useTranslation } from "react-i18next";
import { useHaptics } from "../hooks/useHaptics";
import { getAccountOverviewStats } from "./account-page-state";
import { StableBalanceList } from "../components/StableBalanceList";
import { UnifiedAccountBanner } from "../components/UnifiedAccountBanner";

function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function ChevronRightIcon() {
  return (
    <svg className="w-5 h-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function SkeletonBar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} />;
}

function MenuLink({
  to,
  icon,
  label,
  onClick,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center justify-between border-b border-separator py-4 transition-colors active:bg-gray-50 last:border-b-0"
    >
      <div className="flex items-center gap-3">
        <span className="text-muted">{icon}</span>
        <span className="text-base text-foreground">{label}</span>
      </div>
      <ChevronRightIcon />
    </Link>
  );
}

export function AccountPage() {
  const haptics = useHaptics();
  const { t } = useTranslation();
  const privy = usePrivy() as any;
  const { user } = privy;
  const { wallets } = useWallets();
  const { data: userState, isLoading: userStateLoading } = useUserState();

  const walletAddress =
    user?.wallet?.address ??
    wallets.find((wallet) => wallet.walletClientType === "privy")?.address;
  const telegramUsername = user?.telegram?.username ?? null;

  const {
    totalEquity,
    marginLocked,
    availableBalance,
    withdrawableBalance,
  } = getAccountOverviewStats(userState);
  const visibleStableBalances = userState?.visibleStableBalances ?? [];
  const shellLoading = userStateLoading;

  return (
    <div className="editorial-page">
      <div className="editorial-shell">
        <div className="editorial-card px-4 pb-4 pt-5">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-primary-soft)]">
              <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              {shellLoading ? (
                <>
                  <SkeletonBar className="h-6 w-32" />
                  <SkeletonBar className="mt-1.5 h-4 w-40 bg-gray-100" />
                </>
              ) : (
                <>
                  <p className="editorial-kicker">{t("nav.account")}</p>
                  <h1 className="mt-1 text-xl font-semibold text-foreground truncate">
                    {telegramUsername ? `@${telegramUsername}` : t("account.traderFallback")}
                  </h1>
                  <p className="editorial-mono mt-1 text-sm text-muted truncate">
                    {walletAddress ? formatAddress(walletAddress) : ""} · VIP {user?.vipTier ?? 0}
                  </p>
                </>
              )}
            </div>
          </div>
          {userState?.shouldPromptRestoreUnified ? <UnifiedAccountBanner /> : null}
        </div>

        <div className="editorial-card mt-4 px-4 py-4">
          <p className="editorial-kicker pb-3">{t("nav.account")}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="editorial-stat-label">{t("account.totalEquity")}</div>
              {shellLoading ? (
                <SkeletonBar className="mt-1.5 h-6 w-24" />
              ) : (
                <div className="editorial-mono mt-2 text-lg font-semibold text-foreground">
                  {formatUsd(totalEquity)}
                </div>
              )}
            </div>
            <div>
              <div className="editorial-stat-label">{t("account.marginLocked")}</div>
              {shellLoading ? (
                <SkeletonBar className="mt-1.5 h-6 w-24" />
              ) : (
                <div className="editorial-mono mt-2 text-lg font-semibold text-foreground">
                  {formatUsd(marginLocked)}
                </div>
              )}
            </div>
            <div>
              <div className="editorial-stat-label">{t("account.availableBalance")}</div>
              {shellLoading ? (
                <SkeletonBar className="mt-1.5 h-6 w-24" />
              ) : (
                <div className="editorial-mono mt-2 text-lg font-semibold text-foreground">
                  {formatUsd(availableBalance)}
                </div>
              )}
            </div>
            <div>
              <div className="editorial-stat-label">{t("account.withdrawableBalance")}</div>
              {shellLoading ? (
                <SkeletonBar className="mt-1.5 h-6 w-24" />
              ) : (
                <div className="editorial-mono mt-2 text-lg font-semibold text-foreground">
                  {formatUsd(withdrawableBalance)}
                </div>
              )}
            </div>
          </div>
        </div>

        {visibleStableBalances.length > 0 && (
          <div className="mt-4">
            <StableBalanceList balances={visibleStableBalances} />
          </div>
        )}

        <div className="pb-2 pt-6">
          <div className="editorial-kicker">{t("account.funds")}</div>
        </div>
        <div className="editorial-card px-4">
          <MenuLink
            to="/account/deposit"
            onClick={() => haptics.light()}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m0-15l-3 3m3-3l3 3" />
              </svg>
            }
            label={t("account.deposit")}
          />
          <MenuLink
            to="/account/withdraw"
            onClick={() => haptics.light()}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19.5v-15m0 15l-3-3m3 3l3-3" />
              </svg>
            }
            label={t("account.withdraw")}
          />
          <MenuLink
            to="/account/swap"
            onClick={() => haptics.light()}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
            }
            label={t("account.swap")}
          />
        </div>

        <div className="pb-2 pt-6">
          <div className="editorial-kicker">{t("account.settings")}</div>
        </div>
        <div className="editorial-card mb-6 px-4">
          <MenuLink
            to="/account/notifications"
            onClick={() => haptics.light()}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
            }
            label={t("account.notifications")}
          />
          <MenuLink
            to="/account/approvals"
            onClick={() => haptics.light()}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            }
            label={t("account.approvals")}
          />
          <MenuLink
            to="/account/personal"
            onClick={() => haptics.light()}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            }
            label={t("account.personalInfo")}
          />
        </div>
      </div>
    </div>
  );
}
