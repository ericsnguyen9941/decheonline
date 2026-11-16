import { TileMap } from '@aoe/sim';
import { expect, test } from 'vitest';
import { ELEV_H, Ground, raisedTop, tileBoxHeight, tileCorners, tileMapCoords, tilePicture, tileShade, tileType } from './elevation';
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
        // The sim's float32 `TileMap.groundZ`, the very value it gives a ground object's z there.
        expect(ground.z(col + rx, row + ry)).toBe(map.groundZ(col + rx, row + ry));
        expect(ground.z(col + rx, row + ry)).toBeCloseTo(map.elevationAt(col, row) + decompRz(type, rx, ry), 5);
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

test('the building being placed is drawn where get_tile_screen_coords puts it: y_delta, the drop, the flat place in the tile', () => {
  const flat = new Ground(new TileMap(10, 10));
  for (const [x, y, r] of [[4, 5, 1.5], [4.5, 2.5, 0.5], [7, 1, 1]] as const) expect(flat.placePixel(x, y, r, r)).toEqual(flat.pixel(x, y));
  const map = hill(3);
  const ground = new Ground(map);
  const seen = new Set<number>();
  for (let row = 1; row < 15; row++) {
    for (let col = 1; col < 15; col++) {
      const type = ground.type(col, row);
      seen.add(type);
      // A 3x3 building aligns to a tile corner: the tile's left corner, drawn at the tile's height, one level higher on
      // types 3, 5, 6 and 11 (y_delta, the drop's 8 and its elev_height cancel out on every other type).
      const lift = map.elevationAt(col, row) + ([3, 5, 6, 11].includes(type) ? 1 : 0);
      const at = ground.placePixel(col, row, 1.5, 1.5);
      const flatAt = tileCoordsToPixel(col, row, map.width);
      expect([type, at.x, at.y]).toEqual([type, flatAt.x, flatAt.y - lift * ELEV_H]);
    }
  }
  expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('the view centres on a point at its flat place, 16 px higher on a raised-top tile, as RGE_View::update does', () => {
  const map = hill(3);
  const ground = new Ground(map);
  const flat = (x: number, y: number) => tileCoordsToPixel(x, y, map.width);
  // The plateau top (level 3, type 0) is not lifted: the view ignores the height.
  expect(ground.type(8, 8)).toBe(0);
  expect(ground.viewPixel(8.5, 8.5)).toEqual(flat(8.5, 8.5));
  for (let row = 1; row < 15; row++) {
    for (let col = 1; col < 15; col++) {
      const lift = raisedTop(ground.type(col, row)) ? ELEV_H : 0;
      const f = flat(col + 0.5, row + 0.5);
      expect(ground.viewPixel(col + 0.5, row + 0.5)).toEqual({ x: f.x, y: f.y - lift });
    }
  }
  // set_view_loc keeps the point on the map; the fraction is truncated to whole pixels.
  expect(ground.viewPixel(-3, 20)).toEqual(ground.viewPixel(0, 15));
  expect(ground.viewPixel(2.01, 3)).toEqual({ x: flat(2, 3).x, y: flat(2, 3).y });
});

test('viewPoint reads a centre point back from its view pixel, also on a raised-top tile', () => {
  const map = hill(3);
  const ground = new Ground(map);
  let raised = 0;
  for (let row = 1; row < 15; row++) {
    for (let col = 1; col < 15; col++) {
      const p = ground.viewPixel(col + 0.5, row + 0.5);
      const back = ground.viewPoint(p.x, p.y);
      if (raisedTop(ground.type(col, row))) {
        raised++;
        expect([Math.floor(back.col), Math.floor(back.row)]).toEqual([col, row]);
        // Read as flat, as the minimap did, the same pixel is the tile one row further.
        const flat = pixelToTileCoords(p.x, p.y, map.width);
        expect([Math.floor(flat.col), Math.floor(flat.row)]).not.toEqual([col, row]);
      }
    }
  }
  expect(raised).toBeGreaterThan(10);
  const flatMap = new Ground(new TileMap(10, 10));
  expect(flatMap.viewPoint(320, 100)).toEqual(pixelToTileCoords(320, 100, 10));
});

/**
 * `view_function` mode 0x28 over every tile in draw order (src/view.cpp:1781): the last tile `hit_tile` hits, with where the
 * pixel is in its box and whether on the surface (the drawn shape).
 */
function lastHit(ground: Ground, px: number, py: number, boxTerrains: ReadonlySet<number>) {
  const { map } = ground;
  let best: { col: number; row: number; rank: number; type: number; x: number; y: number; onSurface: boolean } | null = null;
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const box = ground.tileBox(col, row);
      const [x, y] = [px - box.x, py - box.y];
      if (x < 0 || x >= 64 || y < 0 || y >= box.h) continue;
      const type = ground.type(col, row);
      const c = tileCorners(type);
      const halves = [3, 4, 9, 10, 15, 16].includes(type) ? [[0, 2, 3], [0, 1, 3]] : [[0, 1, 2], [1, 2, 3]];
      const onSurface = halves.some(([a, b, d]) => {
        const [p0, p1, p2] = [c[a!]!, c[b!]!, c[d!]!];
        const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
        const u = ((x - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (y - p0[1])) / det;
        const v = ((p1[0] - p0[0]) * (y - p0[1]) - (x - p0[0]) * (p1[1] - p0[1])) / det;
        return u >= 0 && v >= 0 && u + v <= 1;
      });
      if (!onSurface && !boxTerrains.has(map.terrainAt(col, row))) continue;
      const rank = ground.rank[row * map.width + col]!;
      if (!best || rank > best.rank) best = { col, row, rank, type, x, y, onSurface };
    }
  }
  return best;
}

test('a click picks the last tile in draw order that hit_tile hits: the drawn shape, or the whole box for a terrain with no SLP', () => {
  const map = hill(3);
  // Terrain 2 (Beach) has no SLP of its own in the dat: the tiles of the south-east flank are beach.
  for (let row = 0; row < 16; row++) for (let col = 0; col < 16; col++) if (col + row > 17) map.setTile(col, row, 2, map.elevationAt(col, row));
  const boxTerrains = new Set([2]);
  const shaped = new Ground(map);
  const boxed = new Ground(map, boxTerrains);
  let differs = 0;
  let offSurface = 0;
  for (let py = 100.37; py < 700; py += 3) {
    for (let px = 150.61; px < 1000; px += 3) {
      for (const [ground, box] of [[shaped, new Set<number>()], [boxed, boxTerrains]] as const) {
        const want = lastHit(ground, px, py, box);
        const got = ground.pointAt(px, py);
        if (!want) continue;
        if (want.onSurface) {
          expect([px, py, Math.floor(got.col), Math.floor(got.row)]).toEqual([px, py, want.col, want.row]);
        } else {
          // Off the surface, in a beach tile's box: `tile_map_coords`' point in that tile.
          offSurface++;
          const [rx, ry] = tileMapCoords(want.type, want.x, want.y);
          expect(got.col).toBeCloseTo(want.col + rx, 9);
          expect(got.row).toBeCloseTo(want.row + ry, 9);
        }
      }
      const a = shaped.pointAt(px, py);
      const b = boxed.pointAt(px, py);
      if (Math.floor(a.col) !== Math.floor(b.col) || Math.floor(a.row) !== Math.floor(b.row)) differs++;
    }
  }
  // Somewhere in the beach's boxes, the box picks a tile the drawn shape does not.
  expect(offSurface).toBeGreaterThan(100);
  expect(differs).toBeGreaterThan(0);
});

test('tile_map_coords: exact on flat tiles, the box corner of a flat tile is the flat projection', () => {
  expect(tileMapCoords(0, 32, 0)).toEqual([1, 0]);
  expect(tileMapCoords(0, 0, 16)).toEqual([0, 0]);
  expect(tileMapCoords(0, 32, 32)).toEqual([0, 1]);
  expect(tileMapCoords(0, 64, 16)).toEqual([1, 1]);
  const [rx, ry] = tileMapCoords(0, 2, 1);
  expect([rx, ry]).toEqual([2 / 64 - 1 / 32 + 0.5, 2 / 64 + 1 / 32 - 0.5]);
});
