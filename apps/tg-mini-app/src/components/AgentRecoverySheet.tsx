import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  useAgentApprovalStatus,
  useAgentRecoveryIncident,
  useApproveAgentTrading,
  type AgentRecoveryIncident,
} from "@repo/hyperliquid-sdk";
import type { AgentAuthorizationReason } from "@repo/types";
import { reportExchangeActionFailure } from "../lib/error-reporting";

/**
 * What a user sees when the exchange refuses a trade for want of a valid
 * trading authorization.
 *
 * Mounted once, above the routes, because the refusal can come from any of
 * eleven actions across four screens and the answer is the same every time.
 * The one thing it must never do is retry: the action did not execute, the
 * user has been told so, and re-running a trade on their behalf after an error
 * they did not expect is not a decision this sheet gets to make.
 */

const NETWORK: "mainnet" | "testnet" =
  import.meta.env.VITE_HYPERLIQUID_TESTNET === "true" ? "testnet" : "mainnet";

function explanationKey(reason: AgentAuthorizationReason | undefined): string {
  switch (reason) {
    case "expired":
      return "agentRecovery.reasonExpired";
    case "revoked-or-replaced":
      return "agentRecovery.reasonReplaced";
    case "missing-local-key":
      return "agentRecovery.reasonMissing";
    case "remote-only":
      return "agentRecovery.reasonRemoteOnly";
    case "awaiting-propagation":
      return "agentRecovery.reasonPropagation";
    case "verification-unavailable":
      return "agentRecovery.reasonUnverified";
    case "active":
      return "agentRecovery.reasonActive";
    default:
      return "agentRecovery.reasonUnknown";
  }
}

export function AgentRecoverySheet() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { incident, dismiss } = useAgentRecoveryIncident();
  const agentApproval = useAgentApprovalStatus();
  const approveAgent = useApproveAgentTrading();
  const [showDetails, setShowDetails] = useState(false);

  /**
   * Why the authorization failed, in the terms the app believed just before it
   * did. Captured once and then left alone: the approval query is invalidated
   * moments later, and an explanation that rewrote itself while the user was
   * reading it would be worse than one that is slightly behind.
   */
  const [frozenReason, setFrozenReason] = useState<
    AgentAuthorizationReason | undefined
  >(undefined);
  const [reported, setReported] = useState<AgentRecoveryIncident | null>(null);

  useEffect(() => {
    if (!incident) {
      setFrozenReason(undefined);
      setShowDetails(false);
      return;
    }
    setFrozenReason((current) => current ?? agentApproval.data?.reason);
    // agentApproval is deliberately absent from the dependencies: this has to
    // capture the state as it was when the incident landed, not follow it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident]);

  useEffect(() => {
    if (!incident || reported === incident) return;
    setReported(incident);
    reportExchangeActionFailure({
      code: "AGENT_AUTHORIZATION_REJECTED",
      action: incident.action,
      exchangeMessage: incident.exchangeMessage,
      agentAddress: incident.agentAddress,
      network: NETWORK,
      buildId: __BUILD_ID__,
    });
  }, [incident, reported]);

  const actionLabel = useMemo(() => {
    if (!incident) return "";
    // An action with no label of its own still has to read as something, so
    // the fallback is a generic phrase rather than the internal name.
    const key = `agentRecovery.action.${incident.action}`;
    const translated = t(key);
    return translated === key ? t("agentRecovery.action.generic") : translated;
  }, [incident, t]);

  if (!incident) return null;

  const isReauthorizing = approveAgent.isPending;

  const handleReauthorize = async () => {
    try {
      await approveAgent.mutateAsync();
      // No retry of the original action, on purpose. The user asked to restore
      // authorization, not to place the trade again.
      dismiss();
    } catch {
      // The mutation holds its own error, and the sheet stays open to show it.
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <button
        type="button"
        aria-label={t("agentRecovery.dismiss")}
        className="absolute inset-0 bg-black/40"
        onClick={dismiss}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-recovery-title"
        className="relative mt-auto max-h-[85vh] overflow-y-auto rounded-t-[24px] bg-white px-4 pt-4 pb-8 animate-slide-up"
      >
        <div className="mb-5 flex justify-center">
          <div className="h-1 w-10 rounded-full bg-separator" />
        </div>

        <h2
          id="agent-recovery-title"
          className="mb-2 text-center text-lg font-bold text-foreground"
        >
          {t("agentRecovery.title")}
        </h2>

        <p
          className={`mb-3 text-center text-sm leading-relaxed ${
            incident.outcome === "partially-executed"
              ? "text-negative"
              : "text-muted"
          }`}
        >
          {t(
            incident.outcome === "partially-executed"
              ? incident.action === "upsertPositionProtection"
                ? "agentRecovery.partialProtection"
                : "agentRecovery.partialAction"
              : "agentRecovery.didNotExecute",
            { action: actionLabel },
          )}
        </p>

        <p className="mb-5 text-center text-sm leading-relaxed text-muted">
          {t(explanationKey(frozenReason))}
        </p>

        <button
          type="button"
          onClick={() => setShowDetails((open) => !open)}
          aria-expanded={showDetails}
          className="mb-3 w-full text-center text-xs font-semibold text-muted underline"
        >
          {showDetails
            ? t("agentRecovery.hideDetails")
            : t("agentRecovery.showDetails")}
        </button>

        {showDetails ? (
          <dl className="mb-5 space-y-2 rounded-xl bg-surface px-4 py-3 text-xs">
            <div>
              <dt className="text-muted">{t("agentRecovery.detailAction")}</dt>
              <dd className="editorial-mono break-all text-foreground">
                {incident.action}
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t("agentRecovery.detailAgent")}</dt>
              <dd className="editorial-mono break-all text-foreground">
                {incident.agentAddress ?? t("agentRecovery.detailNone")}
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t("agentRecovery.detailTime")}</dt>
              <dd className="text-foreground">
                {new Date(incident.occurredAt).toLocaleString(i18n.language)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">
                {t("agentRecovery.detailResponse")}
              </dt>
              <dd className="editorial-mono break-all text-foreground">
                {incident.exchangeMessage}
              </dd>
            </div>
          </dl>
        ) : null}

        {approveAgent.isError && approveAgent.error instanceof Error ? (
          <p className="mb-3 text-center text-sm text-negative">
            {approveAgent.error.message}
          </p>
        ) : null}

        <div className="space-y-2">
          <button
            type="button"
            onClick={handleReauthorize}
            disabled={isReauthorizing}
            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors active:bg-primary-dark disabled:opacity-50"
          >
            {isReauthorizing
              ? t("agentRecovery.reauthorizing")
              : t("agentRecovery.reauthorize")}
          </button>

          <button
            type="button"
            onClick={() => {
              dismiss();
              navigate("/account/settings/approvals");
            }}
            className="w-full rounded-xl border border-separator bg-white px-4 py-3 text-sm font-semibold text-foreground transition-colors active:bg-surface"
          >
            {t("agentRecovery.manageApprovals")}
          </button>

          <button
            type="button"
            onClick={dismiss}
            disabled={isReauthorizing}
            className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-muted disabled:opacity-50"
          >
            {t("agentRecovery.notNow")}
          </button>
        </div>
      </div>
    </div>
  );
}
