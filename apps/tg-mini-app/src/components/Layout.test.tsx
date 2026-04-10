import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
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

describe("Layout", () => {
  it("uses translated nav labels and safe-area layout classes when the bottom nav is visible", () => {
    mockUseHaptics.mockReturnValue({ light: vi.fn() });

    const { container } = renderLayout("/");

    expect(screen.getByText("tr:nav.home")).toBeInTheDocument();
    expect(screen.getByText("tr:nav.positions")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("tg-root-height");
    expect(container.querySelector("main")).toHaveClass("page-above-bottom-nav");
    expect(container.querySelector("nav")).toHaveClass("bottom-nav-safe");
  });

  it("hides the nav on sub-routes that should use the Telegram back button", () => {
    mockUseHaptics.mockReturnValue({ light: vi.fn() });

    const { container } = renderLayout("/trade/BTC");

    expect(container.querySelector("nav")).not.toBeInTheDocument();
    expect(container.querySelector("main")).not.toHaveClass("page-above-bottom-nav");
  });
});
