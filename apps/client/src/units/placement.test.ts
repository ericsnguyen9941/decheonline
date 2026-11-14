import { expect, test } from 'vitest';
import { alignBuilding } from './placement';

test('a whole radius centres the building on a tile corner, a half radius on a tile middle', () => {
  expect(alignBuilding(1, 1, 10.3, 12.8, 64, 64)).toEqual({ x: 10, y: 13 });
  expect(alignBuilding(1.5, 1.5, 10.3, 12.8, 64, 64)).toEqual({ x: 10.5, y: 12.5 });
  expect(alignBuilding(1.5, 1.5, 10.5, 12.5, 64, 64)).toEqual({ x: 10.5, y: 12.5 });
});

test('a building is kept inside the map', () => {
  expect(alignBuilding(1, 1, 0.2, 63.9, 64, 64)).toEqual({ x: 1, y: 63 });
  expect(alignBuilding(1.5, 1.5, 0, 0, 64, 64)).toEqual({ x: 1.5, y: 1.5 });
});
