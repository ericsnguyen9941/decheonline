import { describe, expect, test } from 'vitest';
import { generateCliffs, wrapCliffDirection, type CliffsInfo } from './rmm-cliffs';
import { TERRAIN_CLIFF } from './rmm-map';
import { rmmFixture } from './rmm-testing';

const TERRAIN_WATER = 1;

/** Every (piece, facet) of the cliff table (src/tmap.cpp:40-59). */
const PIECES = new Set(
  [
    [0x108, [0x10, 0x12, 0x11, 0x13, 3, 0xf, 4, 5, 1, 2]],
    [0x109, [0x16, 0x17, 8, 7]],
    [0x10a, [0x14, 0x15, 0xb, 10]],
    [0x10b, [0xc]],
    [0x10c, [6]],
    [0x10d, [0xe]],
    [0x10e, [0]],
    [0x10f, [0xd]],
    [0x110, [9]],
  ].flatMap(([id, facets]) => (facets as number[]).map((f) => `${id as number}/${f}`)),
);

/** The controller's cliffs for a 96-wide map (random-maps.md §9.4) with the given hot spots. */
function info(hotSpots: CliffsInfo['hotSpots'] = []): CliffsInfo {
  return { count: 4, countVariance: 0, averageSize: 8, sizeVariance: 4, terrainSpacing: 2, cliffSpacing: 2, hotSpots };
}

describe('Cliffs::check_for_valid_cliff_site direction wrap (src/rmm_clif.cpp:242-249)', () => {
  test('wraps by 3, not 4', () => {
    expect([0, 1, 2, 3, 4, 5, -1, -2].map(wrapCliffDirection)).toEqual([0, 1, 2, 3, 1, 2, 2, 1]);
  });
});

describe('Cliffs::generate (src/rmm_clif.cpp:15)', () => {
  const run = (seed: number, water = false, hotSpots: CliffsInfo['hotSpots'] = []) => {
    const f = rmmFixture(96, 96, seed);
    if (water) for (let y = 0; y < 96; y++) for (let x = 48; x < 96; x++) f.map.terrain[y * 96 + x] = TERRAIN_WATER;
    generateCliffs(f.m, f.stack, f.search, info(hotSpots));
    return f;
  };

  test('cliffs are impassable grass with table pieces on the cell centres', () => {
    const f = run(41);
    const pieces = f.world.objects;
    expect(pieces.length).toBeGreaterThan(4);
    for (const o of pieces) {
      expect(PIECES.has(`${o.type}/${o.facet}`), `${o.type}/${o.facet}`).toBe(true);
      for (const v of [o.x, o.y]) expect([1, 1.5, 2]).toContain(v - 3 * Math.floor(v / 3));
      // Every piece stands on cliff terrain.
      expect(f.map.terrain[Math.floor(o.y) * 96 + Math.floor(o.x)]).toBe(TERRAIN_CLIFF);
    }
    const cliff = f.map.terrain.filter((t) => t === TERRAIN_CLIFF).length;
    expect(cliff).toBeGreaterThan(8);
  });

  test('deterministic for a seed', () => {
    const a = run(7);
    const b = run(7);
    expect(Array.from(a.map.terrain)).toEqual(Array.from(b.map.terrain));
    expect(a.world.objects.map((o) => [o.type, o.facet, o.x, o.y])).toEqual(b.world.objects.map((o) => [o.type, o.facet, o.x, o.y]));
    expect(a.rng.rand()).toBe(b.rng.rand());
  });

  test('no cliff within the terrain spacing of water, nor near a hot spot', () => {
    for (const seed of [3, 5, 8]) {
      const f = run(seed, true, [{ x: 20, y: 20, radius: 16 }]);
      const t = f.map.terrain;
      expect(t.some((v) => v === TERRAIN_CLIFF), `seed ${seed}`).toBe(true);
      for (let i = 0; i < t.length; i++) {
        if (t[i] !== TERRAIN_CLIFF) continue;
        const cx = Math.trunc((i % 96) / 3);
        const cy = Math.trunc(Math.trunc(i / 96) / 3);
        // Water starts at cell 16, so cells 14 and 15 are within spacing 2. Hot spot (20,20) radius 16 drops the cells
        // within 16/3 + 2 = 7 of cell (6,6), so only cells x <= 13, y >= 14 are left.
        expect([cx, cy], `seed ${seed}`).toSatisfy(([x, y]: number[]) => x! <= 13 && y! >= 14);
      }
    }
  });
});
