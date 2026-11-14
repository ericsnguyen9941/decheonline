// Raw DEFLATE (RFC 1951) in plain TypeScript: empires.dat is a raw deflate stream with
// no zlib or gzip header. Synchronous and platform-free, so the same code runs in the
// browser, in Node and in tests.

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115,
  131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
  2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
  13,
];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const MAX_BITS = 15;

/** Canonical Huffman code: how many codes per bit length, and symbols in code order. */
interface Huffman {
  counts: Uint16Array;
  symbols: Uint16Array;
}

function buildHuffman(lengths: ArrayLike<number>): Huffman {
  const counts = new Uint16Array(MAX_BITS + 1);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]!]!++;
  counts[0] = 0;
  const offsets = new Uint16Array(MAX_BITS + 2);
  for (let len = 1; len <= MAX_BITS; len++) offsets[len + 1] = offsets[len]! + counts[len]!;
  const symbols = new Uint16Array(lengths.length);
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym]!;
    if (len !== 0) symbols[offsets[len]!++] = sym;
  }
  return { counts, symbols };
}

class BitReader {
  private pos = 0;
  private bitBuf = 0;
  private bitCount = 0;

  constructor(private readonly input: Uint8Array) {}

  bits(n: number): number {
    while (this.bitCount < n) {
      if (this.pos >= this.input.length) throw new Error('inflate: unexpected end of input');
      this.bitBuf |= this.input[this.pos++]! << this.bitCount;
      this.bitCount += 8;
    }
    const value = this.bitBuf & ((1 << n) - 1);
    this.bitBuf >>>= n;
    this.bitCount -= n;
    return value;
  }

  /** Drops the bits left in the current byte (stored blocks start byte-aligned). */
  alignToByte(): void {
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  byte(): number {
    if (this.pos >= this.input.length) throw new Error('inflate: unexpected end of input');
    return this.input[this.pos++]!;
  }

  decode(h: Huffman): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= MAX_BITS; len++) {
      code |= this.bits(1);
      const count = h.counts[len]!;
      if (code - first < count) return h.symbols[index + code - first]!;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('inflate: invalid Huffman code');
  }
}

class Output {
  bytes = new Uint8Array(1 << 16);
  length = 0;

  private reserve(n: number): void {
    if (this.length + n <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.length));
    this.bytes = next;
  }

  push(b: number): void {
    this.reserve(1);
    this.bytes[this.length++] = b;
  }

  copy(distance: number, len: number): void {
    if (distance > this.length) throw new Error('inflate: distance too far back');
    this.reserve(len);
    for (let i = 0; i < len; i++) {
      this.bytes[this.length] = this.bytes[this.length - distance]!;
      this.length++;
    }
  }
}

let fixedTables: { lit: Huffman; dist: Huffman } | undefined;

function fixed(): { lit: Huffman; dist: Huffman } {
  if (!fixedTables) {
    const lit = new Uint8Array(288);
    lit.fill(8, 0, 144);
    lit.fill(9, 144, 256);
    lit.fill(7, 256, 280);
    lit.fill(8, 280, 288);
    fixedTables = { lit: buildHuffman(lit), dist: buildHuffman(new Uint8Array(30).fill(5)) };
  }
  return fixedTables;
}

function dynamic(br: BitReader): { lit: Huffman; dist: Huffman } {
  const nlen = br.bits(5) + 257;
  const ndist = br.bits(5) + 1;
  const ncode = br.bits(4) + 4;
  const codeLengths = new Uint8Array(19);
  for (let i = 0; i < ncode; i++) codeLengths[CODE_LENGTH_ORDER[i]!] = br.bits(3);
  const codeHuffman = buildHuffman(codeLengths);
  const lengths = new Uint8Array(nlen + ndist);
  let i = 0;
  while (i < nlen + ndist) {
    const sym = br.decode(codeHuffman);
    if (sym < 16) {
      lengths[i++] = sym;
      continue;
    }
    let repeat: number;
    let value = 0;
    if (sym === 16) {
      if (i === 0) throw new Error('inflate: repeat with no previous length');
      value = lengths[i - 1]!;
      repeat = 3 + br.bits(2);
    } else if (sym === 17) {
      repeat = 3 + br.bits(3);
    } else {
      repeat = 11 + br.bits(7);
    }
    if (i + repeat > nlen + ndist) throw new Error('inflate: too many code lengths');
    lengths.fill(value, i, i + repeat);
    i += repeat;
  }
  return { lit: buildHuffman(lengths.subarray(0, nlen)), dist: buildHuffman(lengths.subarray(nlen)) };
}

/** Inflates a raw DEFLATE stream. Throws on malformed input. */
export function inflateRaw(input: Uint8Array): Uint8Array {
  const br = new BitReader(input);
  const out = new Output();
  let final = 0;
  while (!final) {
    final = br.bits(1);
    const type = br.bits(2);
    if (type === 0) {
      br.alignToByte();
      const len = br.byte() | (br.byte() << 8);
      const nlen = br.byte() | (br.byte() << 8);
      if ((len ^ 0xffff) !== nlen) throw new Error('inflate: stored block length mismatch');
      for (let i = 0; i < len; i++) out.push(br.byte());
      continue;
    }
    if (type === 3) throw new Error('inflate: invalid block type');
    const { lit, dist } = type === 1 ? fixed() : dynamic(br);
    for (;;) {
      const sym = br.decode(lit);
      if (sym < 256) {
        out.push(sym);
      } else if (sym === 256) {
        break;
      } else {
        const li = sym - 257;
        if (li >= LENGTH_BASE.length) throw new Error('inflate: invalid length symbol');
        const len = LENGTH_BASE[li]! + br.bits(LENGTH_EXTRA[li]!);
        const di = br.decode(dist);
        if (di >= DIST_BASE.length) throw new Error('inflate: invalid distance symbol');
        out.copy(DIST_BASE[di]! + br.bits(DIST_EXTRA[di]!), len);
      }
    }
  }
  return out.bytes.slice(0, out.length);
}

/**
 * Wraps bytes in a raw DEFLATE stream of stored (uncompressed) blocks. Valid input for
 * any inflater; used to write synthetic dat files without a compressor.
 */
export function deflateStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 0xffff));
  const out = new Uint8Array(data.length + blocks * 5);
  let o = 0;
  for (let b = 0; b < blocks; b++) {
    const chunk = data.subarray(b * 0xffff, (b + 1) * 0xffff);
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = chunk.length & 0xff;
    out[o++] = chunk.length >> 8;
    out[o++] = ~chunk.length & 0xff;
    out[o++] = (~chunk.length >> 8) & 0xff;
    out.set(chunk, o);
    o += chunk.length;
  }
  return out;
}
