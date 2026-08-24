// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Layout } from "./Layout";

const mockUseHaptics = vi.fn();

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual<typeof import("react-i18next")>(
    "react-i18next",
  );

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => `tr:${key}`,
    }),
  };
});

vi.mock("../hooks/useHaptics", () => ({
  useHaptics: () => mockUseHaptics(),
}));

function renderLayout(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="*"
          element={
            <Layout>
              <div>Page</div>
            </Layout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function stubTelegram(webApp: unknown) {
  (window as unknown as { Telegram?: unknown }).Telegram = webApp
    ? { WebApp: webApp }
    : undefined;
}

describe("Layout", () => {
  afterEach(() => {
    stubTelegram(undefined);
    cleanup();
  });

  it("uses translated nav labels and safe-area layout classes when the bottom nav is visible", () => {
    mockUseHaptics.mockReturnValue({ light: vi.fn() });

    const { container } = renderLayout("/");

    expect(screen.getByText("tr:nav.markets")).toBeInTheDocument();
    expect(screen.getByText("tr:nav.positions")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("tg-root-height");
    expect(container.querySelector("main")).toHaveClass("page-above-bottom-nav");
    expect(container.querySelector("nav")).toHaveClass("bottom-nav-safe", "p34k-bottom-nav");
  });

  it("hides the nav on sub-routes that should use the Telegram back button", () => {
    mockUseHaptics.mockReturnValue({ light: vi.fn() });

    const { container } = renderLayout("/trade/BTC");

    expect(container.querySelector("nav")).not.toBeInTheDocument();
    expect(container.querySelector("main")).not.toHaveClass("page-above-bottom-nav");
  });

  // These routes hide the bottom nav, so without Telegram's BackButton there
  // was nothing left to navigate with at all.
  it("offers an in-page way back when there is no Telegram BackButton", () => {
    mockUseHaptics.mockReturnValue({ light: vi.fn() });

    renderLayout("/trade/BTC");

    expect(screen.getByRole("button", { name: "tr:common.back" })).toBeInTheDocument();
  });

  it("offers one when the client is too old to support it", () => {
    mockUseHaptics.mockReturnValue({ light: vi.fn() });
    stubTelegram({
      BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
      isVersionAtLeast: () => false,
    });

    renderLayout("/trade/BTC");

    expect(screen.getByRole("button", { name: "tr:common.back" })).toBeInTheDocument();
  });

  it("stays out of the way when Telegram provides one", () => {
    mockUseHaptics.mockReturnValue({ light: vi.fn() });
    const show = vi.fn();
    stubTelegram({
      BackButton: { show, hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
      isVersionAtLeast: () => true,
    });

    renderLayout("/trade/BTC");

    expect(screen.queryByRole("button", { name: "tr:common.back" })).not.toBeInTheDocument();
    expect(show).toHaveBeenCalled();
  });

  it("does not offer one where the bottom nav is already there", () => {
    mockUseHaptics.mockReturnValue({ light: vi.fn() });

    renderLayout("/");

    expect(screen.queryByRole("button", { name: "tr:common.back" })).not.toBeInTheDocument();
  });

  // navigate(-1) on a deep link has nothing behind it and would do nothing.
  it("falls back to markets when there is no history to return to", () => {
    mockUseHaptics.mockReturnValue({ light: vi.fn() });

    renderLayout("/trade/BTC");
    fireEvent.click(screen.getByRole("button", { name: "tr:common.back" }));

    expect(screen.getByText("tr:nav.markets")).toBeInTheDocument();
  });
});
