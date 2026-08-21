import { describe, expect, it } from "vitest";

import { getIconInitials, getIconSymbol } from "./icon-symbol";

describe("getIconSymbol", () => {
  it("leaves a plain perp alone", () => {
    expect(getIconSymbol("BTC")).toBe("BTC");
  });

  it("takes the base of a spot pair", () => {
    expect(getIconSymbol("HYPE/USDC")).toBe("HYPE");
  });

  it("unwraps both HIP-3 spellings", () => {
    // Internal form, as it arrives on fill.coin and position.coin.
    expect(getIconSymbol("vntls:GOLD-USDC")).toBe("GOLD");
    // Display form, as the router and market list use.
    expect(getIconSymbol("GOLD-USDC:vntls")).toBe("GOLD");
  });

  it("strips any of the stable quote suffixes", () => {
    expect(getIconSymbol("felix:OIL-USDH")).toBe("OIL");
    expect(getIconSymbol("dex:EUR-USDT")).toBe("EUR");
    expect(getIconSymbol("dex:JPY-USDE")).toBe("JPY");
  });

  it("lets a dex-listed BTC reach the BTC icon", () => {
    // The whole point of the fix: this used to key on the raw string and miss.
    expect(getIconSymbol("somedex:BTC-USDC")).toBe("BTC");
  });

  it("handles an empty coin without throwing", () => {
    expect(getIconSymbol("")).toBe("");
  });
});

describe("getIconInitials", () => {
  it("derives initials from the symbol, not the raw string", () => {
    // Previously "VN" for every market on the vntls dex.
    expect(getIconInitials("vntls:GOLD-USDC")).toBe("GO");
    expect(getIconInitials("vntls:OIL-USDC")).toBe("OI");
  });

  it("distinguishes two markets on the same dex", () => {
    expect(getIconInitials("vntls:GOLD-USDC")).not.toBe(
      getIconInitials("vntls:SILVER-USDC"),
    );
  });

  it("uppercases and drops punctuation", () => {
    expect(getIconInitials("hype")).toBe("HY");
  });
});
