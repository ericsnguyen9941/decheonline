import { describe, expect, test } from 'vitest';
import { calcLandStart, checkTerrainAndZone, generateLand, landChance, type LandInfo, type LandLine } from './rmm-land';
import { afterDraws, nextDraws, rmmFixture } from './rmm-testing';
import { CrtRand } from './rng';

const TERRAIN_GRASS = 0;
const TERRAIN_WATER = 1;
const TERRAIN_DESERT = 6;

function line(over: Partial<LandLine>): LandLine {
  return {
    size: 0,
    terrain: TERRAIN_GRASS,
    x: 0,
    y: 0,
    baseSize: 1,
    area: 1,
    zone: 0,
    clumpiness: 0,
    walls: [-1, -1, 1000, 1000],
    fade: 0,
    ...over,
  };
}

function count(terrain: Uint8Array, t: number): number {
  return terrain.reduce((n, v) => n + (v === t ? 1 : 0), 0);
}

describe('calc_land_start (src/rmm_dbct.cpp:299; random-maps.md §9.2, §9.3)', () => {
  test('§9.2: map type 3, W96, edge 10, 2 lands, map seed 41 gives (62,10) and (34,84) in 9 draws', () => {
    const rng = new CrtRand();
    rng.srand(41);
    const lands = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    calcLandStart(rng, 96, 96, lands, 0, 10, 2, 2, 0, 0);
    expect(lands).toEqual([
      { x: 62, y: 10 },
      { x: 34, y: 84 },
    ]);
    expect(nextDraws(rng)).toEqual(nextDraws(afterDraws(41, 9)));
  });

  test('§9.3: map seed 101 moves land 0 to the rejected point (85,30), then land 1 is (10,12), in 15 draws', () => {
    const rng = new CrtRand();
    rng.srand(101);
    const lands = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    calcLandStart(rng, 96, 96, lands, 0, 10, 2, 2, 0, 0);
    expect(lands).toEqual([
      { x: 85, y: 30 },
      { x: 10, y: 12 },
    ]);
    expect(nextDraws(rng)).toEqual(nextDraws(afterDraws(101, 15)));
  });

  test('placement 1 takes the entry point and draws only the logged draw', () => {
    const rng = new CrtRand();
    rng.srand(7);
    const lands = [{ x: 0, y: 0 }];
    calcLandStart(rng, 96, 96, lands, 0, 10, 1, 1, 40, 50);
    expect(lands).toEqual([{ x: 40, y: 50 }]);
    expect(nextDraws(rng)).toEqual(nextDraws(afterDraws(7, 1)));
  });
});

describe('Land::chance (src/rmm_land.cpp:90; Empiresx.exe 1.0a 0x4710a0)', () => {
  const walls = line({ walls: [5, 5, 91, 91], fade: 33 });

  test('inside the walls the chance is 0; one tile outside per fade', () => {
    expect(landChance(walls, 96, 50, 50)).toBe(0);
    expect(landChance(walls, 96, 3, 50)).toBe(66);
    expect(landChance(walls, 96, 93, 50)).toBe(66);
    expect(landChance(walls, 96, 50, 3)).toBe(66);
    expect(landChance(walls, 96, 50, 93)).toBe(66);
    expect(landChance(walls, 96, 1, 50)).toBe(101);
  });

  test('the literal formula: near a wall in x, the y term also carries the x distance and the wall offset', () => {
    // x term 2; a = max(2*5 - 3, 3 + 96 - 2*91) = 7 > 0, so the y term is max(5 + 7 - 7, 7 - 91 + 7) = 5:
    // (2 + 5) * 33 >= 100. The clean reading (x and y distances apart) gives 66.
    expect(landChance(walls, 96, 3, 7)).toBe(101);
    expect(landChance(walls, 96, 4, 40)).toBe(33);
    expect(landChance(walls, 96, 4, 11)).toBe(33);
    expect(landChance(walls, 96, 4, 10)).toBe(66);
  });

  test('fade 0 never refuses', () => {
    expect(landChance(line({ walls: [5, 5, 91, 91], fade: 0 }), 96, 0, 0)).toBe(0);
  });
});

describe('Land::check_terrain_and_zone (src/rmm_land.cpp:27)', () => {
  const W = 10;
  const info: LandInfo = {
    lands: [line({ zone: 0, area: 2 }), line({ zone: 1, area: 2 })],
    baseTerrain: TERRAIN_WATER,
  };
  const free = () => new Uint8Array(W * W).fill(2);

  test('counts own-zone tiles in the 5x5 window; 0 when the tile is taken or none is near', () => {
    const s = free();
    expect(checkTerrainAndZone(s, W, W, info, 0, 5, 5)).toBe(0);
    s[5 * W + 4] = 0;
    s[3 * W + 7] = 0;
    expect(checkTerrainAndZone(s, W, W, info, 0, 5, 5)).toBe(2);
    expect(checkTerrainAndZone(s, W, W, info, 0, 4, 5)).toBe(0);
  });

  test("another land's zone within `area` refuses the tile", () => {
    const s = free();
    s[5 * W + 4] = 0;
    s[5 * W + 7] = 1;
    expect(checkTerrainAndZone(s, W, W, info, 0, 5, 5)).toBe(0);
    s[5 * W + 7] = 2;
    s[5 * W + 8] = 1;
    expect(checkTerrainAndZone(s, W, W, info, 0, 5, 5)).toBe(1);
  });

  test('off the map: 5 for the row just above or below, 1 per row for the column just beside (strict tests)', () => {
    const s = free();
    s[5 * W + 1] = 0;
    // Column -1 inside rows 3..7: 5; column -2 is not counted.
    expect(checkTerrainAndZone(s, W, W, info, 0, 0, 5)).toBe(6);
    s[0 * W + 1] = 0;
    // Row -1: 5; column -1 on rows 0..2: 3; own tile (1,0): 1.
    expect(checkTerrainAndZone(s, W, W, info, 0, 0, 0)).toBe(9);
    s[(W - 1) * W + (W - 2)] = 0;
    expect(checkTerrainAndZone(s, W, W, info, 0, W - 1, W - 1)).toBe(9);
  });
});

