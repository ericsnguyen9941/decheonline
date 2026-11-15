import { describe, expect, it } from 'vitest';
import { TileMap } from './map';
import { MapStack } from './rmm-base';
import { RmmMap, isWater } from './rmm-map';
import { TerrainGenerator, hotSpotModifiers, type HotSpot, type TerrainRow } from './rmm-terrain';
import { CrtRand } from './rng';

const GRASS = 0;
const WATER = 1;
const BEACH = 2;
const DESERT = 6;
const FOREST = 10;
const PALM = 13;
const DEEP = 22;
const W = 96;
/** Two grass lands on water, as the land module leaves a 2-player MostlyLand map (centres of random-maps.md §9.2). */
const LANDS: [number, number][] = [
  [62, 10],
  [34, 84],
];
const HOT: HotSpot[] = LANDS.map(([x, y]) => ({ x, y, radius: 16, fade: 15 }));

/** Map 3's rows for W 96 after the forest variant (random-maps.md §9.4). */
const ROWS: TerrainRow[] = [
  { size: 2948, terrain: DESERT, clumps: 8, spacing: 1, base: GRASS, clumpiness: 20, avoid: 0 },
  { size: 663, terrain: PALM, clumps: 9, spacing: 3, base: DESERT, clumpiness: 20, avoid: 2 },
  { size: 258, terrain: FOREST, clumps: 4, spacing: 3, base: GRASS, clumpiness: 20, avoid: 2 },
  { size: 110, terrain: 20, clumps: 1, spacing: 3, base: GRASS, clumpiness: 20, avoid: 1 },
  { size: 110, terrain: 19, clumps: 1, spacing: 3, base: GRASS, clumpiness: 20, avoid: 1 },
  { size: 7371, terrain: DEEP, clumps: 12, spacing: 3, base: WATER, clumpiness: 20, avoid: 1 },
];

const noObjects = {
  master: () => null,
  create: () => {
    throw new Error('the terrain module makes no objects');
  },
  destroy: () => {},
  remove: () => {},
  complete: () => {},
  typeOf: () => {
    throw new Error('no objects');
  },
};

/** A hand-built land layout: each land a grass disc of radius 22 around its centre, the rest water. */
function landLayout(seed: number, radius = 22): { map: RmmMap; stack: MapStack; search: Uint8Array } {
  const tiles = new TileMap(W, W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const land = LANDS.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius);
      tiles.terrain[y * W + x] = land ? GRASS : WATER;
    }
  }
  const rng = new CrtRand();
  rng.srand(seed);
  return { map: new RmmMap(tiles, rng, noObjects), stack: new MapStack(W, W), search: new Uint8Array(W * W) };
}

function count(map: RmmMap, terrain: number): number {
  return map.terrain.reduce((n, t) => n + (t === terrain ? 1 : 0), 0);
}

