import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyTelegramInitData } from "./telegram";

function signInitData(params: Record<string, string>, botToken: string) {
  const dataCheckString = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}

describe("verifyTelegramInitData", () => {
  it("accepts valid Telegram initData", () => {
    const botToken = "123456:secret";
    const authDate = Math.floor(Date.now() / 1000).toString();
    const initData = signInitData(
      {
        auth_date: authDate,
        query_id: "query",
        user: JSON.stringify({ id: 42, first_name: "Alice" }),
      },
      botToken,
    );

    expect(verifyTelegramInitData(initData, botToken).user?.id).toBe(42);
  });

  it("rejects tampered Telegram initData", () => {
    const botToken = "123456:secret";
    const authDate = Math.floor(Date.now() / 1000).toString();
    const initData = signInitData(
      {
        auth_date: authDate,
        user: JSON.stringify({ id: 42, first_name: "Alice" }),
      },
      botToken,
    ).replace("Alice", "Mallory");

    expect(() => verifyTelegramInitData(initData, botToken)).toThrow(
      "Missing or invalid Telegram init data",
    );
  });
});
