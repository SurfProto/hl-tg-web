import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TelegramAuthGate } from "./App";
import { installTelegramWebAppMock } from "./test/telegramMock";

const { mockUsePrivy, mockGetAccessToken, bootstrapProfileMock } = vi.hoisted(
  () => ({
    mockUsePrivy: vi.fn(),
    mockGetAccessToken: vi.fn(),
    bootstrapProfileMock: vi.fn(),
  }),
);
const translate = (key: string) =>
  ({
    "common.retry": "Retry",
    "errors.loginFailed": "Login failed",
  })[key] ?? key;

vi.mock("@privy-io/react-auth", async () => {
  const actual = await vi.importActual<typeof import("@privy-io/react-auth")>(
    "@privy-io/react-auth",
  );

  return {
    ...actual,
    usePrivy: () => mockUsePrivy(),
    useToken: () => ({
      getAccessToken: mockGetAccessToken,
    }),
  };
});

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual<typeof import("react-i18next")>(
    "react-i18next",
  );

  return {
    ...actual,
    useTranslation: () => ({
      t: translate,
    }),
  };
});

vi.mock("./lib/profile", () => ({
  bootstrapProfile: bootstrapProfileMock,
  getTelegramProfile: () => ({
    id: 123,
    username: "alice_tg",
  }),
}));

vi.mock("@repo/hyperliquid-sdk", () => ({
  useMarketData: () => ({
    data: [],
    isError: false,
    isLoading: false,
  }),
  useSetupTrading: () => null,
}));

describe("TelegramAuthGate", () => {
  it("shows retry UI when Telegram login fails", async () => {
    installTelegramWebAppMock();
    const loginWithTelegram = vi
      .fn()
      .mockRejectedValue(new Error("Telegram auth failed"));

    mockUsePrivy.mockReturnValue({
      ready: true,
      authenticated: false,
      user: null,
      loginWithTelegram,
    });

    await act(async () => {
      render(
        <TelegramAuthGate>
          <div>Protected app</div>
        </TelegramAuthGate>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loginWithTelegram).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("bootstraps the server profile after auth settles", async () => {
    installTelegramWebAppMock();
    mockGetAccessToken.mockResolvedValue("access-token");
    mockUsePrivy.mockReturnValue({
      ready: true,
      authenticated: true,
      loginWithTelegram: vi.fn(),
      user: {
        id: "did:privy:user:123",
        wallet: { address: "0xabc" },
        email: { address: "alice@example.com" },
        telegram: { username: "alice_privy" },
      },
    });

    await act(async () => {
      render(
        <TelegramAuthGate>
          <div>Protected app</div>
        </TelegramAuthGate>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bootstrapProfileMock).toHaveBeenCalledWith("access-token", {
      telegramId: "123",
      privyUserId: "did:privy:user:123",
      username: "alice_tg",
      walletAddress: "0xabc",
      email: "alice@example.com",
    });
  });
});
