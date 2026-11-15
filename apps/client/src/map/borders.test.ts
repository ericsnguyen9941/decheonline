import { TileMap } from '@aoe/sim';
import { expect, test } from 'vitest';
import type { BorderLayout, TerrainRules } from '../assets/provider';
import { borderPicture, tileBorders, tileDraw } from './borders';
import { Ground } from './elevation';

const GRASS = 0;
const WATER = 1;
const BEACH = 2;
const THIN_RIVER = 3;
const DESERT = 6;
const FOREST = 10;

/** The real dat's terrains (terrain_to_draw, borders by neighbour) for the ids the tests use. */
const RULES: Record<number, TerrainRules> = {
  [GRASS]: { draw: -1, borders: table({ [WATER]: 3, [BEACH]: 6, 4: 3, [DESERT]: 6 }) },
  [WATER]: { draw: -1, borders: table({}) },
  [BEACH]: { draw: 6, borders: table({ [WATER]: 2, 4: 2 }) },
  [THIN_RIVER]: { draw: -1, borders: table({}) },
  [DESERT]: { draw: -1, borders: table({}) },
  [FOREST]: { draw: 0, borders: table({ [BEACH]: 6, [DESERT]: 6 }) },
};

function table(entries: Record<number, number>): number[] {
  return Array.from({ length: 32 }, (_, t) => entries[t] ?? 0);
}

/** The real dat's style 0 picture table (borders 1-5): 12 shapes on a flat tile, two on each slope type. */
function style0(drawTile = 0): BorderLayout {
  const slopes: Record<number, [number, number]> = { 5: [11, 12], 6: [9, 10], 7: [9, 10], 8: [11, 12], 9: [2, 7], 10: [3, 6], 11: [4, 5], 12: [1, 8], 13: [3, 6], 14: [2, 7], 15: [4, 5], 16: [1, 8] };
  let next = 12;
  const pictures = Array.from({ length: 19 }, (_, type) =>
    Array.from({ length: 12 }, (_, s): [number, number, number] => {
      if (type === 0) return [1, 1, s];
      return slopes[type]?.includes(s + 1) ? [1, 1, next++] : [0, 0, next];
    }),
  );
  return { style: 0, drawTile, pictures };
}

/** The real dat's style 1 table (Grass/desert2): four edge pictures per tile type. */
const STYLE1: BorderLayout = {
  style: 1,
  drawTile: 0,
  pictures: Array.from({ length: 19 }, (_, type) => Array.from({ length: 12 }, (_, s): [number, number, number] => (s < 4 && type < 17 ? [1, 1, type * 4 + s] : [0, 0, 0]))),
};

const LOADED: Record<number, BorderLayout> = { 2: style0(), 3: style0(), 6: STYLE1 };

function bordersOf(map: TileMap) {
  return tileBorders(map, (t) => RULES[t] ?? null, (b) => LOADED[b] ?? null);
}

function mapOf(rows: string[]): TileMap {
  const key: Record<string, number> = { g: GRASS, w: WATER, b: BEACH, r: THIN_RIVER, d: DESERT, f: FOREST };
  const map = new TileMap(rows[0]!.length, rows.length);
  rows.forEach((line, row) => [...line].forEach((c, col) => map.setTile(col, row, key[c]!)));
  return map;
}

test('get_border_type: a grass tile by water takes the grass/water border, its shape the side or corner the water is on', () => {
  const map = mapOf([
    'gwggg',
    'ggggw',
    'ggggg',
    'wgggg',
    'wwggg',
  ]);
  const b = bordersOf(map);
  const at = (col: number, row: number) => [b.type[row * map.width + col], b.shape[row * map.width + col]];
  expect(at(1, 1)).toEqual([3, 9]); // water above (row - 1)
  expect(at(0, 1)).toEqual([3, 6]); // (1, 0) is up-right: a corner
  expect(at(2, 1)).toEqual([3, 5]); // (1, 0) is up-left
  expect(at(2, 4)).toEqual([3, 11]); // water left
  expect(at(1, 3)).toEqual([3, 3]); // water left (0, 3) and below (1, 4)
  expect(at(3, 1)).toEqual([3, 12]); // water right
  expect(at(1, 0)).toEqual([0, 0]); // water itself draws no border
  expect(at(3, 3)).toEqual([0, 0]);
});

