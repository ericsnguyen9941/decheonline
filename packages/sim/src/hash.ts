const f32Buf = new Float32Array(1);
const f32Bits = new Uint32Array(f32Buf.buffer);
const f64Buf = new Float64Array(1);
const f64Bits = new Uint32Array(f64Buf.buffer);
/** Which 32-bit half of a float64 holds the sign and exponent on this machine's byte order. */
const F64_HI = new Uint8Array(new Float64Array([-0]).buffer)[7] === 0x80 ? 1 : 0;

/**
 * 32-bit state hash over a sequence of 32-bit words (MurmurHash3 x86_32 word mixing). Floats are hashed
 * by their bit patterns, so a one-ulp difference changes the hash. Reading a float's bits through a
 * same-size integer view gives the same integer on any byte order.
 */
export class Hasher {
  private h: number;
  private words = 0;

  constructor(seed = 0) {
    this.h = seed >>> 0;
  }

  u32(v: number): this {
    let k = Math.imul(v >>> 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    let h = this.h ^ k;
    h = (h << 13) | (h >>> 19);
    this.h = (Math.imul(h, 5) + 0xe6546b64) | 0;
    this.words++;
    return this;
  }

  f32(v: number): this {
    f32Buf[0] = v;
    return this.u32(f32Bits[0]!);
  }

  f64(v: number): this {
    f64Buf[0] = v;
    return this.u32(f64Bits[1 - F64_HI]!).u32(f64Bits[F64_HI]!);
  }

  digest(): number {
    let h = this.h ^ (this.words * 4);
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
}
