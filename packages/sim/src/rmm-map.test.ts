import { describe, expect, test } from 'vitest';
import { TERRAIN_CLIFF } from './rmm-map';
import { afterDraws, nextDraws, rmmFixture } from './rmm-testing';
import { RANDOM_MAPS, TERRAIN_OBJECTS } from './unit-data';
import { unitType } from './units';

const TERRAIN_GRASS = 0;
const TERRAIN_WATER = 1;
const TERRAIN_FOREST = 10;
const W = 12;

const tiles = (terrain: Uint8Array, t: number) =>
  [...terrain.keys()].filter((i) => terrain[i] === t).map((i) => [i % W, Math.trunc(i / W)]);

describe('RGE_Map::clean_terrain (src/map.cpp:843)', () => {
  test('a one-tile strip between two replacement tiles is filled, a 3x3 block stays', () => {
    const f = rmmFixture(W, W, 1, TERRAIN_WATER);
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) f.map.terrain[y * W + x] = TERRAIN_GRASS;
    f.map.terrain[5 * W + 8] = TERRAIN_GRASS;
    for (let x = 1; x <= 8; x++) f.map.terrain[9 * W + x] = TERRAIN_GRASS;
    f.m.cleanTerrain(0, 0, W, W, TERRAIN_WATER);
    expect(tiles(f.map.terrain, TERRAIN_GRASS).length).toBe(9);
    expect(f.map.terrain[3 * W + 3]).toBe(TERRAIN_GRASS);
  });

  test('the second pass fills a tile that touches the replacement only diagonally across a corner', () => {
    const f = rmmFixture(W, W, 1, TERRAIN_GRASS);
    f.map.terrain[4 * W + 4] = TERRAIN_WATER;
    f.map.terrain[5 * W + 6] = TERRAIN_WATER;
    f.m.cleanTerrain(0, 0, W, W, TERRAIN_WATER);
    expect(tiles(f.map.terrain, TERRAIN_WATER)).toEqual([
      [4, 4],
      [5, 4],
      [5, 5],
      [6, 5],
    ]);
  });
});

describe('RGE_Map::get_tile_type (src/map.cpp:2268)', () => {
  test('the shape of each tile round a single raised tile', () => {
    const f = rmmFixture(W, W, 1);
    f.m.setHeight(5 * W + 5, 1);
    const shape = (x: number, y: number) => f.m.getTileType(x, y);
    expect(shape(5, 5)).toBe(0);
    expect(shape(0, 0)).toBe(0);
    expect([shape(5, 6), shape(4, 5), shape(6, 5), shape(5, 4)]).toEqual([6, 8, 5, 7]);
    expect([shape(4, 6), shape(6, 6), shape(4, 4), shape(6, 4)]).toEqual([0x0a, 0x0b, 0x0c, 9]);
  });

  test('two raised sides make a corner shape; a lower opposite pair makes a pit shape', () => {
    const f = rmmFixture(W, W, 1);
    f.m.setHeight(4 * W + 5, 1);
    f.m.setHeight(5 * W + 6, 1);
    expect(f.m.getTileType(5, 5)).toBe(0x0e);
    const g = rmmFixture(W, W, 1);
    g.m.setHeight(5 * W + 5, 1);
    g.m.setHeight(4 * W + 6, 2);
    g.m.setHeight(5 * W + 4, 0);
    g.m.setHeight(6 * W + 5, 0);
    expect(g.m.getTileType(5, 5)).toBe(2);
  });
});

describe('RGE_Map::clean_elevation (src/map.cpp:709) with preclean/postclean', () => {
  test('a spike of 2 gets a ring of 1 and the tile shapes are refreshed', () => {
    const f = rmmFixture(W, W, 1);
    f.m.setHeight(5 * W + 5, 2);
    f.m.cleanElevation(0, 0, W - 1, W - 1, 8);
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) expect(f.m.heightAt(x, y)).toBe(x === 5 && y === 5 ? 2 : 1);
    expect(f.m.heightAt(3, 5)).toBe(0);
    for (let i = 0; i < W * W; i++) expect(f.m.tileType[i]).toBe(f.m.getTileType(i % W, Math.trunc(i / W)));
  });

  test('a tile between two higher opposite neighbours is raised (below the level) or levels them (at it)', () => {
    const below = rmmFixture(W, W, 1);
    below.m.setHeight(5 * W + 4, 1);
    below.m.setHeight(5 * W + 6, 1);
    below.m.cleanElevation(0, 0, W - 1, W - 1, 8);
    expect(below.m.heightAt(5, 5)).toBe(1);
    const at = rmmFixture(W, W, 1);
    at.m.setHeight(5 * W + 4, 1);
    at.m.setHeight(5 * W + 6, 1);
    at.m.cleanElevation(0, 0, W - 1, W - 1, 0);
    expect([at.m.heightAt(4, 5), at.m.heightAt(5, 5), at.m.heightAt(6, 5)]).toEqual([0, 0, 0]);
  });
});

