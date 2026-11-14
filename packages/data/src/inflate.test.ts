import { deflateRawSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { deflateStored, inflateRaw } from './inflate';

/** Deterministic test bytes: repetitive enough to compress, varied enough for dynamic codes. */
function sample(n: number): Uint8Array {
  const out = new Uint8Array(n);
  let s = 12345;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    out[i] = i % 7 === 0 ? (s >>> 24) : 'empires dat '.charCodeAt(i % 12);
  }
  return out;
}

test.each([0, 1, 6, 9])('inflates zlib output at level %i', (level) => {
  const data = sample(200_000);
  expect(inflateRaw(deflateRawSync(data, { level }))).toEqual(data);
});

test('inflates fixed-Huffman blocks', () => {
  const data = new TextEncoder().encode('abc');
  expect(inflateRaw(deflateRawSync(data, { strategy: 4 }))).toEqual(data);
});

test('stored blocks round-trip, including empty input and several blocks', () => {
  for (const n of [0, 1, 0xffff, 0x10000, 150_000]) {
    const data = sample(n);
    expect(inflateRaw(deflateStored(data))).toEqual(data);
  }
});

test('rejects truncated input', () => {
  const packed = deflateRawSync(sample(1000));
  expect(() => inflateRaw(packed.subarray(0, packed.length - 4))).toThrow(/inflate/);
});
