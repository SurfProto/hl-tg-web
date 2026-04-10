import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TradingSetupSheet } from "./TradingSetupSheet";

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

function createSetupState(overrides?: Partial<Record<string, unknown>>) {
  return {
    isPending: false,
    isSuccess: false,
    error: null,
    mutate: vi.fn(),
    ...overrides,
  } as any;
}

describe("TradingSetupSheet", () => {
  it("renders translated dynamic copy and pending steps from the status prop", () => {
    render(
      <TradingSetupSheet
        isOpen={true}
        onClose={vi.fn()}
        setup={createSetupState()}
        isExpired={true}
        status={{
          pendingSteps: ["agent", "unified"],
        } as any}
      />,
    );

    expect(screen.getByText("tr:tradingSetup.titleReauth")).toBeInTheDocument();
    expect(screen.getByText("tr:tradingSetup.stepReauth")).toBeInTheDocument();
    expect(screen.getByText("tr:tradingSetup.stepUnified")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tr:tradingSetup.reauthButton" }),
    ).toBeInTheDocument();
  });

  it("shows translated success copy after setup completes", () => {
    render(
      <TradingSetupSheet
        isOpen={true}
        onClose={vi.fn()}
        setup={createSetupState({ isSuccess: true })}
      />,
    );

    expect(screen.getByText("tr:tradingSetup.allSet")).toBeInTheDocument();
    expect(
      screen.getByText("tr:tradingSetup.readyToTrade"),
    ).toBeInTheDocument();
  });
});
