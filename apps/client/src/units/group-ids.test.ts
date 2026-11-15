import { expect, test } from 'vitest';
import { GroupIds } from './group-ids';

test('ids count up from 11 and are not reused while the counter has room', () => {
  const ids = new GroupIds();
  expect([ids.next([]), ids.next([]), ids.next([])]).toEqual([11, 12, 13]);
});

test('past 126 the used set is rebuilt from the groups in use and the first free id from 1 is taken', () => {
  const ids = new GroupIds();
  for (let i = 11; i <= 126; i++) expect(ids.next([])).toBe(i);
  // Groups 3 (a digit group), 11 and 13 still have members: 1 is free; the next search starts at 11 again, 12 then 14.
  expect(ids.next([3, 11, 13])).toBe(1);
  expect(ids.next([])).toBe(12);
  expect(ids.next([])).toBe(14);
});

test('with every id in use nothing is given', () => {
  const ids = new GroupIds();
  for (let i = 11; i <= 126; i++) ids.next([]);
  const all = Array.from({ length: 126 }, (_, i) => i + 1);
  expect(ids.next(all)).toBeNull();
});
