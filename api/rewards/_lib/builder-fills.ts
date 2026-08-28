import { fetchWithTimeout } from "../../_lib/fetch-with-timeout";
import { decompressLz4Frame } from "./lz4";

/**
 * Hyperliquid's daily export of the fills that paid *our* builder address.
 *
 * This is the difference between observed and verified attribution. A fill's
 * `builderFee` from `userFills` says the trade paid *a* builder — it does not
 * say it paid us. A user who trades the same account through another app with
 * another builder produces fills that look identical to ours from that
 * endpoint, and the volume XP path currently credits them. This export is
 * published per builder address, so a row in it is Hyperliquid stating that the
 * fee came to us.
 *
 * Published once a day and not immediately: a day's file returns 403 until it
 * exists, which is S3 answering for a key that is not there. So this is a
 * reconciliation input rather than a grant input — XP would otherwise arrive up
 * to a day late, which for a program built on same-session feedback is a worse
 * trade than crediting a little volume we did not intermediate.
 */

const COLUMNS = [
  "time",
  "user",
  "coin",
  "side",
  "px",
  "sz",
  "crossed",
  "special_trade_type",
  "tif",
  "is_trigger",
  "counterparty",
  "closed_pnl",
  "twap_id",
  "builder_fee",
] as const;

export interface BuilderFillRow {
  builderFeeUsd: number;
  coin: string;
  isTrigger: boolean;
  occurredAt: string;
  px: number;
  /** `{day}:{line}`. See the note in `parseBuilderFillsCsv`. */
  rowKey: string;
  side: string;
  sz: number;
  walletAddress: string;
}

export type BuilderFillsFetch =
  | { kind: "ok"; body: Buffer }
  /** The day has not been published. S3 answers 403, not 404, for a missing key. */
  | { kind: "unpublished" }
  | { kind: "unavailable"; code: string };

export function builderFillsUrl(args: {
  builderAddress: string;
  day: string;
  testnet: boolean;
}): string {
  const network = args.testnet ? "Testnet" : "Mainnet";
  // Lowercase: the bucket keys addresses that way and S3 paths are literal.
  const address = args.builderAddress.toLowerCase();
  return `https://stats-data.hyperliquid.xyz/${network}/builder_fills/${address}/${args.day}.csv.lz4`;
}

/** `YYYYMMDD` in UTC, which is how the export is keyed. */
export function toExportDay(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function fetchBuilderFills(args: {
  builderAddress: string;
  day: string;
  testnet: boolean;
}): Promise<BuilderFillsFetch> {
  let response: Response;
  try {
    response = await fetchWithTimeout(builderFillsUrl(args), { method: "GET" });
  } catch {
    return { code: "network_error", kind: "unavailable" };
  }

  if (response.status === 403 || response.status === 404) {
    return { kind: "unpublished" };
  }

  if (!response.ok) {
    return { code: `http_${response.status}`, kind: "unavailable" };
  }

  return { body: Buffer.from(await response.arrayBuffer()), kind: "ok" };
}

/**
 * Parse one day's export.
 *
 * The header is checked rather than assumed. Column order is the only thing
 * identifying these fields — the file carries no schema — so a silently
 * reordered or extended export would otherwise be read as valid data with the
 * fee column pointing at a price.
 *
 * Row identity is `{day}:{line}`. The export carries no fill id, hash or order
 * id, so there is nothing intrinsic to key on, and a natural key built from
 * (time, coin, price, size, fee) would collapse two genuine fills of one order
 * that filled at one price in one second. A settled day's file does not change,
 * which makes its line numbering as stable as anything in it.
 */
export function parseBuilderFillsCsv(csv: string, day: string): {
  malformed: number;
  rows: BuilderFillRow[];
} {
  const lines = csv.split("\n").filter((line) => line.length > 0);
  const header = lines[0]?.trim();

  if (header !== COLUMNS.join(",")) {
    throw new Error(`unexpected builder_fills columns: ${header ?? "<empty>"}`);
  }

  const rows: BuilderFillRow[] = [];
  let malformed = 0;

  for (let index = 1; index < lines.length; index += 1) {
    const fields = lines[index]!.trim().split(",");
    if (fields.length !== COLUMNS.length) {
      malformed += 1;
      continue;
    }

    const [time, user, coin, side, px, sz, , , , isTrigger, , , , builderFee] = fields as string[];
    const occurredAtMs = Date.parse(time!);
    const feeUsd = Number(builderFee);

    if (!Number.isFinite(occurredAtMs) || !Number.isFinite(feeUsd)) {
      malformed += 1;
      continue;
    }

    rows.push({
      builderFeeUsd: feeUsd,
      coin: coin!,
      isTrigger: isTrigger === "true",
      occurredAt: new Date(occurredAtMs).toISOString(),
      px: Number(px),
      rowKey: `${day}:${index}`,
      side: side!,
      sz: Number(sz),
      walletAddress: user!.toLowerCase(),
    });
  }

  return { malformed, rows };
}

/** Fetch, decompress and parse one day. */
export async function loadBuilderFillsDay(args: {
  builderAddress: string;
  day: string;
  testnet: boolean;
}): Promise<
  | { kind: "ok"; malformed: number; rows: BuilderFillRow[] }
  | { kind: "unpublished" }
  | { kind: "unavailable"; code: string }
> {
  const fetched = await fetchBuilderFills(args);
  if (fetched.kind !== "ok") {
    return fetched;
  }

  let csv: string;
  try {
    csv = decompressLz4Frame(fetched.body).toString("utf8");
  } catch {
    return { code: "decompress_failed", kind: "unavailable" };
  }

  try {
    const { malformed, rows } = parseBuilderFillsCsv(csv, args.day);
    return { kind: "ok", malformed, rows };
  } catch {
    return { code: "schema_changed", kind: "unavailable" };
  }
}