describe('random map terrain module (rmm_terr.cpp)', () => {
  it('hot spot modifier: 101 up to distance 9, then fade × (radius − distance), 0 from the radius (§9.4)', () => {
    const search = new Uint8Array(W * W);
    hotSpotModifiers(search, W, W, [{ x: 40, y: 40, radius: 16, fade: 15 }]);
    const along = Array.from({ length: 18 }, (_, d) => search[40 * W + 40 + d]);
    expect(along).toEqual([101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 90, 75, 60, 45, 30, 15, 0, 0]);
    // Distance is truncated: (3, 15) is 15.29 away, so 15 × (16 − 15).
    expect(search[(40 + 15) * W + 40 + 3]).toBe(15);
    // Two hot spots add up before the cap.
    hotSpotModifiers(search, W, W, [
      { x: 10, y: 10, radius: 5, fade: 10 },
      { x: 16, y: 10, radius: 5, fade: 10 },
    ]);
    expect(search[10 * W + 13]).toBe(20 + 20);
  });

  it('check_terrain: 0 when the spacing square holds another terrain; else 1 + target tiles in the 5×5', () => {
    const { map, stack, search } = landLayout(1);
    const gen = new TerrainGenerator(map, stack, search, { rows: [], hotSpots: [] });
    const [cx, cy] = LANDS[0]!;
    expect(gen.checkTerrain(FOREST, cx, cy, 3, GRASS)).toBe(1);
    map.terrain[(cy + 2) * W + cx + 2] = FOREST;
    map.terrain[(cy - 2) * W + cx] = FOREST;
    map.terrain[(cy + 3) * W + cx] = FOREST;
    expect(gen.checkTerrain(FOREST, cx, cy, 3, GRASS)).toBe(3);
    // The base's impassable twin (grass → 16) is allowed in the spacing square, any other terrain is not.
    map.terrain[(cy - 3) * W + cx - 3] = 16;
    expect(gen.checkTerrain(FOREST, cx, cy, 3, GRASS)).toBe(3);
    map.terrain[(cy - 3) * W + cx + 3] = DESERT;
    expect(gen.checkTerrain(FOREST, cx, cy, 3, GRASS)).toBe(0);
    expect(gen.checkTerrain(FOREST, cx, cy, 2, GRASS)).toBe(3);
    // Spacing 0 skips the square test; the window clips at the map edge.
    expect(gen.checkTerrain(WATER, 0, 0, 0, GRASS)).toBe(1 + 9);
  });

  it('check_borders: every land tile with water among its 8 neighbours becomes beach, nothing else changes', () => {
    const { map, stack, search } = landLayout(1);
    const before = map.terrain.slice();
    new TerrainGenerator(map, stack, search, { rows: [], hotSpots: [] }).checkBorders();
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        let shore = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < W && isWater(before[ny * W + nx]!)) shore = true;
          }
        }
        const t = before[y * W + x]!;
        expect(map.terrain[y * W + x]).toBe(!isWater(t) && shore ? BEACH : t);
      }
    }
  });

  it('a forest row (avoid 2) grows on grass only, never at modifier 101, and seeds every land even with 1 clump', () => {
    const { map, stack, search } = landLayout(7);
    const before = map.terrain.slice();
    const row: TerrainRow = { size: 258, terrain: FOREST, clumps: 1, spacing: 3, base: GRASS, clumpiness: 20, avoid: 2 };
    new TerrainGenerator(map, stack, search, { rows: [row], hotSpots: HOT }).generate();
    const forest: [number, number][] = [];
    for (let i = 0; i < W * W; i++) {
      if (map.terrain[i] !== FOREST) continue;
      forest.push([i % W, Math.trunc(i / W)]);
      expect(before[i]).toBe(GRASS);
      expect(search[i]).toBeLessThan(101);
    }
    // Fairness: the two lands are separate grass zones, and each gets a clump.
    for (const [cx, cy] of LANDS) expect(forest.some(([x, y]) => (x - cx) ** 2 + (y - cy) ** 2 <= 22 * 22)).toBe(true);
    // The row grows to its size; only the horizontal one-tile gap fill can add more.
    expect(forest.length).toBeGreaterThanOrEqual(row.size);
    const gaps = forest.filter(([x, y]) => map.terrain[y * W + x - 1] === FOREST && map.terrain[y * W + x + 1] === FOREST);
    expect(forest.length - row.size).toBeLessThanOrEqual(gaps.length);
  });

  it('an avoid-0 row may grow inside the hot spots; an avoid-1 row never seeds where the modifier is not 0', () => {
    const near = (map: RmmMap, terrain: number) => {
      let n = 0;
      for (let i = 0; i < W * W; i++) {
        const [x, y] = [i % W, Math.trunc(i / W)];
        if (map.terrain[i] === terrain && LANDS.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 < 10 * 10)) n++;
      }
      return n;
    };
    const desert = landLayout(3);
    new TerrainGenerator(desert.map, desert.stack, desert.search, { rows: [ROWS[0]!], hotSpots: HOT }).generate();
    expect(near(desert.map, DESERT)).toBeGreaterThan(0);
    const pine = landLayout(3);
    const row = { ...ROWS[4]!, size: 600, clumps: 3 };
    new TerrainGenerator(pine.map, pine.stack, pine.search, { rows: [row], hotSpots: HOT }).generate();
    expect(count(pine.map, 19)).toBeGreaterThan(0);
    expect(near(pine.map, 19)).toBe(0);
  });

  it('map 3 rows: deep water keeps 3 tiles of water from land, palm grows on desert, beaches ring the lands', () => {
    const { map, stack, search } = landLayout(41, 36);
    const height = map.height;
    // A raised patch: the terrain writes go to the terrain bits only and keep the tile's height.
    for (let y = 5; y < 15; y++) for (let x = 58; x < 66; x++) height[y * W + x] = 2;
    const heightBefore = height.slice();
    const before = map.terrain.slice();
    new TerrainGenerator(map, stack, search, { rows: ROWS, hotSpots: HOT }).generate();
    expect(height).toEqual(heightBefore);
    for (let i = 0; i < W * W; i++) {
      const [x, y] = [i % W, Math.trunc(i / W)];
      const t = map.terrain[i]!;
      if (t === DEEP) {
        expect(before[i]).toBe(WATER);
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < W) expect([WATER, DEEP, 15]).toContain(map.terrain[ny * W + nx]);
          }
        }
      }
      if (before[i] === WATER) expect([WATER, DEEP]).toContain(t);
      if (!isWater(t) && t !== BEACH) {
        for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < W) expect(isWater(map.terrain[ny * W + nx]!)).toBe(false);
        }
      }
    }
    expect(count(map, DESERT)).toBeGreaterThan(0);
    expect(count(map, PALM)).toBeGreaterThan(0);
    expect(count(map, FOREST)).toBeGreaterThan(0);
    expect(count(map, DEEP)).toBeGreaterThan(0);
    expect(count(map, BEACH)).toBeGreaterThan(0);
  });

  it('is a pure function of the seed: same seed same tiles and RNG state, another seed other tiles', () => {
    const run = (seed: number) => {
      const l = landLayout(seed);
      new TerrainGenerator(l.map, l.stack, l.search, { rows: ROWS, hotSpots: HOT }).generate();
      return { tiles: Array.from(l.map.terrain), next: l.map.rng.rand() };
    };
    expect(run(41)).toEqual(run(41));
    expect(run(42).tiles).not.toEqual(run(41).tiles);
  });
});
