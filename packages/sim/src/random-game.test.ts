import { describe, expect, test } from 'vitest';
import type { Entity } from './entities';
import { runReplay, sampleRandomMapReplay } from './replay';
import { MAP_LARGE } from './rmm-controller';
import { RANDOM_MAPS } from './unit-data';
import { MINE_GOLD, MINE_STONE, FORAGE, TOWN_CENTER, VILLAGER } from './units';
import { World } from './world';

const game = (seed: number) => new World({ players: 3, randomSeed: seed, randomMap: {} });
const tile = (e: Entity) => [Math.trunc(e.x), Math.trunc(e.y)] as const;
const centres = (w: World) => [1, 2].map((p) => [...w.entities.all()].find((e) => e.owner === p && e.type === TOWN_CENTER)!).map(tile);

describe('a random map game (World option randomMap; random-maps.md)', () => {
  test('defaults to the multiplayer settings: Large (144), Mostly Land', () => {
    const w = game(1);
    expect([w.map.width, w.map.height]).toEqual([MAP_LARGE, MAP_LARGE]);
  });

  test('two seeds give different start positions', () => {
    const starts = [1, 2, 3].map((seed) => JSON.stringify(centres(game(seed))));
    expect(new Set(starts).size).toBe(3);
  });

  test('the same seed gives the same map, objects and RNG state', () => {
    const a = game(20261115);
    const b = game(20261115);
    expect(a.randomSeed).toBe(b.randomSeed);
    expect(Array.from(a.map.terrain)).toEqual(Array.from(b.map.terrain));
    expect(Array.from(a.map.elevation)).toEqual(Array.from(b.map.elevation));
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    expect(a.hash()).toBe(b.hash());
    expect(game(20261116).hash()).not.toBe(a.hash());
  });

  test("each start has its Town Center, 3 Villagers, berries, gold and stone in the dat land rows' ranges", () => {
    // Map 3's land rows: berries a group of 7 ± 1 within 3 of a start 7-16 tiles out; gold clusters of 8 started 12-18
    // and 21-35 out, stone clusters of 7 started 10-18 and 20-35 out, both 2 tiles across. Away rows keep 40 tiles off.
    const rows = RANDOM_MAPS[3]!.objects.filter((r) => r[9] === 1).map((r) => [r[0], r[2], r[4], r[5], r[7], r[10], r[11]].join());
    expect(rows.slice(0, 7)).toEqual([
      [TOWN_CENTER, 0, 1, 0, 1, 0, 1],
      [VILLAGER, 0, 1, 0, 1, 2, 4],
      [MINE_STONE, 2, 7, 0, 2, 20, 35],
      [MINE_GOLD, 2, 8, 0, 2, 21, 35],
      [MINE_STONE, 2, 7, 0, 2, 10, 18],
      [MINE_GOLD, 2, 8, 0, 2, 12, 18],
      [FORAGE, 1, 7, 1, 3, 7, 16],
    ].map((r) => r.join()));
    for (let i = 1; i <= 8; i++) {
      const w = game(i * 7919);
      const objects = [...w.entities.all()];
      for (const p of [1, 2]) {
        const [cx, cy] = tile(objects.find((e) => e.owner === p && e.type === TOWN_CENTER)!);
        const d = (e: Entity) => Math.max(Math.abs(tile(e)[0] - cx), Math.abs(tile(e)[1] - cy));
        const within = (type: number, max: number) => objects.filter((e) => e.type === type && d(e) <= max);
        const at = `seed ${i * 7919} player ${p}`;
        expect(objects.filter((e) => e.owner === p && e.type === TOWN_CENTER), at).toHaveLength(1);
        const villagers = objects.filter((e) => e.owner === p && e.type === VILLAGER);
        expect(villagers.map(d).every((v) => v <= 5), at).toBe(true);
        expect(villagers, at).toHaveLength(3);
        expect(within(FORAGE, 19).length, at).toBeGreaterThanOrEqual(6);
        expect(within(FORAGE, 19).every((e) => d(e) >= 4), at).toBe(true);
        // A cluster whose snapped start overlaps an object places nothing (`place_cluster`), so one of the two rows may
        // be empty; the other is there.
        expect(within(MINE_GOLD, 37).length, at).toBeGreaterThanOrEqual(8);
        expect(within(MINE_STONE, 37).length, at).toBeGreaterThanOrEqual(7);
        expect(within(MINE_GOLD, 37).every((e) => d(e) >= 10), at).toBe(true);
        expect(within(MINE_STONE, 37).every((e) => d(e) >= 8), at).toBe(true);
      }
    }
  });

  test('a random map replay runs the same twice and from a snapshot', () => {
    const log = sampleRandomMapReplay(40);
    const first = runReplay(log);
    expect(runReplay(log)).toEqual(first);
    const world = new World({ players: log.players, randomSeed: log.randomSeed, randomMap: log.randomMap! });
    runReplay({ ...log, turns: 20 }, world);
    const restored = World.restore(JSON.parse(JSON.stringify(world.snapshot())));
    expect(runReplay(log, restored)).toEqual(first.slice(20));
    // About 3 s alone; on a loaded host it passes the 5 s default.
  }, 30_000);
});
