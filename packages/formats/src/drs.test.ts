import { describe, expect, test } from 'vitest';
import { DrsArchive } from './drs';
import { buildDrs } from './fixtures';

describe('DrsArchive', () => {
  const bytes = buildDrs([
    { type: 'slp', id: 7, data: [1, 2, 3] },
    { type: 'bina', id: 50500, data: [9, 8] },
    { type: 'slp', id: 2, data: [4, 5, 6, 7] },
    { type: 'wav', id: 7, data: [0xaa] },
  ]);
  const drs = DrsArchive.parse(bytes);

  test('reads header and table types', () => {
    expect(drs.version).toBe('1.00');
    expect(drs.kind).toBe('tribe');
    expect(new Set(drs.entries.map((e) => e.type))).toEqual(new Set(['slp', 'bina', 'wav']));
  });

  test('looks files up by type and id', () => {
    expect([...(drs.read('slp', 7) ?? [])]).toEqual([1, 2, 3]);
    expect([...(drs.read('slp', 2) ?? [])]).toEqual([4, 5, 6, 7]);
    expect([...(drs.read('bina', 50500) ?? [])]).toEqual([9, 8]);
    expect([...(drs.read('wav', 7) ?? [])]).toEqual([0xaa]);
  });

  test('the same id under another type is a different file; missing ids are undefined', () => {
    expect(drs.read('bina', 7)).toBeUndefined();
    expect(drs.read('slp', 99)).toBeUndefined();
    expect(drs.find('slp', 2)?.size).toBe(4);
  });

  test('lists the ids of one type', () => {
    expect(drs.list('slp').map((e) => e.id).sort()).toEqual([2, 7]);
  });

  test('rejects truncated or foreign data', () => {
    expect(() => DrsArchive.parse(new Uint8Array(10))).toThrow(/shorter/);
    expect(() => DrsArchive.parse(new Uint8Array(0x80))).toThrow(/copyright/);
    expect(() => DrsArchive.parse(bytes.subarray(0, bytes.length - 2))).toThrow(/past end/);
  });
});
