// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramAuthGate } from "./App";
import { installTelegramWebAppMock } from "./test/telegramMock";

const {
  mockUsePrivy,
  mockLogin,
  mockGetAccessToken,
  bootstrapProfileMock,
  clearStoredAgentKeyMock,
  flags,
} = vi.hoisted(() => ({
  mockUsePrivy: vi.fn(),
  mockLogin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  bootstrapProfileMock: vi.fn(),
  clearStoredAgentKeyMock: vi.fn(),
  // When true the mocked hook hands back a fresh `login` identity on every
  // render, the way Privy's captcha-keyed useCallback does in production.
  flags: { identityPerRender: false },
}));
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
    // Mocked by its real name. This file used to mock
    // `usePrivy().loginWithTelegram` — a property Privy v3 does not expose —
    // so every assertion below ran against an API that existed only inside
    // the mock, and the suite stayed green while production could not log in.
    useLoginWithTelegram: () => ({
      login: flags.identityPerRender
        ? (...args: unknown[]) => mockLogin(...args)
        : mockLogin,
      state: { status: "initial" },
    }),
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
}));

vi.mock("@repo/hyperliquid-sdk", () => ({
  clearStoredAgentKey: clearStoredAgentKeyMock,
  useMarketData: () => ({
    data: [],
    isError: false,
    isLoading: false,
  }),
  useSetupTrading: () => null,
}));

async function renderGate() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <TelegramAuthGate>
        <div>Protected app</div>
      </TelegramAuthGate>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

/**
 * Every Privy name this file mocks must still exist on the real package.
 *
 * `usePrivy().loginWithTelegram` existed in Privy v1 and does not exist in
 * v3. The v1 -> v3 upgrade kept calling it behind an `as unknown as` cast,
 * so the compiler saw nothing, this suite mocked the missing property into
 * existence, and every fresh Telegram login in production called `undefined`.
 * A mock is a claim about someone else's API; this asserts the claim against
 * the installed package, so an upgrade that moves or renames one of these
 * fails here rather than in a webview nobody can attach a console to.
 */
describe("Privy API surface this suite mocks", () => {
  it("still exists on the installed package", async () => {
    const actual = await vi.importActual<typeof import("@privy-io/react-auth")>(
      "@privy-io/react-auth",
    );

    for (const name of ["usePrivy", "useToken", "useLoginWithTelegram"]) {
      expect(actual, `${name} must exist on @privy-io/react-auth`).toHaveProperty(
        name,
      );
      expect(typeof (actual as Record<string, unknown>)[name]).toBe("function");
    }
  });
});