describe('RGE_Map::set_terrain (src/map.cpp:2140, :2187) and terrain objects', () => {
  test('the area form with no owner and set off does nothing and draws nothing', () => {
    const f = rmmFixture(W, W, 3);
    f.m.setTerrainArea(null, 0, 0, W - 1, W - 1, TERRAIN_FOREST, false, false);
    expect(f.map.terrain.every((t) => t === TERRAIN_GRASS)).toBe(true);
    expect(nextDraws(f.rng)).toEqual(nextDraws(afterDraws(3, 0)));
  });

  test("with an owner it places the terrain's objects; the one-tile form then clears the old terrain's", () => {
    const f = rmmFixture(W, W, 3);
    f.m.setTerrainArea(0, 2, 2, 8, 8, TERRAIN_FOREST, true, false);
    const forest = TERRAIN_OBJECTS[TERRAIN_FOREST]![0]!;
    expect(f.world.objects.length).toBeGreaterThan(10);
    for (const o of f.world.objects) {
      expect(forest).toContain(o.type);
      expect([o.x, o.y].every((v) => v >= 2 && v < 9)).toBe(true);
    }
    const i = f.m.tiles.findIndex((list) => list.length > 0);
    f.m.setTerrain(i % W, Math.trunc(i / W), TERRAIN_GRASS);
    expect(f.m.tiles[i]!.filter((o) => forest.includes(o.type))).toEqual([]);
  });

  test('object type 0 counts as listed for every terrain (the lookup reads one past the list, which is 0 in the dat)', () => {
    const f = rmmFixture(W, W, 3);
    const e = f.m.makeNewObj(0, 0, 5.5, 5.5);
    f.m.setTerrainArea(0, 5, 5, 5, 5, TERRAIN_FOREST, true, true);
    expect(f.world.objects).not.toContain(e);
  });
});

describe('RGE_Map::check_placement (src/map.cpp)', () => {
  test('7 off the map, 2 on terrain the type cannot stand on, 0 on open grass', () => {
    const f = rmmFixture(W, W, 1);
    const tree = unitType(TERRAIN_OBJECTS[TERRAIN_FOREST]![0]![0]!);
    expect(f.m.checkPlacement(tree, 0.1, 5.5, true, true, false, true)).toBe(7);
    expect(f.m.checkPlacement(tree, 5.5, 5.5, true, true, false, true)).toBe(0);
    f.map.terrain[5 * W + 5] = TERRAIN_WATER;
    expect(f.m.checkPlacement(tree, 5.5, 5.5, true, true, false, true)).toBe(2);
  });
});

describe('TRIBE_Map terrain and cliff brushes (src/tmap.cpp)', () => {
  test('a stroke from cell (2,2) to (3,2) paints cliff terrain and places the two end pieces', () => {
    const f = rmmFixture(30, 30, 1);
    f.m.terrainBrushStroke(7, 7, 10, 7, 1, TERRAIN_CLIFF);
    f.m.cliffBrushStroke(7, 7, 10, 7);
    expect(f.world.objects.map((o) => [o.type, o.facet, o.x, o.y])).toEqual([
      [264, 16, 7.5, 7.5],
      [264, 17, 10.5, 7.5],
    ]);
    for (let x = 7; x <= 10; x++) expect(f.map.terrain[7 * 30 + x]).toBe(TERRAIN_CLIFF);
  });
});

describe('random map tables (empires.dat)', () => {
  test('every land and base terrain has a frame for all 17 tile shapes, so the area set_terrain guard always passes', () => {
    // Shape frame counts read from the dat: terrains 3, 4, 5, 7, 8 and 9 have shape 0 only.
    const flatOnly = [3, 4, 5, 7, 8, 9];
    for (const map of RANDOM_MAPS) {
      expect(flatOnly).not.toContain(map.baseTerrain);
      for (const land of map.lands) expect(flatOnly).not.toContain(land[1]);
    }
  });
});
