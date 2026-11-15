import { expect, test } from 'vitest';
import { Hasher } from './hash';
import { f32, sub32 } from './num';
import { createTestMap, TERRAIN_DESERT, TERRAIN_GRASS, TERRAIN_WATER, TERRAIN_WATER_DARK, TileMap } from './map';
import { World } from './world';

const mapHash = (m: TileMap) => {
  const h = new Hasher();
  m.hashInto(h);
  return h.digest();
};

test('the test map is fixed and has grass, desert, water and dark water', () => {
  const map = createTestMap();
  expect(mapHash(map)).toBe(mapHash(createTestMap()));
  expect([map.terrainAt(0, 0), map.terrainAt(47, 47), map.terrainAt(10, 28), map.terrainAt(16, 28)]).toEqual([
    TERRAIN_GRASS,
    TERRAIN_DESERT,
    TERRAIN_WATER,
    TERRAIN_WATER_DARK,
  ]);
  expect(map.elevation.every((e) => e === 0)).toBe(true);
});

test('changing a tile terrain or elevation changes the hash', () => {
  const map = createTestMap();
  const before = mapHash(map);
  map.setTile(3, 3, TERRAIN_DESERT);
  const terrainChanged = mapHash(map);
  expect(terrainChanged).not.toBe(before);
  map.setTile(3, 3, TERRAIN_DESERT, 1);
  expect(mapHash(map)).not.toBe(terrainChanged);
});

test('the world hash and snapshot carry the map', () => {
  const a = new World({ players: 3 });
  const b = new World({ players: 3 });
  expect(a.hash()).toBe(b.hash());
  b.map.setTile(5, 5, TERRAIN_WATER);
  expect(b.hash()).not.toBe(a.hash());
  const restored = World.restore(JSON.parse(JSON.stringify(b.snapshot())));
  expect(restored.map.terrainAt(5, 5)).toBe(TERRAIN_WATER);
  expect(restored.hash()).toBe(b.hash());
});

/** A 20 x 20 grass map with a one-level plateau over tiles 8-12 (both ways). */
function plateauMap(): TileMap {
  const map = new TileMap(20, 20);
  for (let row = 8; row <= 12; row++) for (let col = 8; col <= 12; col++) map.setTile(col, row, TERRAIN_GRASS, 1);
  return map;
}

test('ground height is the tile height plus teleport\'s rz on the slope round a plateau (stat_obj.cpp:1539-1610)', () => {
  const map = plateauMap();
  // Tile types round the plateau (get_tile_type): west edge 8 (e higher), east 5 (w), north 7 (s), south 6 (n), corners.
  expect([map.tileType(7, 10), map.tileType(13, 10), map.tileType(10, 7), map.tileType(10, 13)]).toEqual([8, 5, 7, 6]);
  expect([map.tileType(7, 7), map.tileType(13, 7), map.tileType(7, 13), map.tileType(13, 13), map.tileType(10, 10)]).toEqual([12, 9, 10, 11, 0]);
  expect(map.groundZ(10.5, 10.5)).toBe(1);
  expect(map.groundZ(3.5, 3.5)).toBe(0);
  // Type 8: rz = rx, rising toward the plateau; type 5: 1 - rx, falling away from it; 7: ry; 6: 1 - ry.
  expect(map.groundZ(7.25, 10.5)).toBe(0.25);
  expect(map.groundZ(13.25, 10.5)).toBe(0.75);
  expect(map.groundZ(10.5, 7.75)).toBe(0.75);
  expect(map.groundZ(10.5, 13.75)).toBe(0.25);
  // Corner 12: rx + ry - 1 above 1, else 0; corner 11: 1 - (rx + ry) below 1.
  expect([map.groundZ(7.75, 7.75), map.groundZ(7.25, 7.25)]).toEqual([0.5, 0]);
  expect([map.groundZ(13.25, 13.25), map.groundZ(13.75, 13.75)]).toEqual([0.5, 0]);
  // Float32 as the original: rx = x - (float)tx, not the double 0.3.
  expect(map.groundZ(7.3, 10.5)).toBe(sub32(f32(7.3), 7));
  // Off the map it clamps as teleport does (x < 0 -> 0, x >= width -> width - 0.001).
  expect([map.groundZ(-3, 10.5), map.groundZ(25, 10.5)]).toEqual([0, 0]);
});

test('a flat map has ground height 0 everywhere', () => {
  const map = createTestMap();
  for (const [x, y] of [[0, 0], [10.25, 20.75], [47.9, 47.9], [16.5, 28.5]] as const) expect(map.groundZ(x, y)).toBe(0);
});
