// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { __builderApprovalStorageForTests } from "./hooks";

const { read, write } = __builderApprovalStorageForTests;
const ADDR = "0xAbCdEf0000000000000000000000000000000001";
const KEY = `hl-builder-approved:${ADDR.toLowerCase()}`;

/**
 * The seed that used to keep a wrong answer alive across reloads.
 *
 * This value is `initialData` for useBuilderFeeApproval, so whatever it says
 * is what the trading-setup gate believes before any network call. It used to
 * collapse every positive fee to the sentinel "1", which was only meaningful
 * against the retired `feeTenthsBp > 0` test; under the gate's `>=` comparison
 * a "1" is indistinguishable from an approval well below the configured rate,
 * so an under-approved account kept a lit order button through every reload.
 */
describe("builder approval storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips the real approved fee", () => {
    write(ADDR, 50);
    expect(window.localStorage.getItem(KEY)).toBe("50");
    expect(read(ADDR)).toBe(50);
  });

  it("keeps zero meaningful — no approval is none at any threshold", () => {
    write(ADDR, 0);
    expect(read(ADDR)).toBe(0);
  });

  /**
   * The migration decision: a legacy "1" means "some positive fee", which may
   * be under the configured rate. Reading it as unknown costs that device one
   * real fetch; believing it is the bug.
   */
  it("reads the legacy sentinel as unknown rather than as approved", () => {
    window.localStorage.setItem(KEY, "1");
    expect(read(ADDR)).toBeUndefined();
  });

  it("reports unknown when nothing was ever stored", () => {
    expect(read(ADDR)).toBeUndefined();
  });

  it("ignores a corrupted value instead of trusting it", () => {
    window.localStorage.setItem(KEY, "not-a-number");
    expect(read(ADDR)).toBeUndefined();
  });

  it("is keyed case-insensitively by address", () => {
    write(ADDR.toLowerCase(), 50);
    expect(read(ADDR.toUpperCase())).toBe(50);
  });
});
