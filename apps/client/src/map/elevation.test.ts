import { TileMap } from '@aoe/sim';
import { expect, test } from 'vitest';
import { ELEV_H, Ground, raisedTop, tileBoxHeight, tilePicture, tileShade, tileType } from './elevation';
import { pixelToTileCoords, tileCoordsToPixel } from './iso';

/** A 16x16 map with a square plateau of `level` over columns and rows 6-9 and a one-level ring round it. */
function hill(level = 2): TileMap {
  const map = new TileMap(16, 16);
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      const d = Math.max(Math.abs(col - 7.5), Math.abs(row - 7.5)) - 1.5;
      map.setTile(col, row, 0, Math.max(0, Math.min(level, Math.ceil(level - d + 0.5) - 1)));
    }
  }
  return map;
}

/** `teleport`'s `rz` (src/stat_obj.cpp:1539-1616), written out per type as the decomp has it: the oracle for `z`. */
function decompRz(type: number, rx: number, ry: number): number {
  switch (type) {
    case 1: return rx + ry < 1 ? ry : 1 - rx;
    case 2: return rx + ry < 1 ? rx : 1 - ry;
    case 3: return rx <= ry ? 1 - ry : 1 - rx;
    case 4: return rx <= ry ? rx : ry;
    case 5: return 1 - rx;
    case 6: return 1 - ry;
    case 7: return ry;
    case 8: return rx;
    case 9: return rx - ry < 0 ? ry - rx : 0;
    case 10: return rx - ry > 0 ? rx - ry : 0;
    case 11: return rx + ry < 1 ? 1 - (rx + ry) : 0;
    case 12: return rx + ry > 1 ? rx + ry - 1 : 0;
    case 13: return rx + ry < 1 ? 1 - rx : ry;
    case 14: return rx + ry < 1 ? 1 - ry : rx;
    case 15: return rx <= ry ? ry : rx;
    case 16: return rx <= ry ? 1 - rx : 1 - ry;
    default: return 0;
  }
}

test('tile types follow get_tile_type: the ring round a one-level plateau gets the slope shapes', () => {
  const map = new TileMap(5, 5);
  map.setTile(2, 2, 0, 1);
  // The higher tile's side neighbours slope up to one side, its corner neighbours to one corner.
  expect(tileType(map, 2, 3)).toBe(6); // n (row - 1) higher
  expect(tileType(map, 1, 2)).toBe(8); // e (col + 1) higher
  expect(tileType(map, 3, 2)).toBe(5); // w (col - 1) higher
  expect(tileType(map, 2, 1)).toBe(7); // s (row + 1) higher
  expect(tileType(map, 1, 3)).toBe(10); // nw (row - 1, col + 1) higher
  expect(tileType(map, 3, 1)).toBe(9); // sw (row + 1, col - 1) higher
  expect(tileType(map, 3, 3)).toBe(11); // ne (row - 1, col - 1) higher
  expect(tileType(map, 1, 1)).toBe(12); // se (row + 1, col + 1) higher
  expect(tileType(map, 2, 2)).toBe(0);
  expect(tileType(map, 0, 0)).toBe(0);
  // Two side neighbours higher make the three-corner shapes.
  const two = new TileMap(3, 3, null, [0, 1, 0, 1, 0, 0, 0, 0, 0]);
  expect(tileType(two, 0, 0)).toBe(15); // e and s higher
});

test('box heights and raised tops are init_tile_sizes and coordinate_map', () => {
  expect([...Array(17).keys()].map(tileBoxHeight)).toEqual([32, 16, 48, 32, 32, 16, 48, 16, 48, 16, 48, 32, 32, 16, 48, 32, 32]);
  expect([...Array(17).keys()].filter(raisedTop)).toEqual([2, 6, 8, 10, 14, 15, 16]);
  expect([...Array(17).keys()].filter((t) => tileShade(t) === 1)).toEqual([2, 3, 6, 10, 11, 14, 16]);
});

