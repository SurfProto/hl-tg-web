// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

const { reportClientErrorMock } = vi.hoisted(() => ({
  reportClientErrorMock: vi.fn(),
}));

vi.mock("../lib/error-reporting", () => ({
  reportClientError: reportClientErrorMock,
  toReportableError: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
    stack: null,
  }),
}));

function Boom(): React.ReactElement {
  throw new Error("kaboom");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  /**
   * The fallback is useless under the splash.
   *
   * #startup-shell is opaque and z-index 9999, and the only thing that removes
   * it on the normal path lives inside the tree this boundary replaces — so a
   * crash during startup used to render the reload button underneath it. That
   * is the "frozen spinner, nothing to trace" symptom.
   */
  it("uncovers the startup shell when it catches", async () => {
    const shell = document.createElement("div");
    shell.id = "startup-shell";
    document.body.appendChild(shell);

    // React logs the caught error to console.error; silence it so the run is
    // readable, and assert on the boundary's own behaviour instead.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await act(async () => {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
    });

    // teardownStartupShell hides on the next animation frame and removes the
    // element 180ms later. Polled rather than slept through: a fixed wait puts
    // roughly 100ms of slack between this and a loaded CI box, and would fail
    // for timing rather than for behaviour. The wait sits outside act(), which
    // does not drain jsdom's rAF queue.
    await waitFor(() => {
      const shell = document.getElementById("startup-shell");
      expect(shell === null || shell.dataset.hidden === "true").toBe(true);
    });

    consoleError.mockRestore();
  });

  it("renders the reload affordance and reports the crash", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await act(async () => {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
    });

    expect(
      screen.getByRole("button", { name: /reload/i }),
    ).toBeVisible();
    expect(reportClientErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "error-boundary", message: "kaboom" }),
    );

    consoleError.mockRestore();
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>All good</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText("All good")).toBeVisible();
    expect(reportClientErrorMock).not.toHaveBeenCalled();
  });
});
