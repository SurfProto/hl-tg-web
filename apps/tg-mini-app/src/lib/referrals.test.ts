// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildTelegramReferralLink,
  getTelegramStartParam,
  normalizeReferralCode,
  openReferralInvite,
} from "./referrals";

describe("referrals", () => {
  const originalEnv = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;

  beforeEach(() => {
    vi.stubEnv("VITE_TELEGRAM_BOT_USERNAME", "hyperliquid_trading_bot");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    window.Telegram = undefined;
    if (originalEnv) {
      vi.stubEnv("VITE_TELEGRAM_BOT_USERNAME", originalEnv);
    }
  });

  it("normalizes referral code variants", () => {
    expect(normalizeReferralCode(" ref_friend42 ")).toBe("FRIEND42");
    expect(normalizeReferralCode("ref-friend42")).toBe("FRIEND42");
    expect(normalizeReferralCode("friend42")).toBe("FRIEND42");
  });

  it("builds Telegram mini app invite links", () => {
    expect(buildTelegramReferralLink("FRIEND42")).toBe(
      "https://t.me/hyperliquid_trading_bot?startapp=ref_FRIEND42",
    );
  });

  it("reads the Telegram start parameter when present", () => {
    window.Telegram = {
      WebApp: {
        initData: "",
        initDataUnsafe: {
          start_param: "ref_FRIEND42",
        },
        ready: vi.fn(),
        expand: vi.fn(),
        close: vi.fn(),
        openLink: vi.fn(),
        MainButton: { text: "", show: vi.fn(), hide: vi.fn(), onClick: vi.fn() },
        BackButton: {
          isVisible: false,
          show: vi.fn(),
          hide: vi.fn(),
          onClick: vi.fn(),
          offClick: vi.fn(),
        },
        HapticFeedback: {
          impactOccurred: vi.fn(),
          notificationOccurred: vi.fn(),
          selectionChanged: vi.fn(),
        },
        showAlert: vi.fn(),
        showConfirm: vi.fn(),
        themeParams: {},
        colorScheme: "light",
        isExpanded: true,
        viewportHeight: 0,
        viewportStableHeight: 0,
        onEvent: vi.fn(),
        offEvent: vi.fn(),
      },
    };

    expect(getTelegramStartParam()).toBe("ref_FRIEND42");
  });

  it("prefers Telegram openLink for invite launches", async () => {
    const openLink = vi.fn();
    const clipboardWrite = vi.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: clipboardWrite,
      },
    });
    window.Telegram = {
      WebApp: {
        initData: "",
        initDataUnsafe: {},
        ready: vi.fn(),
        expand: vi.fn(),
        close: vi.fn(),
        openLink,
        MainButton: { text: "", show: vi.fn(), hide: vi.fn(), onClick: vi.fn() },
        BackButton: {
          isVisible: false,
          show: vi.fn(),
          hide: vi.fn(),
          onClick: vi.fn(),
          offClick: vi.fn(),
        },
        HapticFeedback: {
          impactOccurred: vi.fn(),
          notificationOccurred: vi.fn(),
          selectionChanged: vi.fn(),
        },
        showAlert: vi.fn(),
        showConfirm: vi.fn(),
        themeParams: {},
        colorScheme: "light",
        isExpanded: true,
        viewportHeight: 0,
        viewportStableHeight: 0,
        onEvent: vi.fn(),
        offEvent: vi.fn(),
      },
    };

    const result = await openReferralInvite("FRIEND42");

    expect(openLink).toHaveBeenCalledWith(
      "https://t.me/hyperliquid_trading_bot?startapp=ref_FRIEND42",
    );
    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(result).toBe("opened");
  });
});
