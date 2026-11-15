import { describe, expect, it } from 'vitest';
import { EntityStore, ObjectState, type Entity } from './entities';
import { TileMap } from './map';
import { newMasters } from './masters';
import { MapStack } from './rmm-base';
import { RmmMap, type RmmWorld } from './rmm-map';
import {
  ObjectGenerator,
  RELIC,
  RUIN,
  objectRowFromDat,
  placeRelicsAndRuins,
  type LandPoint,
  type ObjectRow,
} from './rmm-objects';
import { CrtRand } from './rng';
import { RANDOM_MAPS, TERRAIN_OBJECTS } from './unit-data';

const GRASS = 0;
const WATER = 1;
const BEACH = 2;
const FOREST = 10;
const DEEP = 22;
const W = 96;
const TOWN_CENTER = 109;
const VILLAGER = 83;
const GOLD = 66;
const BERRIES = 59;
const LION = 126;
const FISH = 53;
const ALLIGATOR = 1;
const LANDS: LandPoint[] = [
  { x: 20, y: 48, id: 1, player: 1 },
  { x: 76, y: 48, id: 1, player: 2 },
];
/** Map type 3 (MostlyLand), dat array index 3 (random-maps.md §2.2). */
const MAP3 = RANDOM_MAPS[3]!;

interface Layout {
  map: RmmMap;
  stack: MapStack;
  search: Uint8Array;
  rng: CrtRand;
  live(): Entity[];
}

/**
 * A world whose object creation draws once and reseeds with the draw (`RGE_Static_Object` set-up,
 * src/stat_obj.cpp:387-397), Gaia civ 0 and two Egyptian players.
 */
function layout(seed: number, paint: (x: number, y: number) => number, w = W): Layout {
  const tiles = new TileMap(w, w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) tiles.terrain[y * w + x] = paint(x, y);
  const rng = new CrtRand();
  rng.srand(seed);
  const entities = new EntityStore();
  const masters = [newMasters(0), newMasters(1), newMasters(1)];
  const world: RmmWorld = {
    master: (owner, type) => masters[owner]?.[type] ?? null,
    create: (owner, type, x, y) => {
      const e = entities.create({ owner, type, x, y, z: 0, hp: masters[owner]![type]!.hitPoints });
      rng.srand(rng.rand());
      return e;
    },
    destroy: (e) => {
      e.state = ObjectState.PendingRemoval;
    },
    remove: (e) => {
      entities.remove(e.id);
    },
    complete: () => {},
    typeOf: (e) => masters[e.owner]![e.type]!,
  };
  return {
    map: new RmmMap(tiles, rng, world),
    stack: new MapStack(w, w),
    search: new Uint8Array(w * w),
    rng,
    live: () => [...entities.all()].filter((e) => e.state < ObjectState.PendingRemoval),
  };
}

/** Grass, a north–south channel of water with deep water inside and a beach on each shore, and a forest patch. */
function channel(x: number, y: number): number {
  if (x === 39 || x === 56) return BEACH;
  if (x >= 44 && x <= 51) return DEEP;
  if (x >= 40 && x <= 55) return WATER;
  if (x >= 4 && x <= 9 && y >= 84 && y <= 89) return FOREST;
  return GRASS;
}

/** The TRIBE controller's exclusion zones (src/rmm_tdbc.cpp:393-418, random-maps.md §4.3). */
function tribeExclusion(row: ObjectRow): ObjectRow {
  if (row.landId >= 0 && [BERRIES, 65, GOLD, 102].includes(row.type)) return { ...row, exclusion: 12 };
  if (row.landId === -2 && row.type === 65) return { ...row, exclusion: Math.trunc(W / 8) };
  if (row.landId === -2 && [BERRIES, GOLD, 102].includes(row.type)) return { ...row, exclusion: Math.trunc(W / 6) };
  return row;
}

const map3Rows = (): ObjectRow[] => MAP3.objects.map((r) => tribeExclusion(objectRowFromDat(r)));
const tile = (e: Entity): [number, number] => [Math.trunc(e.x), Math.trunc(e.y)];
const cheb = (x: number, y: number, l: { x: number; y: number }) => Math.max(Math.abs(x - l.x), Math.abs(y - l.y));
const ofType = (l: Layout, type: number) => l.live().filter((e) => e.type === type);
const nearest = (e: Entity) => {
  const [x, y] = tile(e);
  return LANDS.reduce((best, l) => (cheb(x, y, l) < cheb(x, y, best) ? l : best));
};

