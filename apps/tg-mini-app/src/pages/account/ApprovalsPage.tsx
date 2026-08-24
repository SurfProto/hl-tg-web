import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getBuilderAddress,
  isBuilderConfigured,
  isUserRejectedSignature,
  useAgentApprovalStatus,
  useApproveAgentTrading,
  useApproveBuilderFee,
  useBuilderFeeApproval,
  useRevokeAgentTrading,
  useRevokeBuilderFee,
  useSetUnifiedAccount,
  useUnifiedAccountApproval,
} from "@repo/hyperliquid-sdk";

interface ApprovalCardAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "destructive";
}

interface MetaRow {
  label: string;
  value: string;
}

interface ApprovalCard {
  key: string;
  title: string;
  description: string;
  meta?: string;
  metaRows?: MetaRow[];
  statusLabel: string;
  statusTone: "positive" | "warning" | "muted";
  actions: ApprovalCardAction[];
  error: string | null;
  notice?: string | null;
}

/** Which confirmation is open, if any. Both are surprising enough to ask. */
type PendingConfirmation = "reauthorize" | "revoke" | null;

function ApprovalStatusPill({
  tone,
  label,
}: {
  tone: "positive" | "warning" | "muted";
  label: string;
}) {
  const className =
    tone === "positive"
      ? "p34k-signal text-positive"
      : tone === "warning"
        ? "bg-[var(--color-primary-soft)] text-primary"
        : "bg-surface text-muted";

  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

function ApprovalActionButton({
  label,
  onClick,
  disabled = false,
  variant = "primary",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "destructive";
}) {
  const className =
    variant === "primary"
      ? "bg-primary text-white active:bg-primary-dark"
      : variant === "destructive"
        ? "border border-separator bg-white text-negative active:bg-surface"
        : "border border-separator bg-white text-foreground active:bg-surface";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${className}`}
    >
      {label}
    </button>
  );
}

/**
 * A confirmation to read before something that cannot be taken back.
 *
 * Both of these surprise people in opposite directions: reauthorizing quietly
 * stops another device from trading, and revoking sounds like it might close
 * positions. The body text exists to say which of those is actually true.
 */
function ConfirmationSheet({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  isPending,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <button
        type="button"
        aria-label={cancelLabel}
        className="absolute inset-0 bg-black/40"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-confirm-title"
        className="relative mt-auto rounded-t-[24px] bg-white px-4 pt-4 pb-8 animate-slide-up"
      >
        <div className="mb-5 flex justify-center">
          <div className="h-1 w-10 rounded-full bg-separator" />
        </div>
        <h2
          id="approval-confirm-title"
          className="mb-2 text-center text-lg font-bold text-foreground"
        >
          {title}
        </h2>
        <p className="mb-6 text-center text-sm leading-relaxed text-muted">
          {body}
        </p>
        <div className="space-y-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors active:bg-primary-dark disabled:opacity-50"
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-muted disabled:opacity-50"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ApprovalsPage() {
  const { t, i18n } = useTranslation();
  const builderConfigured = isBuilderConfigured();
  const builderAddress = getBuilderAddress();
  const agentApproval = useAgentApprovalStatus();
  const approveAgent = useApproveAgentTrading();
  const revokeAgent = useRevokeAgentTrading();
  const builderApproval = useBuilderFeeApproval();
  const approveBuilder = useApproveBuilderFee();
  const revokeBuilder = useRevokeBuilderFee();
  const unifiedApproval = useUnifiedAccountApproval();
  const setUnifiedAccount = useSetUnifiedAccount();
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation>(null);

  const agent = agentApproval.data;
  const formatTime = (value: number) =>
    new Date(value).toLocaleString(i18n.language);

  const verificationLabel = (() => {
    if (agent?.reason === "remote-only")
      return t("approvals.verificationRemote");
    if (!agent?.hasLocalKey) return t("approvals.verificationNone");
    if (agent.remoteConfirmed) return t("approvals.verificationConfirmed");
    if (agent.reason === "awaiting-propagation")
      return t("approvals.verificationPending");
    if (agent.reason === "verification-unavailable")
      return t("approvals.verificationUnavailable");
    return t("approvals.verificationNone");
  })();

  // A revocation that went through unconfirmed is not a success to report
  // quietly. The local key is gone either way; what the user does not know is
  // whether the exchange agrees, and only saying so is honest.
  const revokeNotice = (() => {
    if (revokeAgent.isError) {
      return isUserRejectedSignature(revokeAgent.error)
        ? t("approvals.revokeCancelled")
        : t("approvals.revokeUnconfirmed");
    }
    if (revokeAgent.isSuccess && revokeAgent.data?.remoteConfirmed === false) {
      return t("approvals.revokeUnconfirmed");
    }
    return null;
  })();

  // React Query stays in its initial loading state while it retries. Once an
  // attempt has already failed, "Checking" is no longer the honest thing to
  // show even if a background retry is still in flight.
  const unifiedUnavailable =
    unifiedApproval.isError || unifiedApproval.failureCount > 0;

  const agentActions: ApprovalCardAction[] = [
    {
      label: agent?.hasLocalKey
        ? t("approvals.reauthorize")
        : agent?.remoteConfirmed
          ? t("approvals.reauthorize")
          : t("approvals.approve"),
      // Offered even while the approval looks active: an authorization can be
      // dead at the exchange while it still reads as alive here, and that is
      // precisely when someone needs this button.
      onClick: () =>
        agent?.hasLocalKey || agent?.remoteConfirmed
          ? setPendingConfirmation("reauthorize")
          : approveAgent.mutate(),
      disabled: approveAgent.isPending || revokeAgent.isPending,
      variant: "primary" as const,
    },
  ];

  if (agent?.hasLocalKey || agent?.remoteConfirmed) {
    agentActions.push({
      label: t("approvals.revoke"),
      onClick: () => setPendingConfirmation("revoke"),
      disabled: approveAgent.isPending || revokeAgent.isPending,
      variant: "destructive" as const,
    });
  }

  const cards: ApprovalCard[] = [
    {
      key: "gasless",
      title: t("approvals.gaslessTitle"),
      description: t("approvals.gaslessDescription"),
      metaRows: [
        {
          label: t("approvals.agentAddressLabel"),
          value: agent?.address ?? t("approvals.notAvailable"),
        },
        {
          label: t("approvals.expiryLabel"),
          value: agent?.validUntil
            ? formatTime(agent.validUntil)
            : t("approvals.noExpiry"),
        },
        {
          label: t("approvals.verificationLabel"),
          value: verificationLabel,
        },
        {
          label: t("approvals.lastCheckLabel"),
          value: agent?.lastVerifiedAt
            ? formatTime(agent.lastVerifiedAt)
            : t("approvals.neverChecked"),
        },
      ],
      statusLabel: agentApproval.isLoading
        ? t("account.checking")
        : agent?.reason === "remote-only"
          ? t("approvals.authorizedElsewhere")
          : agent?.approved
            ? t("account.approved")
            : agent?.isExpired
              ? t("approvals.expired")
              : t("account.notApproved"),
      statusTone:
        agent?.reason === "remote-only"
          ? "warning"
          : agent?.approved
            ? "positive"
            : agent?.isExpired
              ? "warning"
              : "muted",
      actions: agentActions,
      notice: revokeNotice,
      error:
        (approveAgent.isError && approveAgent.error instanceof Error
          ? approveAgent.error.message
          : null) ??
        (revokeAgent.isError &&
        revokeAgent.error instanceof Error &&
        !isUserRejectedSignature(revokeAgent.error)
          ? revokeAgent.error.message
          : null),
    },
    {
      key: "builder",
      title: t("approvals.builderTitle"),
      description: t("approvals.builderDescription"),
      meta: builderConfigured ? builderAddress : t("approvals.notConfigured"),
      statusLabel: !builderConfigured
        ? t("account.disabled")
        : builderApproval.isLoading
          ? t("account.checking")
          : (builderApproval.data ?? 0) > 0
            ? t("account.approved")
            : t("account.notApproved"),
      statusTone: !builderConfigured
        ? "muted"
        : (builderApproval.data ?? 0) > 0
          ? "positive"
          : "warning",
      actions: builderConfigured
        ? [
            {
              label: t("approvals.approve"),
              onClick: () => approveBuilder.mutate(),
              disabled:
                approveBuilder.isPending || (builderApproval.data ?? 0) > 0,
              variant: "primary" as const,
            },
            {
              label: t("approvals.revoke"),
              onClick: () => revokeBuilder.mutate(),
              disabled:
                revokeBuilder.isPending || (builderApproval.data ?? 0) <= 0,
              variant: "secondary" as const,
            },
          ]
        : [],
      error:
        (approveBuilder.isError && approveBuilder.error instanceof Error
          ? approveBuilder.error.message
          : null) ??
        (revokeBuilder.isError && revokeBuilder.error instanceof Error
          ? revokeBuilder.error.message
          : null),
    },
    {
      key: "unified",
      title: t("approvals.unifiedTitle"),
      description: t("approvals.unifiedDescription"),
      meta: unifiedUnavailable
        ? t("approvals.unifiedUnavailable")
        : unifiedApproval.data?.enabled
          ? t("approvals.unifiedEnabled")
          : t("approvals.unifiedDisabled"),
      statusLabel: unifiedUnavailable
        ? t("approvals.unavailable")
        : unifiedApproval.isLoading
          ? t("account.checking")
          : unifiedApproval.data?.enabled
            ? t("account.approved")
            : t("account.notApproved"),
      statusTone: unifiedApproval.data?.enabled ? "positive" : "warning",
      actions: [
        {
          label: t("approvals.enable"),
          onClick: () => setUnifiedAccount.mutate(true),
          disabled:
            setUnifiedAccount.isPending ||
            Boolean(unifiedApproval.data?.enabled),
          variant: "primary" as const,
        },
        {
          label: t("approvals.disable"),
          onClick: () => setUnifiedAccount.mutate(false),
          disabled:
            setUnifiedAccount.isPending || !unifiedApproval.data?.enabled,
          variant: "secondary" as const,
        },
      ],
      error:
        setUnifiedAccount.isError && setUnifiedAccount.error instanceof Error
          ? setUnifiedAccount.error.message
          : null,
    },
  ];

  return (
    <div className="editorial-page px-4 py-5 space-y-4">
      <div>
        <div>
          <p className="editorial-kicker">{t("nav.account")}</p>
          <h1 className="editorial-heading text-foreground">
            {t("approvals.title")}
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted">{t("approvals.subtitle")}</p>
      </div>

      {cards.map((card) => (
        <div
          key={card.key}
          className="rounded-[18px] border border-separator bg-white p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {card.title}
              </p>
              <p className="mt-1 text-xs text-muted">{card.description}</p>
            </div>
            <ApprovalStatusPill
              tone={card.statusTone}
              label={card.statusLabel}
            />
          </div>

          {card.metaRows ? (
            <dl className="mt-4 space-y-3 rounded-xl bg-surface px-4 py-3">
              {card.metaRows.map((row) => (
                <div key={row.label}>
                  <dt className="text-xs text-muted">{row.label}</dt>
                  <dd className="mt-0.5 break-all text-sm text-foreground">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="mt-4 rounded-xl bg-surface px-4 py-3">
              <p className="text-xs text-muted">
                {t("approvals.currentState")}
              </p>
              <p className="mt-1 break-all text-sm text-foreground">
                {card.meta}
              </p>
            </div>
          )}

          {card.actions.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {card.actions.map((action) => (
                <ApprovalActionButton
                  key={action.label}
                  label={action.label}
                  onClick={action.onClick}
                  disabled={action.disabled}
                  variant={action.variant}
                />
              ))}
            </div>
          ) : null}

          {card.notice ? (
            <p className="mt-3 text-sm text-primary">{card.notice}</p>
          ) : null}

          {card.error ? (
            <p className="mt-3 text-sm text-negative">{card.error}</p>
          ) : null}
        </div>
      ))}

      {pendingConfirmation === "reauthorize" ? (
        <ConfirmationSheet
          title={t("approvals.reauthorizeWarningTitle")}
          body={t("approvals.reauthorizeWarningBody")}
          confirmLabel={t("approvals.confirm")}
          cancelLabel={t("approvals.cancel")}
          isPending={approveAgent.isPending}
          onCancel={() => setPendingConfirmation(null)}
          onConfirm={() => {
            setPendingConfirmation(null);
            approveAgent.mutate();
          }}
        />
      ) : null}

      {pendingConfirmation === "revoke" ? (
        <ConfirmationSheet
          title={t("approvals.revokeWarningTitle")}
          body={t("approvals.revokeWarningBody")}
          confirmLabel={t("approvals.confirm")}
          cancelLabel={t("approvals.cancel")}
          isPending={revokeAgent.isPending}
          onCancel={() => setPendingConfirmation(null)}
          onConfirm={() => {
            setPendingConfirmation(null);
            revokeAgent.mutate();
          }}
        />
      ) : null}
    </div>
  );
}