describe("TelegramAuthGate", () => {
  // No shared residue between cases: `bootstrapProfileMock` in particular is
  // asserted with toHaveBeenCalledWith, which would otherwise be satisfiable
  // by a neighbouring test's call.
  beforeEach(() => {
    vi.clearAllMocks();
    flags.identityPerRender = false;
    document.body.innerHTML = "";
  });

  it("shows retry UI when Telegram login fails", async () => {
    installTelegramWebAppMock();
    mockLogin.mockRejectedValue(new Error("Telegram auth failed"));

    mockUsePrivy.mockReturnValue({
      ready: true,
      authenticated: false,
      user: null,
    });

    await renderGate();

    // Exactly one: a second concurrent Telegram flow is what the in-flight
    // guard and the login ref exist to prevent.
    expect(mockLogin).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  /**
   * Privy memoizes `login` on its captcha state, and calling `login` mutates
   * that state — so a new function identity arrives mid-flight. If the effect
   * depended on the function instead of reading it through a ref, that would
   * fire a second login. Deleting `loginRef` from App.tsx must fail here.
   */
  it("does not re-login when the hook returns a new function identity", async () => {
    installTelegramWebAppMock();
    mockLogin.mockRejectedValue(new Error("Telegram auth failed"));
    flags.identityPerRender = true;

    mockUsePrivy.mockReturnValue({
      ready: true,
      authenticated: false,
      user: null,
    });

    const view = await renderGate();
    await act(async () => {
      view.rerender(
        <TelegramAuthGate>
          <div>Protected app</div>
        </TelegramAuthGate>,
      );
      await Promise.resolve();
    });

    expect(mockLogin).toHaveBeenCalledTimes(1);
  });

  /**
   * #startup-shell is opaque and z-index 9999, and only StartupShellController
   * removes it — which the loginError branch returns before mounting. Without
   * an explicit teardown the retry card is painted underneath it, which is how
   * a failed login presented as a frozen splash.
   */
  it("removes the startup shell so the error card is actually visible", async () => {
    installTelegramWebAppMock();
    mockLogin.mockRejectedValue(new Error("Telegram auth failed"));

    const shell = document.createElement("div");
    shell.id = "startup-shell";
    document.body.appendChild(shell);

    mockUsePrivy.mockReturnValue({
      ready: true,
      authenticated: false,
      user: null,
    });

    await renderGate();

    // teardownStartupShell hides on the next frame and removes after a
    // timeout; the attribute is the synchronous half of that contract.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    const remaining = document.getElementById("startup-shell");
    expect(remaining === null || remaining.dataset.hidden === "true").toBe(true);
  });

  /**
   * One attempt authenticates while a second is still in flight and rejects.
   * A signed-in user must not be parked on an error card.
   */
  it("does not show the error card once the user is authenticated", async () => {
    installTelegramWebAppMock();
    mockLogin.mockRejectedValue(new Error("Telegram auth failed"));

    mockUsePrivy.mockReturnValue({
      ready: true,
      authenticated: false,
      user: null,
    });
    const view = await renderGate();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();

    mockUsePrivy.mockReturnValue({
      ready: true,
      authenticated: true,
      user: { id: "did:privy:user:late", wallet: { address: "0xlate" } },
    });
    await act(async () => {
      view.rerender(
        <TelegramAuthGate>
          <div>Protected app</div>
        </TelegramAuthGate>,
      );
      await Promise.resolve();
    });

    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByText("Protected app")).toBeVisible();
  });

  /**
   * The defect this file missed threw *synchronously* — calling undefined —
   * which a trailing `.catch` never sees, because no promise is created to
   * attach it to. The error escaped into the ErrorBoundary and the retry
   * card below was unreachable. The gate now awaits inside try/catch, so a
   * synchronous failure lands on the same error card as a rejection.
   */
  it("shows the retry card when the login trigger throws synchronously", async () => {
    installTelegramWebAppMock();
    mockLogin.mockReset();
    mockLogin.mockImplementation(() => {
      throw new TypeError("loginWithTelegram is not a function");
    });

    mockUsePrivy.mockReturnValue({
      ready: true,
      authenticated: false,
      user: null,
    });

    await renderGate();

    expect(screen.getByText("Login failed")).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("retries the login through the same trigger", async () => {
    installTelegramWebAppMock();
    mockLogin.mockReset();
    mockLogin.mockRejectedValue(new Error("Telegram auth failed"));

    mockUsePrivy.mockReturnValue({
      ready: true,
      authenticated: false,
      user: null,
    });

    await renderGate();
    const callsBeforeRetry = mockLogin.mock.calls.length;

    await act(async () => {
      screen.getByRole("button", { name: "Retry" }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockLogin.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
  });

  it("bootstraps the server profile after auth settles", async () => {
    installTelegramWebAppMock();
    mockLogin.mockReset();
    mockGetAccessToken.mockResolvedValue("access-token");
    mockUsePrivy.mockReturnValue({
      ready: true,
      authenticated: true,
      user: {
        id: "did:privy:user:123",
        wallet: { address: "0xabc" },
        email: { address: "alice@example.com" },
        telegram: { username: "alice_privy" },
      },
    });

    await renderGate();

    expect(bootstrapProfileMock).toHaveBeenCalledWith("access-token");
    // An already-authenticated user must not be sent through login again.
    expect(mockLogin).not.toHaveBeenCalled();
  });

  /**
   * The end of an account's session on this device must delete its trading
   * key: the key signs orders for up to 180 days and localStorage outlives
   * the session, so whoever holds the device next must not inherit it.
   */
  it("deletes the departing account's trading key when the account changes", async () => {
    clearStoredAgentKeyMock.mockClear();
    installTelegramWebAppMock();
    mockGetAccessToken.mockResolvedValue("access-token");
    mockUsePrivy.mockReturnValue({
      ready: true,
      authenticated: true,
      user: { id: "did:privy:user:alice", wallet: { address: "0xalice" } },
    });

    const view = await renderGate();
    expect(clearStoredAgentKeyMock).not.toHaveBeenCalled();

    mockUsePrivy.mockReturnValue({
      ready: true,
      authenticated: true,
      user: { id: "did:privy:user:bob", wallet: { address: "0xbob" } },
    });
    await act(async () => {
      view.rerender(
        <TelegramAuthGate>
          <div>Protected app</div>
        </TelegramAuthGate>,
      );
      await Promise.resolve();
    });

    expect(clearStoredAgentKeyMock).toHaveBeenCalledWith("0xalice");
    expect(clearStoredAgentKeyMock).not.toHaveBeenCalledWith("0xbob");
  });

  /**
   * Same boundary, subtler shape: the Privy user stays but their wallet
   * changes. The departing wallet's key must not linger just because the
   * login did.
   */
  it("deletes the old wallet's trading key when the same user changes wallet", async () => {
    // This file has no beforeEach reset; the previous test's clear call would
    // otherwise bleed into the not-called assertion below.
    clearStoredAgentKeyMock.mockClear();
    installTelegramWebAppMock();
    mockGetAccessToken.mockResolvedValue("access-token");
    mockUsePrivy.mockReturnValue({
      ready: true,
      authenticated: true,
      user: { id: "did:privy:user:alice", wallet: { address: "0xold" } },
    });

    const view = await renderGate();
    expect(clearStoredAgentKeyMock).not.toHaveBeenCalled();

    mockUsePrivy.mockReturnValue({
      ready: true,
      authenticated: true,
      user: { id: "did:privy:user:alice", wallet: { address: "0xnew" } },
    });
    await act(async () => {
      view.rerender(
        <TelegramAuthGate>
          <div>Protected app</div>
        </TelegramAuthGate>,
      );
      await Promise.resolve();
    });

    expect(clearStoredAgentKeyMock).toHaveBeenCalledWith("0xold");
    expect(clearStoredAgentKeyMock).not.toHaveBeenCalledWith("0xnew");
  });
});