test('get_border_type: a neighbour the terrain has no border against counts as its own terrain', () => {
  // The thin river above is skipped (grass has no border against it); the water below picks the border.
  const b = bordersOf(mapOf(['grg', 'ggg', 'gwg']));
  expect([b.type[4], b.shape[4]]).toEqual([3, 10]);
  expect([b.type[1], b.shape[1]]).toEqual([0, 0]);
});

test('get_border_type: a style 1 border sets a bit per side (top 1, bottom 2, left 4, right 8), 0 for a corner alone', () => {
  const b = bordersOf(mapOf(['ggg', 'ggd', 'gdg']));
  expect([b.type[4], b.shape[4]]).toEqual([6, 2 + 8]);
  // Desert only on the bottom-right corner: the border is set, with no side to draw.
  const corner = bordersOf(mapOf(['ggg', 'ggg', 'ggd']));
  expect([corner.type[4], corner.shape[4]]).toEqual([6, 0]);
});

test('terrain_to_draw does not change the borders: a beach tile by water takes the beach/water border', () => {
  const b = bordersOf(mapOf(['bw', 'bb']));
  expect([b.type[0], b.shape[0]]).toEqual([2, 12]);
  // A forest tile (drawn as grass) by beach gets the grass/desert2 edges.
  const f = bordersOf(mapOf(['fb', 'ff']));
  expect([f.type[0], f.shape[0]]).toEqual([6, 8]);
});

test('get_border_picture: borders[tile_type][shape - 1]; a slope type has pictures for its own two shapes only', () => {
  const layout = style0();
  expect(borderPicture(layout, 0, 1, 3, 4)).toBe(0);
  expect(borderPicture(layout, 0, 12, 3, 4)).toBe(11);
  expect(borderPicture(layout, 5, 11, 0, 0)).toBe(12);
  expect(borderPicture(layout, 5, 12, 0, 0)).toBe(13);
  expect(borderPicture(layout, 5, 9, 0, 0)).toBe(-1);
  expect(borderPicture(STYLE1, 2, 3, 0, 0)).toBe(10);
  // Shape 9 and 10 vary by column, 11 and 12 by row, when the entry has more than one picture.
  const varied: BorderLayout = { style: 0, drawTile: 0, pictures: [Array.from({ length: 12 }, (): [number, number, number] => [3, 1, 20])] };
  expect(borderPicture(varied, 0, 9, 4, 7)).toBe(21);
  expect(borderPicture(varied, 0, 11, 4, 7)).toBe(21);
  expect(borderPicture(varied, 0, 11, 4, 8)).toBe(22);
  expect(borderPicture(varied, 0, 1, 4, 8)).toBe(20);
});

test('draw_tile: a style 0 picture replaces the terrain unless draw_tile; style 1 edges go over it, top, left, right, bottom', () => {
  expect(tileDraw(style0(), 0, 9, 0, 0)).toEqual({ terrain: false, borders: [8] });
  expect(tileDraw(style0(1), 0, 9, 0, 0)).toEqual({ terrain: true, borders: [8] });
  // No picture for that shape on that slope: the terrain alone.
  expect(tileDraw(style0(), 5, 9, 0, 0)).toEqual({ terrain: true, borders: [] });
  expect(tileDraw(STYLE1, 0, 1 | 2 | 4 | 8, 0, 0)).toEqual({ terrain: true, borders: [0, 2, 1, 3] });
  expect(tileDraw(STYLE1, 1, 8, 0, 0)).toEqual({ terrain: true, borders: [5] });
  expect(tileDraw(STYLE1, 0, 0, 0, 0)).toEqual({ terrain: true, borders: [] });
  expect(tileDraw(null, 0, 0, 0, 0)).toEqual({ terrain: true, borders: [] });
});

test('a click on a bordered tile, flat or on a slope, picks the tile whose border is drawn there', () => {
  // A shore on a hillside: grass at level 1 over water at level 0 below it.
  const map = new TileMap(8, 8);
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) map.setTile(col, row, row >= 5 ? WATER : GRASS, row <= 3 ? 1 : 0);
  const ground = new Ground(map);
  const b = bordersOf(map);
  for (const [col, row] of [[3, 4], [2, 4], [5, 4]] as const) {
    const i = row * map.width + col;
    expect(b.type[i]).toBe(3);
    // The tile's picture (terrain or border) is drawn in its own box at its slope: the pick at its middle is that tile.
    const middle = ground.pixel(col + 0.5, row + 0.5);
    const picked = ground.pointAt(middle.x, middle.y);
    expect([Math.floor(picked.col), Math.floor(picked.row)]).toEqual([col, row]);
  }
  expect(ground.type(3, 4)).not.toBe(0);
});
