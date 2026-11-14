import { describe, expect, test } from 'vitest';
import { buildPe } from './fixtures';
import { mergeStrings, readPeStrings } from './pe-strings';

describe('readPeStrings', () => {
  test('reads every string of the RT_STRING blocks by id', () => {
    const strings = readPeStrings(buildPe({ 0: 'zero', 15: 'fifteen', 16: 'sixteen', 5131: 'Villager', 10231: 'Egyptian' }));
    expect(Object.fromEntries(strings)).toEqual({ 0: 'zero', 15: 'fifteen', 16: 'sixteen', 5131: 'Villager', 10231: 'Egyptian' });
  });

  test('empty slots of a block are absent', () => {
    const strings = readPeStrings(buildPe({ 4097: 'Build' }));
    expect(strings.get(4097)).toBe('Build');
    expect(strings.has(4096)).toBe(false);
    expect(strings.size).toBe(1);
  });

  test('keeps the first language of a block', () => {
    expect(readPeStrings(buildPe({ 33: 'Food' }, { extraLanguage: true })).get(33)).toBe('Food');
  });

  test('reads non-ASCII UTF-16 text', () => {
    expect(readPeStrings(buildPe({ 7: 'Égypte' })).get(7)).toBe('Égypte');
  });

  test('rejects foreign or truncated data', () => {
    expect(() => readPeStrings(new Uint8Array(10))).toThrow(/past end/);
    expect(() => readPeStrings(new Uint8Array(0x80))).toThrow(/MZ/);
    const pe = buildPe({ 1: 'one' });
    expect(() => readPeStrings(pe.subarray(0, pe.length - 2))).toThrow(/past end/);
  });

  test('later tables override earlier ones', () => {
    const merged = mergeStrings(new Map([[1, 'a'], [2, 'b']]), new Map([[2, 'B'], [3, 'C']]));
    expect(Object.fromEntries(merged)).toEqual({ 1: 'a', 2: 'B', 3: 'C' });
  });
});
