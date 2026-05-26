import { describe, expect, it, vi } from "vitest";

import type { ProfileConfig } from "./config";
import { bootstrapProfileUser } from "./supabase-admin";

const config: ProfileConfig = {
  privyAppId: "privy_app_123",
  privyAppSecret: "privy_secret_123",
  supabaseUrl: "https://supabase.example",
  supabaseServiceRoleKey: "service_role_123",
};

const existingProfile = {
  id: "user_123",
  telegram_id: "telegram_123",
  wallet_address: "0xold",
  privy_user_id: "did:privy:user_123",
  username: "alice",
  email: "old@example.com",
  language: "en",
};

describe("bootstrapProfileUser", () => {
  it("patches canonical fields by authenticated DID without changing Telegram identity", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json([existingProfile]))
      .mockResolvedValueOnce(
        Response.json([
          {
            ...existingProfile,
            wallet_address: "0xcanonical",
            email: "alice@example.com",
          },
        ]),
      );

    await bootstrapProfileUser(config, {
      privyUserId: "did:privy:user_123",
      telegramId: null,
      walletAddress: "0xcanonical",
      username: null,
      email: "Alice@Example.com",
      language: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      "users?id=eq.user_123&privy_user_id=eq.did%3Aprivy%3Auser_123",
    );
    const payload = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(payload).toEqual({
      wallet_address: "0xcanonical",
      privy_user_id: "did:privy:user_123",
      email: "alice@example.com",
    });
    expect(payload).not.toHaveProperty("telegram_id");
    expect(payload).not.toHaveProperty("username");
  });

  it("rejects a signed Telegram ID already owned by another Privy DID", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json([
          {
            ...existingProfile,
            privy_user_id: "did:privy:someone_else",
          },
        ]),
      );

    await expect(
      bootstrapProfileUser(config, {
        privyUserId: "did:privy:user_123",
        telegramId: "telegram_123",
        walletAddress: "0xcanonical",
        username: "alice_signed",
        email: "alice@example.com",
        language: "en",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "IDENTITY_CONFLICT",
    });
  });
});
