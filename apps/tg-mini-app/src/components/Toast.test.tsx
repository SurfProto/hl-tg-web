import { render, screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { ToastProvider, useToast } from "./Toast";

function TriggerToast() {
  const toast = useToast();

  return (
    <button type="button" onClick={() => toast.success("saved")}>
      trigger
    </button>
  );
}

describe("ToastProvider", () => {
  it("positions toast stacks above the bottom nav safe area", () => {
    const { container } = render(
      <ToastProvider>
        <TriggerToast />
      </ToastProvider>,
    );

    act(() => {
      screen.getByRole("button", { name: "trigger" }).click();
    });

    expect(screen.getByText("saved")).toBeInTheDocument();
    expect(container.querySelector('[aria-live="polite"]')).toHaveClass(
      "toast-above-bottom-nav",
    );
  });
});