test('ground height on every slope is the tile height plus teleport\'s rz', () => {
  const map = hill();
  const ground = new Ground(map);
  const seen = new Set<number>();
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      const type = ground.type(col, row);
      seen.add(type);
      for (const [rx, ry] of [[0.1, 0.2], [0.7, 0.3], [0.25, 0.9], [0.5, 0.5], [0.95, 0.6]] as const) {
        expect(ground.z(col + rx, row + ry)).toBeCloseTo(map.elevationAt(col, row) + decompRz(type, rx, ry), 9);
      }
    }
  }
  // The ring's corners have lower neighbours too, which fold them the other way (types 1-4).
  expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('an object on a hill is drawn ELEV_H pixels higher per level, and that pixel picks its map point back', () => {
  const map = hill(3);
  const ground = new Ground(map);
  // On the plateau (level 3) and on the slopes facing the screen (south and east sides).
  for (const [x, y] of [[7.5, 7.5], [8.2, 6.4], [6.3, 10.6], [10.4, 8.8], [11.7, 11.2], [9.9, 11.5]] as const) {
    const flat = tileCoordsToPixel(x, y, map.width);
    const p = ground.pixel(x, y);
    expect(p.x).toBe(flat.x);
    expect(p.y).toBeCloseTo(flat.y - ground.z(x, y) * ELEV_H, 9);
    const back = ground.pointAt(p.x, p.y);
    expect(back.col).toBeCloseTo(x, 6);
    expect(back.row).toBeCloseTo(y, 6);
  }
  expect(ground.z(7.5, 7.5)).toBe(3);
});

test('a click on a raised tile picks that tile, not the flat tile under the pixel', () => {
  const map = hill(3);
  const ground = new Ground(map);
  const centre = ground.pixel(8.5, 8.5);
  const picked = ground.pointAt(centre.x, centre.y);
  expect([Math.floor(picked.col), Math.floor(picked.row)]).toEqual([8, 8]);
  // Read flat, the same pixel is 3 levels (48 px) up the screen: 1.5 tiles more column, 1.5 less row.
  const flat = pixelToTileCoords(centre.x, centre.y, map.width);
  expect([flat.col, flat.row]).toEqual([10, 7]);
});

test('where a raised tile covers the tile behind it, the front-most surface wins', () => {
  const map = new TileMap(8, 8);
  map.setTile(4, 4, 0, 1);
  const ground = new Ground(map);
  // The top corner of the raised tile, drawn 16 px up, lies over the tile behind it on the screen (3, 5)... (5, 3).
  const top = ground.pixel(5, 4);
  const below = ground.pointAt(top.x, top.y + 2);
  expect(Math.floor(below.col)).toBe(4);
  expect(Math.floor(below.row)).toBe(4);
  expect(ground.z(below.col, below.row)).toBeCloseTo(1, 1);
});

test('on a map without hills the ground is the flat projection', () => {
  const map = new TileMap(10, 12);
  const ground = new Ground(map);
  expect(ground.flat).toBe(true);
  for (const [px, py] of [[100, 50], [320.5, 177.25], [-20, 5], [700, 400]] as const) expect(ground.pointAt(px, py)).toEqual(pixelToTileCoords(px, py, map.width));
  expect(ground.pixel(3.25, 7.5)).toEqual(tileCoordsToPixel(3.25, 7.5, map.width));
  expect(ground.tileBox(2, 3)).toEqual({ x: (2 + 3) * 32, y: (3 - 2 + 9) * 16, h: 32 });
});

test('tiles draw in screen order: top screen row first, then left to right', () => {
  const ground = new Ground(new TileMap(3, 3));
  const at = (col: number, row: number) => ground.rank[row * 3 + col]!;
  // (2, 0) is the top corner, (0, 2) the bottom one; (0, 0) and (2, 2) share the middle row.
  expect(at(2, 0)).toBe(0);
  expect(at(0, 0)).toBeLessThan(at(1, 1));
  expect(at(1, 1)).toBeLessThan(at(2, 2));
  expect(at(0, 2)).toBe(8);
});

test('get_tile_picture: a slope draws its tiles[type] frame, a flat tile its variant', () => {
  // Grass (dat terrain 0): a 3x3 grid of 9 flat variants, then one frame per slope from 9.
  const grass = { rows: 3, cols: 3, tiles: [[9, 1, 0], ...Array.from({ length: 18 }, (_, i) => [1, 1, 9 + i] as const)] as const };
  expect(tilePicture(grass, 0, 4, 5)).toBe(2 * 3 + 1);
  expect(tilePicture(grass, 1, 4, 5)).toBe(9);
  expect(tilePicture(grass, 16, 0, 0)).toBe(24);
  // A layout without tile pictures (an old or partial pack) uses the flat grid.
  expect(tilePicture({ rows: 2, cols: 2, tiles: [] }, 6, 3, 1)).toBe(3);
});
