import { useState } from "react";
import type { ReferralSummary } from "@repo/types";
import { useTranslation } from "react-i18next";
import { useToast } from "../hooks/useToast";
import { buildTelegramReferralLink, normalizeReferralCode, openReferralInvite } from "../lib/referrals";
import { applyReferralCode, RewardsApiError } from "../lib/rewards";

function getReferralErrorMessage(error: unknown, t: (key: string) => string) {
  if (error instanceof RewardsApiError) {
    switch (error.code) {
      case "INVALID_REFERRAL_CODE":
        return t("points.referral.errors.invalid");
      case "REFERRAL_CODE_NOT_FOUND":
        return t("points.referral.errors.notFound");
      case "REFERRAL_ALREADY_SET":
        return t("points.referral.errors.alreadySet");
      case "SELF_REFERRAL_NOT_ALLOWED":
        return t("points.referral.errors.self");
      default:
        return error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return t("errors.somethingWentWrong");
}

interface ReferralCardProps {
  accessToken: string;
  referral: ReferralSummary;
  onApplied: (summary: ReferralSummary) => void | Promise<void>;
}

export function ReferralCard({ accessToken, referral, onApplied }: ReferralCardProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [draftCode, setDraftCode] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const [isLaunchingInvite, setIsLaunchingInvite] = useState(false);
  const normalizedDraft = normalizeReferralCode(draftCode);

  const handleInvite = async () => {
    setIsLaunchingInvite(true);
    try {
      const result = await openReferralInvite(referral.referralCode);
      toast.success(
        result === "opened"
          ? t("points.referral.toasts.inviteOpened")
          : t("points.referral.toasts.inviteCopied"),
      );
    } catch (error) {
      toast.error(getReferralErrorMessage(error, t));
    } finally {
      setIsLaunchingInvite(false);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(referral.referralCode);
      toast.success(t("points.referral.toasts.codeCopied"));
    } catch (error) {
      toast.error(getReferralErrorMessage(error, t));
    }
  };

  const handleCopyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(buildTelegramReferralLink(referral.referralCode));
      toast.success(t("points.referral.toasts.inviteCopied"));
    } catch (error) {
      toast.error(getReferralErrorMessage(error, t));
    }
  };

  const handleApply = async () => {
    setIsApplying(true);
    try {
      const summary = await applyReferralCode(accessToken, {
        referralCode: normalizedDraft,
      });
      setDraftCode("");
      await onApplied(summary);
      toast.success(t("points.referral.toasts.codeApplied"));
    } catch (error) {
      toast.error(getReferralErrorMessage(error, t));
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="editorial-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="editorial-kicker">{t("points.referral.title")}</p>
          <p className="mt-1 text-sm text-muted">{t("points.referral.description")}</p>
        </div>
        <button
          className="editorial-button-primary px-4 py-2 disabled:opacity-60"
          disabled={isLaunchingInvite}
          onClick={() => void handleInvite()}
          type="button"
        >
          {t("points.invite")}
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-[22px] bg-[var(--color-primary-soft)] px-4 py-3">
        <div>
          <p className="editorial-stat-label">{t("points.referralCode")}</p>
          <p className="editorial-mono mt-1 text-sm font-semibold text-foreground">
            {referral.referralCode}
          </p>
        </div>
        <div className="text-right">
          <p className="editorial-stat-label">{t("points.referral.fundedTotal")}</p>
          <p className="editorial-mono mt-1 text-sm font-semibold text-foreground">
            {referral.fundedReferralCount}/{referral.referredCount}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="editorial-button-secondary px-4 py-2"
          onClick={() => void handleCopyInviteLink()}
          type="button"
        >
          {t("points.referral.copyInviteLink")}
        </button>
        <button
          className="editorial-button-secondary px-4 py-2"
          onClick={() => void handleCopyCode()}
          type="button"
        >
          {t("points.referral.copyCode")}
        </button>
      </div>

      <p className="mt-3 text-xs text-muted">{t("points.referral.manualHint")}</p>

      {referral.hasReferrer ? (
        <div className="mt-4 rounded-[22px] border border-border bg-surface px-4 py-3 text-sm text-muted">
          {t("points.referral.linkedState")}
        </div>
      ) : (
        <div className="mt-4 rounded-[22px] border border-border bg-white p-3">
          <label className="editorial-stat-label" htmlFor="manual-referral-code">
            {t("points.enterReferralCode")}
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="manual-referral-code"
              aria-label={t("points.enterReferralCode")}
              className="min-w-0 flex-1 rounded-[18px] border border-border px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
              onChange={(event) => setDraftCode(event.target.value)}
              placeholder={t("points.referral.manualPlaceholder")}
              value={draftCode}
            />
            <button
              className="editorial-button-primary rounded-[18px] px-4 py-3 disabled:opacity-60"
              disabled={isApplying || normalizedDraft.length === 0}
              onClick={() => void handleApply()}
              type="button"
            >
              {isApplying ? t("common.saving") : t("points.applyReferralCode")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
