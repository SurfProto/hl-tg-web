/**
 * LZ4 frame decoding, for Hyperliquid's daily builder-fills export.
 *
 * Vendored rather than taken as a dependency. The frame and block formats are
 * frozen, this needs one direction of one of them, and the alternative on npm
 * is a decade-old package that would sit on a path handling fee accounting.
 * Seventy lines that can be read in full are the better trade here.
 *
 * Everything below bounds-checks against the input length rather than trusting
 * the sizes encoded in it. The file comes from Hyperliquid's own bucket, but a
 * truncated download is an ordinary event and must fail as a decode error
 * rather than as a silent short read.
 */

const MAGIC = 0x184d2204;

/** BD byte's block-maximum-size table, in bytes. Indices below 4 are reserved. */
const BLOCK_MAX_SIZES = [0, 0, 0, 0, 64 * 1024, 256 * 1024, 1024 * 1024, 4 * 1024 * 1024];

/** A day of builder fills is kilobytes. This is a decompression-bomb stop, not a limit. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export class Lz4Error extends Error {}

/**
 * One LZ4 block.
 *
 * Sequences of: a token (high nibble literal length, low nibble match length),
 * the literals, a two-byte little-endian back-offset, then the match copied
 * byte by byte — overlapping copies are legal and are how runs are encoded, so
 * this cannot use `copyWithin`.
 */
function decompressBlock(src: Buffer, maxOutput: number): Buffer {
  const out = Buffer.allocUnsafe(maxOutput);
  let s = 0;
  let d = 0;

  const readLengthExtension = (initial: number): number => {
    let length = initial;
    let add: number;
    do {
      if (s >= src.length) {
        throw new Lz4Error("truncated length extension");
      }
      add = src[s++]!;
      length += add;
    } while (add === 255);
    return length;
  };

  while (s < src.length) {
    const token = src[s++]!;

    let literalLength = token >> 4;
    if (literalLength === 15) {
      literalLength = readLengthExtension(literalLength);
    }

    if (s + literalLength > src.length || d + literalLength > maxOutput) {
      throw new Lz4Error("literal run overruns the buffer");
    }
    src.copy(out, d, s, s + literalLength);
    d += literalLength;
    s += literalLength;

    // The last sequence of a block is literals only, with no match after it.
    if (s === src.length) {
      break;
    }

    if (s + 2 > src.length) {
      throw new Lz4Error("truncated match offset");
    }
    const offset = src[s]! | (src[s + 1]! << 8);
    s += 2;
    if (offset === 0 || offset > d) {
      throw new Lz4Error("match offset points outside the output");
    }

    let matchLength = token & 0x0f;
    if (matchLength === 15) {
      matchLength = readLengthExtension(matchLength);
    }
    matchLength += 4; // minimum match

    if (d + matchLength > maxOutput) {
      throw new Lz4Error("match overruns the buffer");
    }

    // Byte at a time: matches may overlap the region being written.
    let from = d - offset;
    for (let i = 0; i < matchLength; i += 1) {
      out[d++] = out[from++]!;
    }
  }

  return out.subarray(0, d);
}

/** The decoded contents of an LZ4 frame. */
export function decompressLz4Frame(buf: Buffer): Buffer {
  if (buf.length < 7 || buf.readUInt32LE(0) !== MAGIC) {
    throw new Lz4Error("not an lz4 frame");
  }

  const flg = buf[4]!;
  const bd = buf[5]!;

  if ((flg >> 6) !== 1) {
    throw new Lz4Error(`unsupported frame version ${flg >> 6}`);
  }

  const blockMaxSize = BLOCK_MAX_SIZES[(bd >> 4) & 0x07] ?? 0;
  if (blockMaxSize === 0) {
    throw new Lz4Error("reserved block maximum size");
  }

  let p = 7; // magic(4) + FLG + BD + header checksum
  if (flg & 0x08) p += 8; // content size
  if (flg & 0x01) p += 4; // dictionary id

  const blockChecksums = (flg & 0x10) !== 0;
  const parts: Buffer[] = [];
  let total = 0;

  for (;;) {
    if (p + 4 > buf.length) {
      throw new Lz4Error("truncated block header");
    }

    const descriptor = buf.readUInt32LE(p);
    p += 4;
    if (descriptor === 0) {
      break; // end mark
    }

    const stored = (descriptor & 0x80000000) !== 0;
    const size = descriptor & 0x7fffffff;
    if (p + size > buf.length) {
      throw new Lz4Error("truncated block body");
    }

    const block = buf.subarray(p, p + size);
    p += size;
    if (blockChecksums) p += 4;

    // A stored block is already plain bytes; the encoder writes one when
    // compression would have made it bigger.
    const decoded = stored ? block : decompressBlock(block, blockMaxSize);
    total += decoded.length;
    if (total > MAX_OUTPUT_BYTES) {
      throw new Lz4Error("decoded output exceeds the size cap");
    }

    parts.push(decoded);
  }

  return Buffer.concat(parts);
}
