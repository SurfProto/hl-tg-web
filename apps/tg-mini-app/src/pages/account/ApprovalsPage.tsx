import { useTranslation } from "react-i18next";
import {
  getBuilderAddress,
  isBuilderConfigured,
  useAgentApprovalStatus,
  useApproveAgentTrading,
  useApproveBuilderFee,
  useBuilderFeeApproval,
  useRevokeBuilderFee,
  useSetUnifiedAccount,
  useUnifiedAccountApproval,
} from "@repo/hyperliquid-sdk";

interface ApprovalCardAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}

interface ApprovalCard {
  key: string;
  title: string;
  description: string;
  meta: string;
  statusLabel: string;
  statusTone: "positive" | "warning" | "muted";
  actions: ApprovalCardAction[];
  error: string | null;
}

function ApprovalStatusPill({
  tone,
  label,
}: {
  tone: "positive" | "warning" | "muted";
  label: string;
}) {
  const className =
    tone === "positive"
      ? "bg-green-50 text-positive"
      : tone === "warning"
        ? "bg-yellow-50 text-amber-600"
        : "bg-surface text-muted";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${className}`}>
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
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
        variant === "primary"
          ? "bg-primary text-white active:bg-primary-dark"
          : "border border-separator bg-white text-foreground active:bg-surface"
      }`}
    >
      {label}
    </button>
  );
}

export function ApprovalsPage() {
  const { t } = useTranslation();
  const builderConfigured = isBuilderConfigured();
  const builderAddress = getBuilderAddress();
  const agentApproval = useAgentApprovalStatus();
  const approveAgent = useApproveAgentTrading();
  const builderApproval = useBuilderFeeApproval();
  const approveBuilder = useApproveBuilderFee();
  const revokeBuilder = useRevokeBuilderFee();
  const unifiedApproval = useUnifiedAccountApproval();
  const setUnifiedAccount = useSetUnifiedAccount();

  const cards: ApprovalCard[] = [
    {
      key: "gasless",
      title: t("approvals.gaslessTitle"),
      description: t("approvals.gaslessDescription"),
      meta: agentApproval.data?.address ?? t("approvals.notAvailable"),
      statusLabel: agentApproval.isLoading
        ? t("account.checking")
        : agentApproval.data?.approved
          ? t("account.approved")
          : agentApproval.data?.isExpired
            ? t("approvals.expired")
            : t("account.notApproved"),
      statusTone: agentApproval.data?.approved
        ? "positive"
        : agentApproval.data?.isExpired
          ? "warning"
          : "muted",
      actions: [
        {
          label:
            agentApproval.data?.approved && !agentApproval.data?.isExpired
              ? t("approvals.approved")
              : agentApproval.data?.isExpired
                ? t("approvals.reapprove")
                : t("approvals.approve"),
          onClick: () => approveAgent.mutate(),
          disabled:
            approveAgent.isPending ||
            (agentApproval.data?.approved && !agentApproval.data?.isExpired),
          variant: "primary" as const,
        },
      ],
      error:
        approveAgent.isError && approveAgent.error instanceof Error
          ? approveAgent.error.message
          : null,
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
              disabled: approveBuilder.isPending || (builderApproval.data ?? 0) > 0,
              variant: "primary" as const,
            },
            {
              label: t("approvals.revoke"),
              onClick: () => revokeBuilder.mutate(),
              disabled: revokeBuilder.isPending || (builderApproval.data ?? 0) <= 0,
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
      meta: unifiedApproval.data?.enabled
        ? t("approvals.unifiedEnabled")
        : t("approvals.unifiedDisabled"),
      statusLabel: unifiedApproval.isLoading
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
            setUnifiedAccount.isPending || Boolean(unifiedApproval.data?.enabled),
          variant: "primary" as const,
        },
        {
          label: t("approvals.disable"),
          onClick: () => setUnifiedAccount.mutate(false),
          disabled: setUnifiedAccount.isPending || !unifiedApproval.data?.enabled,
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
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          {t("approvals.title")}
        </h1>
        <p className="mt-1 text-sm text-muted">{t("approvals.subtitle")}</p>
      </div>

      {cards.map((card) => (
        <div
          key={card.key}
          className="rounded-2xl border border-separator bg-white p-4 shadow-sm"
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

          <div className="mt-4 rounded-2xl bg-surface px-4 py-3">
            <p className="text-xs text-muted">{t("approvals.currentState")}</p>
            <p className="mt-1 break-all text-sm text-foreground">{card.meta}</p>
          </div>

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

          {card.error ? (
            <p className="mt-3 text-sm text-negative">{card.error}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
