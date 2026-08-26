// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApprovalsPage } from "./ApprovalsPage";

const approveAgentMutate = vi.fn();
const revokeAgentMutate = vi.fn();

type MutationStub = Record<string, unknown>;

let agentApproval: Record<string, unknown>;
let approveAgentState: MutationStub;
let revokeAgentState: MutationStub;
let unifiedApproval: Record<string, unknown>;

vi.mock("react-i18next", async () => {
  const actual =
    await vi.importActual<typeof import("react-i18next")>("react-i18next");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => `tr:${key}`,
      i18n: { language: "en" },
    }),
  };
});

vi.mock("@repo/hyperliquid-sdk", () => ({
  getBuilderAddress: () => "0xbuilder",
  isBuilderConfigured: () => false,
  isUserRejectedSignature: (error: unknown) =>
    error instanceof Error && error.message === "User rejected the request",
  useAgentApprovalStatus: () => agentApproval,
  useApproveAgentTrading: () => ({
    ...approveAgentState,
    mutate: approveAgentMutate,
  }),
  useRevokeAgentTrading: () => ({
    ...revokeAgentState,
    mutate: revokeAgentMutate,
  }),
  useApproveBuilderFee: () => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: vi.fn(),
  }),
  useBuilderFeeApproval: () => ({ isLoading: false, data: 0 }),
  useRevokeBuilderFee: () => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: vi.fn(),
  }),
  useSetUnifiedAccount: () => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: vi.fn(),
  }),
  useUnifiedAccountApproval: () => unifiedApproval,
}));

const ACTIVE_AGENT = {
  isLoading: false,
  data: {
    address: "0x1234567890abcdef1234567890abcdef12345678",
    approved: true,
    hasLocalKey: true,
    isExpired: false,
    validUntil: 1_760_000_000_000,
    state: "approved",
    reason: "active",
    name: "tsnm-trade-agent",
    approvedAt: 1_759_000_000_000,
    remoteConfirmed: true,
    lastVerifiedAt: 1_759_900_000_000,
    duplicateNamedAgents: 0,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  agentApproval = ACTIVE_AGENT;
  approveAgentState = { isPending: false, isError: false, error: null };
  revokeAgentState = {
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
  };
  unifiedApproval = {
    isLoading: false,
    isError: false,
    error: null,
    data: { enabled: true },
  };
});

afterEach(cleanup);

