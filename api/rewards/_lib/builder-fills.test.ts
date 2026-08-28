import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  builderFillsUrl,
  parseBuilderFillsCsv,
  toExportDay,
} from "./builder-fills";
import { decompressLz4Frame, Lz4Error } from "./lz4";

const FIXTURE = resolve(
  process.cwd(),
  "api/rewards/_lib/__fixtures__/builder_fills_20260824.csv.lz4",
);

const HEADER =
  "time,user,coin,side,px,sz,crossed,special_trade_type,tif,is_trigger,counterparty,closed_pnl,twap_id,builder_fee";

describe("lz4 frame decoding", () => {
  /**
   * The real file, byte for byte, as Hyperliquid published it for 24 August.
   * A decompressor validated only against data this repo generated proves
   * nothing about the one input it exists to read.
   */
  it("decodes the export Hyperliquid actually published", () => {
    const csv = decompressLz4Frame(readFileSync(FIXTURE)).toString("utf8");

    expect(csv.split("\n")[0]).toBe(HEADER);
    expect(csv).toContain("0x0fbb6d45a796bb32617ea066a86a79f6e3774204");
  });

  it("rejects something that is not a frame", () => {
    expect(() => decompressLz4Frame(Buffer.from("time,user,coin\n1,2,3"))).toThrow(Lz4Error);
  });

  // A truncated download is an ordinary event and must fail loudly rather than
  // decode to a short, plausible-looking file.
  it("rejects a truncated frame instead of returning partial output", () => {
    const full = readFileSync(FIXTURE);
    expect(() => decompressLz4Frame(full.subarray(0, full.length - 40))).toThrow(Lz4Error);
  });
});

describe("builder fills parsing", () => {
  const csv = decompressLz4Frame(readFileSync(FIXTURE)).toString("utf8");

  it("reads the rows out of the real export", () => {
    const { malformed, rows } = parseBuilderFillsCsv(csv, "20260824");

    expect(malformed).toBe(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      builderFeeUsd: 0.009971,
      coin: "BTC",
      occurredAt: "2026-08-24T11:28:22.000Z",
      rowKey: "20260824:1",
      side: "Ask",
      walletAddress: "0x0fbb6d45a796bb32617ea066a86a79f6e3774204",
    });
  });

  /**
   * Triggered take-profit and stop-loss fills are exactly what the old
   * cloid-prefix attribution missed, and one of the two rows in this real day
   * is one. Worth asserting that the flag survives the parse.
   */
  it("keeps the trigger flag", () => {
    const { rows } = parseBuilderFillsCsv(csv, "20260824");

    expect(rows.map((row) => row.isTrigger)).toEqual([false, true]);
  });

  /**
   * Column order is the only thing identifying these fields — the file carries
   * no schema. A reordered export read as valid data would point the fee column
   * at a price, so the header is checked rather than assumed.
   */
  it("refuses a file whose columns have changed", () => {
    const reordered = `time,user,coin,side,px,sz,crossed,special_trade_type,tif,is_trigger,counterparty,closed_pnl,twap_id,builder_fee_usd\n`;

    expect(() => parseBuilderFillsCsv(reordered, "20260824")).toThrow(/unexpected builder_fills columns/);
  });

  it("counts a malformed row rather than importing a broken one", () => {
    const { malformed, rows } = parseBuilderFillsCsv(
      `${HEADER}\n2026-08-24T11:28:22Z,0xabc,BTC,Ask\n`,
      "20260824",
    );

    expect(rows).toEqual([]);
    expect(malformed).toBe(1);
  });

  /**
   * Row identity is the line number, because the export carries no fill id and
   * a natural key would collapse two genuine fills of one order that filled at
   * one price inside one second.
   */
  it("keeps two identical fills in the same second apart", () => {
    const line = "2026-08-24T11:28:22Z,0xabc,BTC,Ask,77901,0.00128,true,Na,Ioc,false,0xdef,0,0,0.009971";
    const { rows } = parseBuilderFillsCsv(`${HEADER}\n${line}\n${line}\n`, "20260824");

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.rowKey)).toEqual(["20260824:1", "20260824:2"]);
  });
});

describe("export addressing", () => {
  it("lowercases the address, because the bucket key is literal", () => {
    expect(
      builderFillsUrl({
        builderAddress: "0x99E3327611c4d5aBfeaA9c64C151817a9554Fb5D",
        day: "20260824",
        testnet: false,
      }),
    ).toBe(
      "https://stats-data.hyperliquid.xyz/Mainnet/builder_fills/0x99e3327611c4d5abfeaa9c64c151817a9554fb5d/20260824.csv.lz4",
    );
  });

  it("addresses testnet separately", () => {
    expect(
      builderFillsUrl({ builderAddress: "0xAbC", day: "20260824", testnet: true }),
    ).toContain("/Testnet/builder_fills/0xabc/");
  });

  it("keys days by UTC, as the export does", () => {
    expect(toExportDay(new Date("2026-08-24T23:59:59.000Z"))).toBe("20260824");
    expect(toExportDay(new Date("2026-08-25T00:00:01.000Z"))).toBe("20260825");
  });
});