function run(l: Layout, rows: ObjectRow[], terrainObjects = false, lands = LANDS): ObjectGenerator {
  const gen = new ObjectGenerator(l.map, l.stack, l.search, { rows, lands }, terrainObjects);
  gen.generate();
  return gen;
}

describe('random map object module (rmm_obj.cpp)', () => {
  it("the dat's map 3 rows, as the decomp's field order reads them", () => {
    const rows = MAP3.objects.map(objectRowFromDat);
    expect(rows[0]).toEqual({
      type: TOWN_CENTER,
      terrain: -1,
      groupFlag: 0,
      scale: false,
      perGroup: 1,
      variance: 0,
      groups: 1,
      area: 1,
      player: -1,
      landId: 1,
      inner: 0,
      outer: 1,
      exclusion: 1,
    });
    expect(rows.find((r) => r.type === LION)).toMatchObject({ groupFlag: 1, scale: true, groups: 7, landId: -2, inner: 18 });
    expect(rows.filter((r) => r.type === ALLIGATOR).map((r) => r.terrain)).toEqual([4, 2]);
  });

  it('each land gets its player a town centre on the first free tile around the centre and 3 villagers 3–4 tiles out', () => {
    const l = layout(5, channel);
    run(l, map3Rows().slice(0, 2));
    for (const land of LANDS) {
      const tcs = ofType(l, TOWN_CENTER).filter((e) => nearest(e) === land);
      // Candidates are the 8 tiles around the centre in row order (no random moves in a 3×3); the first, (cx−1, cy−1),
      // fits, and a 1.5 radius puts the centre half a tile in.
      expect(tcs.map((e) => [e.owner, e.x, e.y])).toEqual([[land.player, land.x - 0.5, land.y - 0.5]]);
      const villagers = ofType(l, VILLAGER).filter((e) => nearest(e) === land);
      expect(villagers).toHaveLength(3);
      for (const v of villagers) {
        const [x, y] = tile(v);
        expect(v.owner).toBe(land.player);
        expect([v.x - x, v.y - y]).toEqual([0.5, 0.5]);
        expect(cheb(x, y, land)).toBeGreaterThanOrEqual(3);
        expect(cheb(x, y, land)).toBeLessThanOrEqual(4);
      }
      // Exclusion 1: no two villagers on neighbouring tiles.
      for (const a of villagers) for (const b of villagers) if (a !== b) expect(cheb(...tile(a), { x: tile(b)[0], y: tile(b)[1] })).toBeGreaterThanOrEqual(2);
    }
  });

  it('a cluster row places per_group mines on 4-connected tiles within the area of a start in the ring', () => {
    const l = layout(9, channel);
    // Near gold: cluster of 8, area 2, between 12 and 18 tiles out.
    const row = map3Rows().find((r) => r.type === GOLD && r.inner === 12)!;
    expect(row).toMatchObject({ groupFlag: 2, perGroup: 8, variance: 0, area: 2, player: 0, exclusion: 12 });
    run(l, [row]);
    for (const land of LANDS) {
      const mines = ofType(l, GOLD).filter((e) => nearest(e) === land);
      expect(mines).toHaveLength(8);
      const tiles = mines.map(tile);
      for (const [x, y] of tiles) {
        expect(cheb(x, y, land)).toBeGreaterThanOrEqual(11);
        expect(cheb(x, y, land)).toBeLessThanOrEqual(20);
      }
      expect(Math.max(...tiles.map(([x]) => x)) - Math.min(...tiles.map(([x]) => x))).toBeLessThanOrEqual(4);
      expect(Math.max(...tiles.map(([, y]) => y)) - Math.min(...tiles.map(([, y]) => y))).toBeLessThanOrEqual(4);
      // 4-connected: grown only through neighbours of placed mines.
      const reached = new Set([tiles[0]!.join()]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const [x, y] of tiles) {
          if (reached.has(`${x},${y}`)) continue;
          if ([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some((p) => reached.has(p.join()))) {
            reached.add(`${x},${y}`);
            grew = true;
          }
        }
      }
      expect(reached.size).toBe(8);
    }
  });

  it('a group row places per_group ± variance objects within the area, off every land centre’s inner square', () => {
    const l = layout(11, channel);
    const row = map3Rows().find((r) => r.type === BERRIES && r.landId === 1)!;
    expect(row).toMatchObject({ groupFlag: 1, perGroup: 7, variance: 1, area: 3, inner: 7, outer: 16 });
    run(l, [row]);
    for (const land of LANDS) {
      const bushes = ofType(l, BERRIES).filter((e) => nearest(e) === land);
      expect(bushes.length).toBeGreaterThanOrEqual(6);
      expect(bushes.length).toBeLessThanOrEqual(8);
      const tiles = bushes.map(tile);
      for (const [x, y] of tiles) {
        expect(cheb(x, y, land)).toBeGreaterThanOrEqual(8);
        expect(cheb(x, y, land)).toBeLessThanOrEqual(16 + 3);
      }
      expect(Math.max(...tiles.map(([x]) => x)) - Math.min(...tiles.map(([x]) => x))).toBeLessThanOrEqual(6);
      expect(Math.max(...tiles.map(([, y]) => y)) - Math.min(...tiles.map(([, y]) => y))).toBeLessThanOrEqual(6);
    }
  });

  it('an avoid row scales its groups to the map and keeps every object more than inner tiles from each land', () => {
    const l = layout(13, channel);
    const row = map3Rows().find((r) => r.type === LION)!;
    const gen = run(l, [row]);
    // 7 groups per 144²: trunc(96·96·7 / 20736) = 3, written back to the row.
    expect(gen.info.rows[0]!.groups).toBe(3);
    const lions = ofType(l, LION);
    expect(lions.length).toBeGreaterThanOrEqual(3);
    expect(lions.length).toBeLessThanOrEqual(3 * 3);
    for (const lion of lions) {
      expect(lion.owner).toBe(0);
      for (const land of LANDS) expect(cheb(...tile(lion), land)).toBeGreaterThan(18);
    }
  });

  it('rows with a terrain place only on it: fish in deep water at the tile corner, alligators on the beach', () => {
    const l = layout(17, channel);
    const rows = map3Rows();
    const fish = rows.find((r) => r.type === FISH && r.terrain === DEEP)!;
    const gators = rows.find((r) => r.type === ALLIGATOR && r.terrain === BEACH)!;
    const gen = run(l, [fish, gators]);
    expect(gen.info.rows.map((r) => r.groups)).toEqual([4, 1]);
    const fishes = ofType(l, FISH);
    expect(fishes).toHaveLength(4);
    for (const f of fishes) {
      // Radius 1 is whole: the object sits on the tile corner.
      expect([f.x, f.y]).toEqual(tile(f));
      expect(l.map.terrain[f.y * W + f.x]).toBe(DEEP);
    }
    const alligators = ofType(l, ALLIGATOR);
    expect(alligators.length).toBeGreaterThanOrEqual(1);
    for (const a of alligators) {
      const [x, y] = tile(a);
      expect(l.map.terrain[y * W + x]).toBe(BEACH);
      for (const land of LANDS) expect(cheb(x, y, land)).toBeGreaterThan(8);
    }
  });

  it('a single land object that fits on no candidate is placed on the last one anyway', () => {
    // A 3×3 grass island: every candidate around the centre is in the land's zone, but a town centre's 3×3 footprint
    // always reaches the water.
    const l = layout(1, (x, y) => (Math.abs(x - 10) <= 1 && Math.abs(y - 10) <= 1 ? GRASS : WATER), 24);
    run(l, map3Rows().slice(0, 1), false, [{ x: 10, y: 10, id: 1, player: 1 }]);
    expect(ofType(l, TOWN_CENTER).map((e) => [e.owner, e.x, e.y])).toEqual([[1, 11.5, 11.5]]);
  });

  it('terrain objects: every forest tile gets exactly one tree of the forest list at its centre, for Gaia', () => {
    const l = layout(19, channel);
    run(l, [], true);
    const forestIds = TERRAIN_OBJECTS[FOREST]![0]!;
    const objects = l.live();
    for (let y = 84; y <= 89; y++) {
      for (let x = 4; x <= 9; x++) {
        const here = objects.filter((e) => tile(e)[0] === x && tile(e)[1] === y);
        expect(here).toHaveLength(1);
        expect(forestIds).toContain(here[0]!.type);
        expect([here[0]!.owner, here[0]!.x, here[0]!.y]).toEqual([0, x + 0.5, y + 0.5]);
      }
    }
    // Every object stands on a tile whose terrain lists it; deep water lists none.
    for (const e of objects) {
      const [x, y] = tile(e);
      const t = l.map.terrain[y * W + x]!;
      expect(t).not.toBe(DEEP);
      expect(TERRAIN_OBJECTS[t]![0]).toContain(e.type);
    }
  });

  it("map 3's full table: every land's start objects, terrain rows on their terrain, avoid rows away from lands", () => {
    const l = layout(41, channel);
    const rows = map3Rows();
    run(l, rows, true);
    for (const land of LANDS) {
      const mine = (type: number) => ofType(l, type).filter((e) => nearest(e) === land && cheb(...tile(e), land) <= 37);
      expect(mine(TOWN_CENTER).filter((e) => e.owner === land.player)).toHaveLength(1);
      expect(mine(VILLAGER).filter((e) => e.owner === land.player)).toHaveLength(3);
      for (const type of [BERRIES, GOLD, 102, 65]) expect(mine(type).length).toBeGreaterThan(0);
    }
    for (const row of rows) {
      for (const e of ofType(l, row.type)) {
        if (row.terrain >= 0 && rows.every((r) => r.type !== row.type || r.terrain === row.terrain)) {
          expect(l.map.terrain[Math.trunc(e.y) * W + Math.trunc(e.x)]).toBe(row.terrain);
        }
      }
    }
    for (const lion of ofType(l, LION)) for (const land of LANDS) expect(cheb(...tile(lion), land)).toBeGreaterThan(18);
  });

  it('is a pure function of the seed: same seed same objects and RNG state', () => {
    const once = (seed: number) => {
      const l = layout(seed, channel);
      run(l, map3Rows(), true);
      return { objects: l.live().map((e) => [e.owner, e.type, e.x, e.y]), next: l.rng.rand() };
    };
    const a = once(41);
    expect(once(41)).toEqual(a);
    expect(once(42).objects).not.toEqual(a.objects);
  });

  it('relics and ruins: 5 relics for the score victory without a draw, 5 ruins on a draw < 50, W/5 apart', () => {
    for (const seed of [1, 2, 3, 4]) {
      const l = layout(seed, channel);
      const mirror = new CrtRand();
      mirror.srand(seed);
      const ruins = mirror.rand() % 100 < 50;
      const result = placeRelicsAndRuins(l.map, l.stack, l.search, {
        victoryType: 3,
        artifacts: 0,
        discoveries: 0,
        ruins: 0,
        owned: () => 0,
      });
      expect(result).toEqual({ artifactCount: 5, ruinCount: ruins ? 5 : null });
      const relics = ofType(l, RELIC);
      expect(relics).toHaveLength(5);
      expect(ofType(l, RUIN)).toHaveLength(ruins ? 5 : 0);
      for (const group of [relics, ofType(l, RUIN)]) {
        for (const a of group) {
          expect(a.owner).toBe(0);
          for (const b of group) if (a !== b) expect(cheb(...tile(a), { x: tile(b)[0], y: tile(b)[1] })).toBeGreaterThan(Math.trunc(W / 5));
        }
      }
    }
  });

  it('relics and ruins: other victories draw for relics first; a ruins victory adds the missing ruins', () => {
    const seed = 7;
    const l = layout(seed, channel);
    const mirror = new CrtRand();
    mirror.srand(seed);
    const relics = mirror.rand() % 100 < 50;
    const ruins = mirror.rand() % 100 < 50;
    const result = placeRelicsAndRuins(l.map, l.stack, l.search, {
      victoryType: 4,
      artifacts: 0,
      discoveries: 0,
      ruins: 3,
      owned: (types) => (types.includes(RUIN) ? 1 : 0),
    });
    expect(result).toEqual({ artifactCount: relics ? 5 : null, ruinCount: ruins ? 5 : null });
    expect(ofType(l, RELIC)).toHaveLength(relics ? 5 : 0);
    expect(ofType(l, RUIN)).toHaveLength(2 + (ruins ? 5 : 0));
  });
});
