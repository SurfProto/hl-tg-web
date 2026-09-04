import { beforeEach, describe, expect, it } from "vitest";

import { configureGasSponsorship, isDepositGasSponsored } from "./gas-sponsorship";

describe("gas sponsorship config", () => {
  beforeEach(() => {
    // Module state, like configureBuilder. Restore the shipped default.
    configureGasSponsorship(false);
  });

  it("is off until something turns it on", () => {
    expect(isDepositGasSponsored()).toBe(false);
  });

  // Vite hands through the raw string, so the string is the real input.
  it("reads the string an env var actually provides", () => {
    configureGasSponsorship("true");
    expect(isDepositGasSponsored()).toBe(true);

    configureGasSponsorship("false");
    expect(isDepositGasSponsored()).toBe(false);
  });

  it("tolerates the casing and padding a dashboard produces", () => {
    configureGasSponsorship("  TRUE  ");
    expect(isDepositGasSponsored()).toBe(true);
  });

  // Anything that is not "true" leaves the user paying. A typo must fail
  // toward the truthful copy, never toward claiming sponsorship we do not have.
  it.each(["1", "yes", "on", "", "TRUE!", "sponsored"])(
    "treats %o as off rather than guessing",
    (value) => {
      configureGasSponsorship(value);
      expect(isDepositGasSponsored()).toBe(false);
    },
  );

  it("keeps the current setting when the variable is unset", () => {
    configureGasSponsorship("true");
    configureGasSponsorship(undefined);
    expect(isDepositGasSponsored()).toBe(true);
  });

  it("accepts a real boolean too", () => {
    configureGasSponsorship(true);
    expect(isDepositGasSponsored()).toBe(true);
  });
});
