// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentRecoverySheet } from "./AgentRecoverySheet";

/** The action labels the real locale files define. */
const KNOWN_ACTION_KEYS = new Set([
  "generic",
  "placeOrder",
  "placeSpotOrder",
  "placeTriggerOrder",
  "closePosition",
  "cancelOrder",
  "cancelAllOrders",
  "modifyOrder",
  "upsertPositionProtection",
  "cancelPositionProtection",
  "updateLeverage",
  "updateIsolatedMargin",
]);

const navigate = vi.fn();
const dismiss = vi.fn();
const mutateAsync = vi.fn();
const reportExchangeActionFailure = vi.fn();

let incident: unknown = null;
let approvalData: unknown = { reason: "active" };
let approveState: Record<string, unknown> = {
  isPending: false,
  isError: false,
  error: null,
};

vi.mock("react-i18next", async () => {
  const actual =
    await vi.importActual<typeof import("react-i18next")>("react-i18next");
  return {
    ...actual,
    useTranslation: () => ({
      // Emulates i18next's behaviour for a key it has no translation for: it
      // hands the key back. The action-label fallback depends on exactly that,
      // so a mock that translated everything would hide the case it guards.
      t: (key: string, values?: Record<string, unknown>) => {
        const action = key.match(/^agentRecovery\.action\.(.+)$/)?.[1];
        if (action && !KNOWN_ACTION_KEYS.has(action)) return key;
        return values ? `tr:${key}:${JSON.stringify(values)}` : `tr:${key}`;
      },
      i18n: { language: "en" },
    }),
  };
});

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
}));

vi.mock("@repo/hyperliquid-sdk", () => ({
  useAgentRecoveryIncident: () => ({ incident, dismiss }),
  useAgentApprovalStatus: () => ({ data: approvalData }),
  useApproveAgentTrading: () => ({ ...approveState, mutateAsync }),
}));

vi.mock("../lib/error-reporting", () => ({
  reportExchangeActionFailure: (...args: unknown[]) =>
    reportExchangeActionFailure(...args),
}));

vi.stubGlobal("__BUILD_ID__", "a1b2c3d");

const INCIDENT = {
  action: "closePosition",
  accountAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  agentAddress: "0x1234567890abcdef1234567890abcdef12345678",
  exchangeMessage:
    "User or API Wallet 0x1234567890abcdef1234567890abcdef12345678 does not exist.",
  message: "Trading authorization is no longer valid.",
  outcome: "not-executed",
  occurredAt: 1_760_000_000_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  incident = null;
  approvalData = { reason: "active" };
  approveState = { isPending: false, isError: false, error: null };
});

afterEach(cleanup);