describe('Land::generate (src/rmm_land.cpp:17-311)', () => {
  test('quirk: the starting count goes to the zone slot, so with a shared zone land 0 never grows and land 1 grows from 0', () => {
    const f = rmmFixture(20, 20, 5);
    const info: LandInfo = {
      lands: [
        line({ x: 4, y: 10, size: 9, terrain: TERRAIN_GRASS }),
        line({ x: 15, y: 10, size: 9, terrain: TERRAIN_DESERT }),
      ],
      baseTerrain: TERRAIN_WATER,
    };
    generateLand(f.m, f.stack, f.search, info);
    expect(count(f.map.terrain, TERRAIN_GRASS)).toBe(9);
    // Land 1 grows 9 tiles past its square; the leftover fill may add a few more between them.
    expect(count(f.map.terrain, TERRAIN_DESERT)).toBeGreaterThanOrEqual(18);
    for (let y = 9; y <= 11; y++) for (let x = 3; x <= 5; x++) expect(f.map.terrain[y * 20 + x]).toBe(TERRAIN_GRASS);
    expect(f.world.objects).toEqual([]);
  });

  test('a land is not grown within `area` of another zone', () => {
    const f = rmmFixture(20, 20, 9);
    const info: LandInfo = {
      lands: [
        line({ x: 5, y: 10, size: 200, area: 2, zone: 0, terrain: TERRAIN_GRASS }),
        line({ x: 14, y: 10, size: 200, area: 2, zone: 1, terrain: TERRAIN_DESERT }),
      ],
      baseTerrain: TERRAIN_WATER,
    };
    generateLand(f.m, f.stack, f.search, info);
    const t = f.map.terrain;
    let nearest = Infinity;
    for (let a = 0; a < t.length; a++) {
      if (t[a] !== TERRAIN_GRASS) continue;
      for (let b = 0; b < t.length; b++) {
        if (t[b] !== TERRAIN_DESERT) continue;
        nearest = Math.min(nearest, Math.max(Math.abs((a % 20) - (b % 20)), Math.abs(Math.trunc(a / 20) - Math.trunc(b / 20))));
      }
    }
    expect(nearest).toBeGreaterThan(2);
    expect(count(t, TERRAIN_GRASS)).toBeGreaterThan(9);
    expect(count(t, TERRAIN_DESERT)).toBeGreaterThan(9);
  });

  test('the walls refuse every tile whose chance is 101', () => {
    const f = rmmFixture(40, 40, 3);
    const info: LandInfo = {
      lands: [line({ x: 20, y: 20, size: 1600, area: 4, baseSize: 2, walls: [5, 5, 35, 35], fade: 33 })],
      baseTerrain: TERRAIN_WATER,
    };
    generateLand(f.m, f.stack, f.search, info);
    const t = f.map.terrain;
    for (let i = 0; i < t.length; i++) {
      const x = i % 40;
      const y = Math.trunc(i / 40);
      if (t[i] === TERRAIN_GRASS) expect(landChance(info.lands[0]!, 40, x, y), `(${x},${y})`).toBeLessThan(101);
    }
    expect(count(t, TERRAIN_GRASS)).toBeGreaterThan(900);
  });

  test('§9.2 tables: two grass lands of 3686 on water, deterministic', () => {
    const run = () => {
      const f = rmmFixture(96, 96, 41);
      const land = (x: number, y: number) =>
        line({ x, y, size: 3686, baseSize: 7, area: 4, clumpiness: 8, walls: [-1, 5, 91, 91], fade: 33 });
      generateLand(f.m, f.stack, f.search, { lands: [land(62, 10), land(34, 84)], baseTerrain: TERRAIN_WATER });
      return f;
    };
    const a = run();
    const b = run();
    expect(Array.from(a.map.terrain)).toEqual(Array.from(b.map.terrain));
    expect(nextDraws(a.rng)).toEqual(nextDraws(b.rng));
    const t = a.map.terrain;
    expect(t[10 * 96 + 62]).toBe(TERRAIN_GRASS);
    expect(t[84 * 96 + 34]).toBe(TERRAIN_GRASS);
    expect(new Set(t)).toEqual(new Set([TERRAIN_GRASS, TERRAIN_WATER]));
    // Wall 4 is at 91 with fade 33: rows from 95 refuse every tile.
    for (let x = 0; x < 96; x++) expect(t[95 * 96 + x]).toBe(TERRAIN_WATER);
    const grass = count(t, TERRAIN_GRASS);
    expect(grass).toBeGreaterThan(3686);
    expect(grass).toBeLessThan(2 * 3686 + 400);
    expect(a.world.objects).toEqual([]);
  });
});
