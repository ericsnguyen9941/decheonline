import { expect, test } from 'vitest';
import { parseJascPalette, parsePalette } from './palette';

const jasc = (colours: number): string =>
  ['JASC-PAL', '0100', String(colours), ...Array.from({ length: colours }, (_, i) => `${i} ${255 - i} ${i % 7}`), ''].join('\r\n');

test('parses a JASC-PAL text palette from a string or bytes', () => {
  const pal = parseJascPalette(jasc(256));
  expect(pal.length).toBe(768);
  expect([...pal.subarray(3 * 10, 3 * 10 + 3)]).toEqual([10, 245, 3]);
  expect(parsePalette(new TextEncoder().encode(jasc(256)))).toEqual(pal);
});

test('accepts 768 raw RGB bytes and copies them', () => {
  const raw = Uint8Array.from({ length: 768 }, (_, i) => i & 0xff);
  const pal = parsePalette(raw);
  expect(pal).toEqual(raw);
  expect(pal).not.toBe(raw);
});

test('rejects malformed palettes', () => {
  expect(() => parseJascPalette('nope')).toThrow(/JASC-PAL/);
  expect(() => parseJascPalette(jasc(16))).toThrow(/256 colours/);
  expect(() => parseJascPalette(jasc(256).replace('10 245 3', '10 300 3'))).toThrow(/bad colour/);
});
