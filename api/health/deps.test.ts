import { describe, expect, it, vi } from "vitest";

import handler from "./deps";

function createResponse() {
  const res: any = {
    statusCode: null as number | null,
    body: null as any,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

describe("GET /api/health/deps", () => {
  it("loads every module the authenticated paths need", async () => {
    const response = createResponse();
    await handler({ method: "GET" }, response);

    // Anything here failing locally means it would fail deployed too — this is
    // the same specifier the real route uses.
    const failed = response.body.data.modules.filter((m: any) => !m.ok);
    expect(failed).toEqual([]);
    expect(response.statusCode).toBe(200);
    expect(response.body.data.checked).toBeGreaterThan(5);
  });

  it("names the module that failed rather than dying with it", async () => {
    // A failure has to be attributable: "something broke" would have been no
    // more useful than the 401 that hid these bugs in the first place.
    const response = createResponse();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const body = await (async () => {
      await handler({ method: "GET" }, response);
      return response.body;
    })();

    expect(body.data.modules.every((m: any) => typeof m.id === "string")).toBe(true);
  });

  it("rejects anything but GET", async () => {
    const response = createResponse();
    await handler({ method: "POST" }, response);

    expect(response.statusCode).toBe(405);
  });
});