describe("AgentRecoverySheet", () => {
  it("stays out of the way when nothing has failed", () => {
    const { container } = render(<AgentRecoverySheet />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the action and says plainly that it did not execute", () => {
    // The single most important sentence on this sheet: a user who just tried
    // to close a position needs to know the position is still open.
    incident = INCIDENT;
    render(<AgentRecoverySheet />);

    expect(
      screen.getByText(/tr:agentRecovery.didNotExecute/),
    ).toHaveTextContent("tr:agentRecovery.action.closePosition");
  });

  it("warns when existing position protection may already be gone", () => {
    incident = {
      ...INCIDENT,
      action: "upsertPositionProtection",
      outcome: "partially-executed",
    };
    render(<AgentRecoverySheet />);

    expect(
      screen.getByText(/tr:agentRecovery.partialProtection/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/tr:agentRecovery.didNotExecute/),
    ).not.toBeInTheDocument();
  });

  it("explains a rejection that arrived while the approval looked active", () => {
    incident = INCIDENT;
    approvalData = { reason: "active" };
    render(<AgentRecoverySheet />);

    expect(
      screen.getByText("tr:agentRecovery.reasonActive"),
    ).toBeInTheDocument();
  });

  it("explains an expired approval differently from a replaced one", () => {
    incident = INCIDENT;
    approvalData = { reason: "expired" };
    const { unmount } = render(<AgentRecoverySheet />);
    expect(
      screen.getByText("tr:agentRecovery.reasonExpired"),
    ).toBeInTheDocument();
    unmount();

    approvalData = { reason: "revoked-or-replaced" };
    render(<AgentRecoverySheet />);
    expect(
      screen.getByText("tr:agentRecovery.reasonReplaced"),
    ).toBeInTheDocument();
  });

  it("explains a verification that could not be made", () => {
    incident = INCIDENT;
    approvalData = { reason: "verification-unavailable" };
    render(<AgentRecoverySheet />);

    expect(
      screen.getByText("tr:agentRecovery.reasonUnverified"),
    ).toBeInTheDocument();
  });

  it("keeps the raw response and the full agent address behind a toggle", async () => {
    incident = INCIDENT;
    render(<AgentRecoverySheet />);

    expect(
      screen.queryByText(INCIDENT.exchangeMessage),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("tr:agentRecovery.showDetails"));

    expect(screen.getByText(INCIDENT.exchangeMessage)).toBeInTheDocument();
    expect(screen.getByText(INCIDENT.agentAddress)).toBeInTheDocument();
    expect(screen.getByText("closePosition")).toBeInTheDocument();
  });

  it("reports the failure once, redacted, with the build it came from", () => {
    incident = INCIDENT;
    const { rerender } = render(<AgentRecoverySheet />);
    rerender(<AgentRecoverySheet />);

    expect(reportExchangeActionFailure).toHaveBeenCalledTimes(1);
    expect(reportExchangeActionFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "AGENT_AUTHORIZATION_REJECTED",
        action: "closePosition",
        exchangeMessage: INCIDENT.exchangeMessage,
        agentAddress: INCIDENT.agentAddress,
        buildId: "a1b2c3d",
      }),
    );
    // Which network this is depends on the environment the suite runs in.
    // That it is one of the two, and is reported at all, is the point.
    const [reported] = reportExchangeActionFailure.mock.calls[0] as [
      { network: string },
    ];
    expect(["mainnet", "testnet"]).toContain(reported.network);
  });

  it("reauthorizes without replaying the action that failed", async () => {
    // Re-running a trade the user did not ask for again is the one thing this
    // flow must never do.
    incident = INCIDENT;
    mutateAsync.mockResolvedValue(undefined);
    render(<AgentRecoverySheet />);

    await userEvent.click(screen.getByText("tr:agentRecovery.reauthorize"));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith();
  });

  it("stays open when reauthorization fails", async () => {
    incident = INCIDENT;
    mutateAsync.mockRejectedValue(new Error("declined"));
    render(<AgentRecoverySheet />);

    await userEvent.click(screen.getByText("tr:agentRecovery.reauthorize"));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("shows the reason reauthorization failed", () => {
    incident = INCIDENT;
    approveState = {
      isPending: false,
      isError: true,
      error: new Error("Wallet not connected"),
    };
    render(<AgentRecoverySheet />);

    expect(screen.getByText("Wallet not connected")).toBeInTheDocument();
  });

  it("offers to leave it for now without changing anything", async () => {
    incident = INCIDENT;
    render(<AgentRecoverySheet />);

    await userEvent.click(screen.getByText("tr:agentRecovery.notNow"));

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("sends the user to the approvals screen when asked", async () => {
    incident = INCIDENT;
    render(<AgentRecoverySheet />);

    await userEvent.click(screen.getByText("tr:agentRecovery.manageApprovals"));

    expect(navigate).toHaveBeenCalledWith("/account/settings/approvals");
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generic name for an action it has no label for", () => {
    incident = { ...INCIDENT, action: "someFutureAction" };
    render(<AgentRecoverySheet />);

    expect(
      screen.getByText(/tr:agentRecovery.didNotExecute/),
    ).toHaveTextContent("tr:agentRecovery.action.generic");
  });
});
