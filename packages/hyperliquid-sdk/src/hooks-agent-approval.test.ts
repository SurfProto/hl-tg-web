// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateAgentKey,
  getAgentAddress,
  storeAgentApprovedAt,
  storeAgentExpiry,
  storeAgentKey,
} from "./agent";
import { HyperliquidClient } from "./client";
import {
  __resetAgentRecoveryForTests,
  reportAgentRecoveryIncident,
} from "./agent-recovery";
import { AgentAuthorizationError } from "./exchange-response";
import {
  __resetHyperliquidClientRegistryForTests,
  useAgentApprovalStatus,
  useAgentRecoveryIncident,
  useHyperliquid,
} from "./hooks";

const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
let currentWalletAddress = WALLET_ADDRESS;
let currentWallets: Array<{
  address: string;
  walletClientType: string;
  getEthereumProvider: () => Promise<unknown>;
}> = [];

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    user: { id: "privy-user", wallet: { address: currentWalletAddress } },
  }),
  useWallets: () => ({ wallets: currentWallets }),
}));

afterEach(() => {
  localStorage.clear();
  currentWalletAddress = WALLET_ADDRESS;
  currentWallets = [];
  __resetHyperliquidClientRegistryForTests();
  __resetAgentRecoveryForTests();
  vi.restoreAllMocks();
});

describe("useAgentApprovalStatus", () => {
  it("shares one account client across mounted hooks", async () => {
    let queriedBy: HyperliquidClient | null = null;
    vi.spyOn(HyperliquidClient.prototype, "getExtraAgents").mockImplementation(
      async function (this: HyperliquidClient) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- capturing which instance served the query is the point of this test
        queriedBy = this;
        return [];
      },
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(
      () => ({
        first: useHyperliquid(),
        second: useHyperliquid(),
        approval: useAgentApprovalStatus(),
      }),
      { wrapper },
    );

    await waitFor(() => expect(queriedBy).not.toBeNull());
    expect(result.current.first.client).toBe(result.current.second.client);
    expect(queriedBy).toBe(result.current.first.client);

    const key = generateAgentKey();
    result.current.first.client!.setAgentKey(key);
    expect(result.current.second.client!.agentAddress()).toBe(
      getAgentAddress(key),
    );
    result.current.second.client!.clearAgentKey();
    expect(result.current.first.client!.hasAgentKey()).toBe(false);
  });

  it("drops the previous account's signer from memory on an account switch", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result, rerender } = renderHook(() => useHyperliquid(), {
      wrapper,
    });
    const previousClient = result.current.client!;
    previousClient.setAgentKey(generateAgentKey());

    currentWalletAddress = "0x2222222222222222222222222222222222222222";
    rerender();

    expect(result.current.client).not.toBe(previousClient);
    expect(previousClient.hasAgentKey()).toBe(false);
  });

  it("never attaches a stale account provider while the next wallet resolves", async () => {
    let resolveA!: (provider: unknown) => void;
    let resolveB!: (provider: unknown) => void;
    const providerA = { id: "provider-a" };
    const providerB = { id: "provider-b" };
    const providerAPromise = new Promise<unknown>((resolve) => {
      resolveA = resolve;
    });
    const providerBPromise = new Promise<unknown>((resolve) => {
      resolveB = resolve;
    });
    currentWallets = [
      {
        address: WALLET_ADDRESS,
        walletClientType: "privy",
        getEthereumProvider: () => providerAPromise,
      },
    ];
    const queryClient = new QueryClient();
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result, rerender } = renderHook(() => useHyperliquid(), {
      wrapper,
    });

    currentWalletAddress = "0x2222222222222222222222222222222222222222";
    // Privy's wallet list can lag the user identity for a render. The A wallet
    // must not be treated as B merely because it is still the only item.
    rerender();
    const accountBClient = result.current.client!;
    expect((accountBClient as any).config.customSigner).toBeUndefined();

    currentWallets = [
      {
        address: currentWalletAddress,
        walletClientType: "privy",
        getEthereumProvider: () => providerBPromise,
      },
    ];
    rerender();
    await act(async () => resolveB(providerB));
    await waitFor(() =>
      expect((accountBClient as any).config.customSigner).toBe(providerB),
    );

    // A's older promise resolving late cannot overwrite B's signer.
    await act(async () => resolveA(providerA));
    expect((accountBClient as any).config.customSigner).toBe(providerB);
  });

  it("hides a retained incident synchronously when the account changes", () => {
    reportAgentRecoveryIncident(
      new AgentAuthorizationError({
        action: "closePosition",
        accountAddress: WALLET_ADDRESS,
        agentAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        exchangeMessage: "User or API Wallet 0xaaaa does not exist.",
        message: "Trading authorization is no longer valid.",
      }),
    );
    const queryClient = new QueryClient();
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result, rerender } = renderHook(() => useAgentRecoveryIncident(), {
      wrapper,
    });
    expect(result.current.incident?.accountAddress).toBe(WALLET_ADDRESS);

    currentWalletAddress = "0x2222222222222222222222222222222222222222";
    rerender();

    expect(result.current.incident).toBeNull();
  });

  it("checks the exchange on mount even when local authorization exists", async () => {
    const privateKey = generateAgentKey();
    const agentAddress = getAgentAddress(privateKey);
    const now = Date.now();
    storeAgentKey(WALLET_ADDRESS, privateKey);
    storeAgentApprovedAt(WALLET_ADDRESS, now - 1_000);
    storeAgentExpiry(WALLET_ADDRESS, now + 60_000);

    const getExtraAgents = vi
      .spyOn(HyperliquidClient.prototype, "getExtraAgents")
      .mockResolvedValue([
        {
          address: agentAddress,
          name: "tsnm-trade-agent",
          validUntil: now + 60_000,
        },
      ] as Awaited<ReturnType<HyperliquidClient["getExtraAgents"]>>);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useAgentApprovalStatus(), { wrapper });

    await waitFor(() => expect(getExtraAgents).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(result.current.data?.remoteConfirmed).toBe(true),
    );
  });
});
