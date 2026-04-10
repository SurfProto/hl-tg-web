import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NumPad } from "./NumPad";

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual<typeof import("react-i18next")>(
    "react-i18next",
  );

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, params?: Record<string, string>) =>
        key === "numPad.enterKey" ? `tr:${key}:${params?.key}` : `tr:${key}`,
    }),
  };
});

vi.mock("../hooks/useHaptics", () => ({
  useHaptics: () => ({
    selection: vi.fn(),
  }),
}));

describe("NumPad", () => {
  it("uses translated aria labels for digit and delete keys", () => {
    render(<NumPad value="" onChange={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "tr:numPad.enterKey:1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tr:numPad.delete" }),
    ).toBeInTheDocument();
  });
});
