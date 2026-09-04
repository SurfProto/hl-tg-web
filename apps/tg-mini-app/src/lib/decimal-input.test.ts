import { describe, expect, it } from "vitest";

import { acceptDecimalInput } from "./decimal-input";

// The rules the trade screen's number pad used to enforce by construction.
// They guard order size, limit price and withdrawal amount, so "reject the
// keystroke" matters more than "clean the value up".
describe("acceptDecimalInput", () => {
  const accept = (next: string, previous = "", maxDecimals = 2) =>
    acceptDecimalInput(next, previous, maxDecimals);

  it("takes digits and a single decimal point", () => {
    expect(accept("10")).toBe("10");
    expect(accept("10.9")).toBe("10.9");
    expect(accept("10.99")).toBe("10.99");
    expect(accept(".5")).toBe(".5");
  });

  it("keeps a partial value while it is being typed", () => {
    // "1." is on the way to "1.5"; rejecting it makes the field unusable.
    expect(accept("1.")).toBe("1.");
  });

  it("treats empty as legal, because deleting reaches it", () => {
    expect(accept("", "10.99")).toBe("");
  });

  it("refuses a decimal place beyond the cap, keeping what was there", () => {
    expect(accept("10.996", "10.99")).toBe("10.99");
    // The cap is per call: a price field allows more than a size field.
    expect(accept("10.996", "10.99", 8)).toBe("10.996");
  });

  it("refuses a second decimal point", () => {
    expect(accept("1.2.3", "1.2")).toBe("1.2");
  });

  it.each(["-1", "+1", "1e5", "1 000", "abc", "10,99"])(
    "refuses %o",
    (value) => {
      expect(accept(value, "10")).toBe("10");
    },
  );

  it("strips leading zeros rather than rejecting them", () => {
    expect(accept("05")).toBe("5");
    expect(accept("007.5")).toBe("7.5");
  });

  it("keeps a lone zero and a zero before the point", () => {
    expect(accept("0")).toBe("0");
    expect(accept("0.5")).toBe("0.5");
  });

  // The whole point: it never hands back a number the user did not type.
  it("never rounds or truncates", () => {
    expect(accept("10.996", "10.99")).not.toBe("11.00");
    expect(accept("10.996", "10.99")).not.toBe("10.99".slice(0, 5) + "6");
  });
});
