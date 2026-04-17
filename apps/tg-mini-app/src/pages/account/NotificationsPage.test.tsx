import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NotificationsPage } from "./NotificationsPage";

const mockGetAccessToken = vi.fn();
const mockFetchProfile = vi.fn();

vi.mock("@privy-io/react-auth", () => ({
  useToken: () => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../lib/profile", () => ({
  fetchProfile: (...args: unknown[]) => mockFetchProfile(...args),
  updateNotificationPreferences: vi.fn(),
}));

describe("NotificationsPage", () => {
  beforeEach(() => {
    mockGetAccessToken.mockResolvedValue("access-token");
    mockFetchProfile.mockResolvedValue({
      profile: {
        id: "user-1",
        telegramId: "123",
        walletAddress: "0xabc",
        privyUserId: "did:privy:user:123",
        username: "alice",
        email: "alice@example.com",
        language: "en",
      },
      notificationPreferences: {
        liquidationAlerts: true,
        orderFills: true,
        usdcDeposits: true,
      },
      telegramDeliveryStatus: "blocked",
    });
  });

  it("shows blocked delivery status when the Telegram channel is blocked", async () => {
    render(<NotificationsPage />);

    await waitFor(() => {
      expect(
        screen.getByText("notifications.deliveryBlockedTitle"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("notifications.deliveryBlockedBody"),
    ).toBeInTheDocument();
  });
});
