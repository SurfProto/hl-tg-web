import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { fetchOnrampQuote } from "./onramp";

describe("onramp client", () => {
  it("surfaces a readable error when an API endpoint returns HTML", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body>Not Found</body></html>", {
        status: 404,
        headers: {
          "Content-Type": "text/html",
        },
      }),
    );

    await expect(fetchOnrampQuote("token_123", 1000)).rejects.toThrow(
      "returned HTML instead of JSON",
    );
  });
});

describe("tg-mini-app vercel config", () => {
  it("preserves /api routes before the SPA catch-all rewrite", async () => {
    const rawConfig = await readFile(
      new URL("../../vercel.json", import.meta.url),
      "utf8",
    );
    const config = JSON.parse(rawConfig) as {
      rewrites?: Array<{ source: string; destination: string }>;
    };

    expect(config.rewrites?.[0]).toEqual({
      source: "/api/(.*)",
      destination: "/api/$1",
    });

    expect(config.rewrites).toContainEqual({
      source: "/(.*)",
      destination: "/index.html",
    });
  });
});
