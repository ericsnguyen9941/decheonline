import { describe, expect, test } from 'vitest';
import { MapStack, NONE } from './rmm-base';
import { generateElevation, linkStackRandomly, type ElevationInfo } from './rmm-elevation';
import { RmmMap } from './rmm-map';
import { hotSpotModifiers } from './rmm-terrain';
import { rmmFixture, scriptedRand } from './rmm-testing';

const TERRAIN_WATER = 1;

/** The controller's four levels (src/rmm_dbct.cpp:744-799) for a land area of `area` tiles. */
function levels(area: number): ElevationInfo['levels'] {
  return [
    { height: 1, baseHeight: 0, clumps: 10, spacing: 2, size: Math.trunc(area / 10) },
    { height: 2, baseHeight: 1, clumps: 8, spacing: 1, size: Math.trunc((area * 8) / 100) },
    { height: 3, baseHeight: 2, clumps: 6, spacing: 1, size: Math.trunc((area * 6) / 100) },
    { height: 4, baseHeight: 3, clumps: 4, spacing: 1, size: Math.trunc((area * 4) / 100) },
  ].map((l) => ({ ...l, baseTerrain: 0 }));
}

function list(stack: MapStack, head: number): number[] {
  const out: number[] = [];
  for (let n = stack.next[head]!; n !== NONE; n = stack.next[n]!) out.push(n);
  return out;
}

describe('Elevation::generate_modifiers (src/rmm_elev.cpp:197, shared with the terrain module)', () => {
  test('§9.4: hot spot (62,10) radius 16 fade 15 gives 101 to distance 9, then 90..15, then 0', () => {
    const search = new Uint8Array(96 * 96);
    hotSpotModifiers(search, 96, 96, [{ x: 62, y: 10, radius: 16, fade: 15 }]);
    const at = (dx: number) => search[10 * 96 + 62 + dx];
    expect([0, 9, 10, 11, 12, 13, 14, 15, 16, 20].map(at)).toEqual([101, 101, 90, 75, 60, 45, 30, 15, 0, 0]);
    // Distance is truncated: (62+7, 10+7) is 9.9 away.
    expect(search[17 * 96 + 69]).toBe(101);
    expect(search[17 * 96 + 70]).toBe(90);
  });

  test('overlapping hot spots add up before the cap', () => {
    const search = new Uint8Array(40 * 40);
    hotSpotModifiers(search, 40, 40, [
      { x: 10, y: 10, radius: 5, fade: 10 },
      { x: 16, y: 10, radius: 5, fade: 10 },
    ]);
    expect(search[10 * 40 + 13]).toBe(20 + 20);
    expect(search[10 * 40 + 12]).toBe(30 + 10);
    expect(search[10 * 40 + 10]).toBe(50 + 0);
  });
});

describe('Elevation::link_stack_randomly (src/rmm_elev.cpp:262)', () => {
  const k = (v: number) => v * 4681; // 32767 = 7 * 4681: a draw that gives exactly v over 7 = W - 1

  test('W*H/16 draws of col then row; each tile goes to the front of the head list', () => {
    const f = rmmFixture(8, 8, 1);
    const rng = scriptedRand([k(3), k(2), k(5), k(5), k(1), k(1), k(7), k(7)]);
    const m = new RmmMap(f.map, rng, f.world);
    const head = f.stack.head();
    linkStackRandomly(m, f.stack, head);
    expect(rng.used).toBe(8);
    expect(list(f.stack, head)).toEqual([63, 9, 45, 19]);
  });

  test('drawing tile (0,0) relinks the head to the rest of the row-major chain', () => {
    const f = rmmFixture(8, 8, 1);
    const rng = scriptedRand([k(3), k(2), k(5), k(5), 0, 0, k(1), k(1)]);
    const m = new RmmMap(f.map, rng, f.world);
    const head = f.stack.head();
    linkStackRandomly(m, f.stack, head);
    const rest = Array.from({ length: 64 }, (_, i) => i).filter((i) => ![0, 9, 19, 45].includes(i));
    expect(list(f.stack, head)).toEqual([9, 0, ...rest]);
  });
});

describe('Elevation::generate (src/rmm_elev.cpp:18-449)', () => {
  const run = (seed: number, hotSpots: ElevationInfo['hotSpots'] = []) => {
    const f = rmmFixture(48, 48, seed);
    generateElevation(f.m, f.stack, f.search, { levels: levels(48 * 48), hotSpots });
    return f;
  };

  test('hills up to height 4, no step above 1 between neighbours, tile shapes refreshed', () => {
    const f = run(17);
    const { m } = f;
    const heights = new Set(m.height);
    expect(Math.max(...heights)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...heights)).toBeLessThanOrEqual(4);
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) {
        const h = m.heightAt(x, y);
        if (x < 47) expect(Math.abs(h - m.heightAt(x + 1, y))).toBeLessThanOrEqual(1);
        if (y < 47) expect(Math.abs(h - m.heightAt(x, y + 1))).toBeLessThanOrEqual(1);
        expect(m.tileType[y * 48 + x], `(${x},${y})`).toBe(m.getTileType(x, y));
      }
    }
    expect(m.height.filter((h) => h >= 1).length).toBeGreaterThan(48 * 48 * 0.05);
    expect(f.world.objects).toEqual([]);
  });

  test('deterministic for a seed', () => {
    const a = run(23);
    const b = run(23);
    expect(Array.from(a.m.height)).toEqual(Array.from(b.m.height));
    expect(a.rng.rand()).toBe(b.rng.rand());
    expect(Array.from(run(24).m.height)).not.toEqual(Array.from(a.m.height));
  });

  test('a hot spot keeps its centre flat', () => {
    const f = run(31, [{ x: 24, y: 24, radius: 12, fade: 15 }]);
    for (let y = 20; y <= 28; y++) for (let x = 20; x <= 28; x++) expect(f.m.heightAt(x, y), `(${x},${y})`).toBe(0);
  });

  test('only the base terrain is raised', () => {
    const f = rmmFixture(48, 48, 41);
    for (let y = 0; y < 48; y++) for (let x = 24; x < 48; x++) f.map.terrain[y * 48 + x] = TERRAIN_WATER;
    generateElevation(f.m, f.stack, f.search, { levels: levels(48 * 24), hotSpots: [] });
    // Water tiles may only be lifted by clean_elevation next to a hill; two columns in, they stay at 0.
    for (let y = 0; y < 48; y++) for (let x = 28; x < 48; x++) expect(f.m.heightAt(x, y)).toBe(0);
    expect(f.m.height.some((h) => h > 0)).toBe(true);
  });
});