describe("ApprovalsPage, trading authorization card", () => {
  it("shows the agent address, expiry, verification and last check", () => {
    render(<ApprovalsPage />);

    expect(
      screen.getByText("0x1234567890abcdef1234567890abcdef12345678"),
    ).toBeInTheDocument();
    expect(screen.getByText("tr:approvals.expiryLabel")).toBeInTheDocument();
    expect(
      screen.getByText("tr:approvals.verificationConfirmed"),
    ).toBeInTheDocument();
    expect(screen.getByText("tr:approvals.lastCheckLabel")).toBeInTheDocument();
  });

  it("mentions extra authorizations without treating them as a failure", () => {
    // A duplicate consumes one of the exchange's few named-agent slots, which
    // is worth saying. It does not stop this agent working, so the card must
    // not read as an error and the buttons must stay as they were.
    agentApproval = {
      ...ACTIVE_AGENT,
      data: { ...ACTIVE_AGENT.data, duplicateNamedAgents: 2 },
    };
    render(<ApprovalsPage />);

    expect(screen.getByText("tr:approvals.duplicateAgents")).toBeInTheDocument();
    expect(screen.getAllByText("tr:account.approved").length).toBeGreaterThan(0);
    expect(screen.getByText("tr:approvals.reauthorize")).toBeEnabled();
  });

  it("stays silent when there are no extra authorizations", () => {
    render(<ApprovalsPage />);

    expect(
      screen.queryByText("tr:approvals.duplicateAgents"),
    ).not.toBeInTheDocument();
  });

  it("says an approval is waiting to register rather than calling it verified", () => {
    agentApproval = {
      ...ACTIVE_AGENT,
      data: {
        ...ACTIVE_AGENT.data,
        remoteConfirmed: false,
        reason: "awaiting-propagation",
      },
    };
    render(<ApprovalsPage />);

    expect(
      screen.getByText("tr:approvals.verificationPending"),
    ).toBeInTheDocument();
  });

  it("says so when the check could not be made", () => {
    agentApproval = {
      ...ACTIVE_AGENT,
      data: {
        ...ACTIVE_AGENT.data,
        remoteConfirmed: false,
        reason: "verification-unavailable",
      },
    };
    render(<ApprovalsPage />);

    expect(
      screen.getByText("tr:approvals.verificationUnavailable"),
    ).toBeInTheDocument();
  });

  it("reports never having checked rather than inventing a time", () => {
    agentApproval = {
      ...ACTIVE_AGENT,
      data: { ...ACTIVE_AGENT.data, lastVerifiedAt: null, validUntil: null },
    };
    render(<ApprovalsPage />);

    expect(screen.getByText("tr:approvals.neverChecked")).toBeInTheDocument();
    expect(screen.getByText("tr:approvals.noExpiry")).toBeInTheDocument();
  });

  it("offers reauthorize and revoke while the approval is active", () => {
    // Both stay available on purpose: an authorization can be dead at the
    // exchange while it still reads as active here.
    render(<ApprovalsPage />);

    expect(screen.getByText("tr:approvals.reauthorize")).toBeEnabled();
    expect(screen.getByText("tr:approvals.revoke")).toBeEnabled();
  });

  it("offers only approval when there is no local key to replace", () => {
    agentApproval = {
      isLoading: false,
      data: {
        ...ACTIVE_AGENT.data,
        address: null,
        approved: false,
        hasLocalKey: false,
        reason: "missing-local-key",
        remoteConfirmed: false,
      },
    };
    render(<ApprovalsPage />);

    expect(screen.getByText("tr:approvals.approve")).toBeInTheDocument();
    expect(screen.queryByText("tr:approvals.revoke")).not.toBeInTheDocument();
    expect(screen.getByText("tr:approvals.notAvailable")).toBeInTheDocument();
  });

  it("allows a remotely confirmed agent to be revoked after local storage is lost", () => {
    agentApproval = {
      isLoading: false,
      data: {
        ...ACTIVE_AGENT.data,
        approved: false,
        hasLocalKey: false,
        reason: "remote-only",
        remoteConfirmed: true,
      },
    };
    render(<ApprovalsPage />);

    expect(
      screen.getByText("tr:approvals.authorizedElsewhere"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("tr:approvals.verificationRemote"),
    ).toBeInTheDocument();
    expect(screen.getByText("tr:approvals.reauthorize")).toBeEnabled();
    expect(screen.getByText("tr:approvals.revoke")).toBeEnabled();
  });

  it("warns that reauthorizing replaces the previous authorization", async () => {
    render(<ApprovalsPage />);

    await userEvent.click(screen.getByText("tr:approvals.reauthorize"));

    expect(
      screen.getByText("tr:approvals.reauthorizeWarningBody"),
    ).toBeInTheDocument();
    expect(approveAgentMutate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText("tr:approvals.confirm"));
    expect(approveAgentMutate).toHaveBeenCalledTimes(1);
  });

  it("warns that revoking leaves positions and orders alone", async () => {
    render(<ApprovalsPage />);

    await userEvent.click(screen.getByText("tr:approvals.revoke"));

    expect(
      screen.getByText("tr:approvals.revokeWarningBody"),
    ).toBeInTheDocument();
    expect(revokeAgentMutate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText("tr:approvals.confirm"));
    expect(revokeAgentMutate).toHaveBeenCalledTimes(1);
  });

  it("changes nothing when the confirmation is dismissed", async () => {
    render(<ApprovalsPage />);

    await userEvent.click(screen.getByText("tr:approvals.revoke"));
    await userEvent.click(screen.getByText("tr:approvals.cancel"));

    expect(revokeAgentMutate).not.toHaveBeenCalled();
    expect(
      screen.queryByText("tr:approvals.revokeWarningBody"),
    ).not.toBeInTheDocument();
  });

  it("says plainly when a revocation could not be confirmed", () => {
    revokeAgentState = {
      ...revokeAgentState,
      isSuccess: true,
      data: { remoteConfirmed: false },
    };
    render(<ApprovalsPage />);

    expect(
      screen.getByText("tr:approvals.revokeUnconfirmed"),
    ).toBeInTheDocument();
  });

  it("stays quiet about a revocation that was confirmed", () => {
    revokeAgentState = {
      ...revokeAgentState,
      isSuccess: true,
      data: { remoteConfirmed: true },
    };
    render(<ApprovalsPage />);

    expect(
      screen.queryByText("tr:approvals.revokeUnconfirmed"),
    ).not.toBeInTheDocument();
  });

  it("reports a declined signature as nothing having changed", () => {
    // A wallet cancellation leaves the authorization exactly as it was, so it
    // must not read like a failure or like a revocation.
    revokeAgentState = {
      ...revokeAgentState,
      isError: true,
      error: new Error("User rejected the request"),
    };
    render(<ApprovalsPage />);

    expect(
      screen.getByText("tr:approvals.revokeCancelled"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("tr:approvals.revokeUnconfirmed"),
    ).not.toBeInTheDocument();
  });

  it("treats any other revocation failure as unconfirmed and shows why", () => {
    revokeAgentState = {
      ...revokeAgentState,
      isError: true,
      error: new Error("network unreachable"),
    };
    render(<ApprovalsPage />);

    expect(
      screen.getByText("tr:approvals.revokeUnconfirmed"),
    ).toBeInTheDocument();
    expect(screen.getByText("network unreachable")).toBeInTheDocument();
  });

  it("disables both buttons while one of them is running", () => {
    revokeAgentState = { ...revokeAgentState, isPending: true };
    render(<ApprovalsPage />);

    expect(screen.getByText("tr:approvals.reauthorize")).toBeDisabled();
    expect(screen.getByText("tr:approvals.revoke")).toBeDisabled();
  });

  it("shows that unified account state is unavailable instead of checking forever", () => {
    unifiedApproval = {
      isLoading: true,
      isError: false,
      failureCount: 1,
      error: new Error("Info request failed with status 429"),
      data: undefined,
    };

    render(<ApprovalsPage />);

    expect(screen.getByText("tr:approvals.unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("tr:approvals.unifiedUnavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByText("tr:account.checking")).not.toBeInTheDocument();
  });
});
