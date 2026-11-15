import { expect, test } from 'vitest';
import { alignBuilding, wallOutline } from './placement';

test('a whole radius centres the building on a tile corner, a half radius on a tile middle', () => {
  expect(alignBuilding(1, 1, 10.3, 12.8, 64, 64)).toEqual({ x: 10, y: 13 });
  expect(alignBuilding(1.5, 1.5, 10.3, 12.8, 64, 64)).toEqual({ x: 10.5, y: 12.5 });
  expect(alignBuilding(1.5, 1.5, 10.5, 12.5, 64, 64)).toEqual({ x: 10.5, y: 12.5 });
});

test('a building is kept inside the map', () => {
  expect(alignBuilding(1, 1, 0.2, 63.9, 64, 64)).toEqual({ x: 1, y: 63 });
  expect(alignBuilding(1.5, 1.5, 0, 0, 64, 64)).toEqual({ x: 1.5, y: 1.5 });
});

test('a wall drag outlines the tiles of the line command, ends and corners facet 2 (draw_multi_object_outline)', () => {
  const key = (t: { col: number; row: number; facet: number }[]) => t.map((s) => `${s.col},${s.row}:${s.facet}`);
  expect(key(wallOutline(5, 5, 5, 5))).toEqual(['5,5:2']);
  expect(key(wallOutline(10, 4, 7, 4))).toEqual(['10,4:2', '9,4:0', '8,4:0', '7,4:2']);
  expect(key(wallOutline(3, 2, 3, 5))).toEqual(['3,2:2', '3,3:1', '3,4:1', '3,5:2']);
  expect(key(wallOutline(2, 2, 5, 5))).toEqual(['2,2:2', '3,3:2', '4,4:2', '5,5:2']);
  expect(key(wallOutline(5, 2, 3, 4))).toEqual(['5,2:2', '4,3:2', '3,4:2']);
  // Longer down: the start column to the end row, then along the end row from the tile after the corner.
  expect(key(wallOutline(4, 1, 6, 5))).toEqual(['4,1:2', '4,2:1', '4,3:1', '4,4:1', '4,5:2', '5,5:0', '6,5:2']);
  // Longer across: the start row to the end column, then down the end column.
  expect(key(wallOutline(8, 6, 4, 4))).toEqual(['8,6:2', '7,6:0', '6,6:0', '5,6:0', '4,6:2', '4,5:1', '4,4:2']);
});
