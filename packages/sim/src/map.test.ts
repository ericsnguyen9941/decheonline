import { expect, test } from 'vitest';
import { Hasher } from './hash';
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
