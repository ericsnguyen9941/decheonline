// One codec that either reads or writes, so each record layout in layout.ts is written
// once and serves both parsing and the synthetic writer. In read mode the target objects
// start empty and are filled field by field; in write mode their fields are emitted.

export type NumKind = 'u8' | 'i8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32';

/** Keys of T whose (non-optional) value type is V. */
export type KeysOf<T, V> = { [K in keyof T]-?: NonNullable<T[K]> extends V ? K : never }[keyof T];

const SIZE: Record<NumKind, number> = { u8: 1, i8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4 };
const RANGE: Record<Exclude<NumKind, 'f32'>, [number, number]> = {
  u8: [0, 0xff],
  i8: [-0x80, 0x7f],
  i16: [-0x8000, 0x7fff],
  u16: [0, 0xffff],
  i32: [-0x80000000, 0x7fffffff],
  u32: [0, 0xffffffff],
};

/** Element type of the array (or nullable array) at T[K]. */
type Elem<T, K extends keyof T> = NonNullable<T[K]> extends readonly (infer E)[] ? E : never;

type Rec = Record<PropertyKey, unknown>;

export class Io {
  private bytes: Uint8Array;
  private view: DataView;
  private pos = 0;

  private constructor(
    readonly reading: boolean,
    bytes: Uint8Array,
  ) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  static reader(bytes: Uint8Array): Io {
    return new Io(true, bytes);
  }

  static writer(): Io {
    return new Io(false, new Uint8Array(1 << 16));
  }

  get offset(): number {
    return this.pos;
  }

  get length(): number {
    return this.bytes.length;
  }

  /** The bytes written so far (write mode). */
  result(): Uint8Array {
    return this.bytes.slice(0, this.pos);
  }

