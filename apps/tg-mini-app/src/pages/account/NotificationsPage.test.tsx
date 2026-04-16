import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NotificationsPage } from "./NotificationsPage";

const mockUsePrivy = vi.fn();
const mockGetCurrentUserRecord = vi.fn();
const mockFrom = vi.fn();

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => mockUsePrivy(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../lib/supabase", () => ({
  getCurrentUserRecord: (...args: unknown[]) => mockGetCurrentUserRecord(...args),
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

function createQueryResult(data: unknown) {
  return {
    eq: () => ({
      eq: () => ({
        maybeSingle: vi.fn().mockResolvedValue({ data }),
      }),
      maybeSingle: vi.fn().mockResolvedValue({ data }),
    }),
  };
}

describe("NotificationsPage", () => {
  beforeEach(() => {
    mockUsePrivy.mockReturnValue({
      user: { wallet: { address: "0xabc" } },
    });
    mockGetCurrentUserRecord.mockResolvedValue({
      id: "user-1",
      telegram_id: "123",
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "notification_preferences") {
        return {
          select: () =>
            createQueryResult({
              liquidation_alerts: true,
              order_fills: true,
              usdc_deposits: true,
            }),
          upsert: vi.fn().mockResolvedValue({}),
        };
      }

      if (table === "notification_channels") {
        return {
          select: () =>
            createQueryResult({
              status: "blocked",
            }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
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