  private reserve(n: number): void {
    if (this.reading) {
      if (this.pos + n > this.bytes.length) {
        throw new Error(`dat: read of ${n} bytes past end at offset ${this.pos}`);
      }
      return;
    }
    if (this.pos + n <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.pos));
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }

  /** Reads a number, or writes `value` and returns it. */
  num(kind: NumKind, value?: unknown): number {
    this.reserve(SIZE[kind]);
    const at = this.pos;
    this.pos += SIZE[kind];
    const v = this.view;
    if (this.reading) {
      switch (kind) {
        case 'u8': return v.getUint8(at);
        case 'i8': return v.getInt8(at);
        case 'i16': return v.getInt16(at, true);
        case 'u16': return v.getUint16(at, true);
        case 'i32': return v.getInt32(at, true);
        case 'u32': return v.getUint32(at, true);
        case 'f32': return v.getFloat32(at, true);
      }
    }
    if (typeof value !== 'number') throw new Error(`dat: expected a number at offset ${at}, got ${String(value)}`);
    if (kind === 'f32') {
      if (!Object.is(Math.fround(value), value)) throw new Error(`dat: ${value} is not a float32`);
      v.setFloat32(at, value, true);
      return value;
    }
    const [min, max] = RANGE[kind];
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`dat: ${value} does not fit ${kind}`);
    }
    switch (kind) {
      case 'u8': v.setUint8(at, value); break;
      case 'i8': v.setInt8(at, value); break;
      case 'i16': v.setInt16(at, value, true); break;
      case 'u16': v.setUint16(at, value, true); break;
      case 'i32': v.setInt32(at, value, true); break;
      case 'u32': v.setUint32(at, value, true); break;
    }
    return value;
  }

  /** A count stored ahead of its items: reads it, or writes `current()`. */
  size(kind: NumKind, current: () => number): number {
    return this.num(kind, this.reading ? undefined : current());
  }

  field<T>(o: T, k: KeysOf<T, number>, kind: NumKind): void {
    const r = o as Rec;
    r[k] = this.num(kind, r[k]);
  }

  u8<T>(o: T, k: KeysOf<T, number>): void { this.field(o, k, 'u8'); }
  i8<T>(o: T, k: KeysOf<T, number>): void { this.field(o, k, 'i8'); }
  i16<T>(o: T, k: KeysOf<T, number>): void { this.field(o, k, 'i16'); }
  u16<T>(o: T, k: KeysOf<T, number>): void { this.field(o, k, 'u16'); }
  i32<T>(o: T, k: KeysOf<T, number>): void { this.field(o, k, 'i32'); }
  u32<T>(o: T, k: KeysOf<T, number>): void { this.field(o, k, 'u32'); }
  f32<T>(o: T, k: KeysOf<T, number>): void { this.field(o, k, 'f32'); }

  /** A fixed array of `n` numbers. */
  nums<T>(o: T, k: KeysOf<T, number[]>, kind: NumKind, n: number): void {
    const r = o as Rec;
    const arr = this.reading ? new Array<number>(n) : (r[k] as number[]);
    if (!this.reading && arr.length !== n) throw new Error(`dat: ${String(k)} must have ${n} items, has ${arr.length}`);
    for (let i = 0; i < n; i++) arr[i] = this.num(kind, arr[i]);
    r[k] = arr;
  }

  /**
   * A latin1 string in a field of `len` bytes, cut at the first NUL when read and
   * NUL-padded when written.
   */
  str<T>(o: T, k: KeysOf<T, string>, len: number): void {
    const r = o as Rec;
    this.reserve(len);
    const at = this.pos;
    this.pos += len;
    if (this.reading) {
      let s = '';
      for (let i = 0; i < len; i++) {
        const c = this.bytes[at + i]!;
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      r[k] = s;
      return;
    }
    const s = r[k];
    if (typeof s !== 'string' || s.length > len) throw new Error(`dat: ${String(k)} must be a string of at most ${len} chars`);
    for (let i = 0; i < len; i++) {
      const c = i < s.length ? s.charCodeAt(i) : 0;
      if (c > 0xff) throw new Error(`dat: ${String(k)} is not latin1`);
      this.bytes[at + i] = c;
    }
  }

  /** `n` records, each read into a fresh object or written from the existing array. */
  list<T, K extends KeysOf<T, readonly unknown[]>>(o: T, k: K, n: number, item: (io: Io, v: Elem<T, K>) => void): void {
    type I = Elem<T, K>;
    const r = o as Rec;
    const arr = this.reading ? [] : (r[k] as I[]);
    if (!this.reading && arr.length !== n) throw new Error(`dat: ${String(k)} must have ${n} items, has ${arr.length}`);
    for (let i = 0; i < n; i++) {
      if (this.reading) arr.push({} as I);
      item(this, arr[i]!);
    }
    r[k] = arr;
  }

  /** One nested record, created empty in read mode. */
  sub<T, K extends KeysOf<T, object>>(o: T, k: K, item: (io: Io, v: NonNullable<T[K]>) => void): void {
    const r = o as Rec;
    if (this.reading) r[k] = {};
    else if (r[k] === undefined) throw new Error(`dat: ${String(k)} is missing`);
    item(this, r[k] as NonNullable<T[K]>);
  }

  /**
   * Records behind a table of 32-bit pointers saved from memory: a zero pointer means
   * the slot is empty (null) and has no record in the file.
   */
  pointed<T, K extends KeysOf<T, readonly unknown[]>>(
    o: T,
    k: K,
    pointers: number[],
    item: (io: Io, v: NonNullable<Elem<T, K>>) => void,
  ): void {
    type I = NonNullable<Elem<T, K>>;
    const r = o as Rec;
    const arr = this.reading ? [] : (r[k] as (I | null)[]);
    if (!this.reading && arr.length !== pointers.length) {
      throw new Error(`dat: ${String(k)} must have ${pointers.length} slots, has ${arr.length}`);
    }
    for (let i = 0; i < pointers.length; i++) {
      if (this.reading) {
        arr.push(pointers[i] === 0 ? null : ({} as I));
      } else if ((pointers[i] === 0) !== (arr[i] === null)) {
        throw new Error(`dat: ${String(k)}[${i}] must be null exactly when its pointer is 0`);
      }
      const v = arr[i];
      if (v !== null && v !== undefined) item(this, v);
    }
    r[k] = arr;
  }
}
