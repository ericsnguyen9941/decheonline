import { describe, expect, test } from 'vitest';
import { EntityStore, type Entity } from './entities';
import { TileMap } from './map';
import { doTrivialMove, newMover, teleport, type MoveContext } from './movement';
import { f32, mul32 } from './num';
import { estimate, iterationCap, OpenList, PathingSystem } from './pathing';
import { CrtRand } from './rng';
import type { UnitType } from './units';

// docs/spec/movement.md §13: chosen inputs, not empires.dat values.
const UNIT: UnitType = {
  id: 1,
  name: 'example',
  hitPoints: 1,
  los: 0,
  fogFlag: 0,
  speed: f32(1.2),
  radiusX: f32(0.2),
  radiusY: f32(0.2),
  radiusZ: f32(1),
  turnSpeed: 0,
  terrainRestriction: 0,
  terrainTable: [f32(1)],
  standing: { graphic: 0, frames: 1, facets: 8, baseSpeed: 0, duration: 0, pause: 0, flags: 2, hasFacings: true, randomStart: false },
  walking: null,
  masterType: 70,
  group: 0,
  flying: false,
  combatLevel: 0,
  dying: null,
  deadUnitId: -1,
  storages: [],
  resourceCapacity: 0,
  resourceDecay: 0,
  action: null,
  combat: null,
  missile: null,
  clearanceX: f32(0.2),
  clearanceY: f32(0.2),
  canBeBuiltOn: 0,
  elevationMode: 0,
  placementTerrain: [-1, -1],
  placementSideTerrain: [-1, -1],
  enabled: true,
  creatable: null,
  building: null,
};

function setup(waypoint: [number, number], seed = 14, map = new TileMap(32, 32), start = f32(10.5)) {
  const entities = new EntityStore();
  const pathing = new PathingSystem(map, entities, () => UNIT);
  const rng = new CrtRand();
  rng.srand(seed);
  const ctx: MoveContext = { map, entities, pathing, rng, deltaSeconds: f32(200 * f32(0.001)), attempts: 0, masters: [{}, { 1: UNIT }] };
  const add = (x: number, y: number): Entity => {
    const e = entities.create({ owner: 1, type: 1, x, y, z: 0, hp: 1, mover: newMover() });
    teleport(ctx, e, UNIT, e.x, e.y, 0);
    return e;
  };
  const unit = add(start, 10.5);
  const m = unit.mover!;
  m.path = [
    { x: start, y: f32(10.5), z: 0, facet: 0xff },
    { x: f32(waypoint[0]), y: f32(waypoint[1]), z: 0, facet: 0xff },
  ];
  m.pathIndex = 1;
  m.continueCounter = 25;
  return { ctx, unit, m, add, step: () => doTrivialMove(ctx, unit, UNIT, m, m.path[1]!.x, m.path[1]!.y) };
}

describe('movement.md §13 worked examples', () => {
  test('A: first straight step from idle', () => {
    const { ctx, unit, m, step } = setup([14.5, 10.5]);
    expect(ctx.deltaSeconds).toBe(f32(0.200000003));
    expect(step()).toBe(0);
    expect(unit.x).toBe(f32(10.7399998));
    expect(unit.y).toBe(10.5);
    expect(m.angle).toBe(0);
    expect(m.facet).toBe(7);
    expect(m.lastFacet).toBe(7);
    expect(m.lastFacet2).toBe(0xff);
    expect(m.closestDistanceToWaypoint).toBe(4);
    expect(m.speed).toBe(f32(1.2));
    // Footprint cells [42, 43) x [41, 42) after the step.
    expect([41, 42, 43].map((cx) => ctx.pathing.obstruction(cx, 41))).toEqual([0, 1, 0]);
    expect(ctx.pathing.obstruction(42, 42)).toBe(0);
  });

  test('B: the heading snaps to the nearest facet, not the waypoint bearing', () => {
    const { unit, m, step } = setup([11.5, 13.5]);
    expect(step()).toBe(0);
    expect(m.angle).toBe(f32(0.78539819));
    expect(m.facet).toBe(0);
    expect(unit.x).toBe(f32(10.6697054));
    expect(unit.y).toBe(f32(10.6697054));
  });

  test('C: a blocked step draws rand() % 6 and waits out the distance', () => {
    const { ctx, unit, m, add, step } = setup([14.5, 10.5]);
    const blocker = add(10.85, 10.5);
    expect(step()).toBe(0);
    // srand(14): the first draw is 84, 84 % 6 = 0, so the wait is 0.5 / 1.2.
    expect(m.collisionAvoidanceDistance).toBe(f32(0.41666666));
    expect(m.speed).toBe(0);
    expect(unit.x).toBe(10.5);

    const probe = new CrtRand();
    probe.srand(14);
    probe.rand();
    const next = probe.rand();
    expect(step()).toBe(0);
    expect(m.collisionAvoidanceDistance).toBe(f32(0.17666665));
    expect(unit.x).toBe(10.5);

    // The way is clear now: the wait runs out, the unit moves, and no new random wait is drawn.
    ctx.pathing.unstamp(blocker, UNIT);
    ctx.entities.remove(blocker.id);
    expect(step()).toBe(0);
    expect(m.collisionAvoidanceDistance).toBe(-1);
    expect(unit.x).toBe(f32(10.7399998));
    expect(ctx.rng.rand()).toBe(next);
  });

  test('C: still blocked after the wait, the unit repaths instead of drawing a new wait', () => {
    const { ctx, m, add, step } = setup([14.5, 10.5]);
    add(10.85, 10.5);
    step();
    step();
    const before = m.path;
    step();
    expect(m.path).not.toBe(before);
    expect(ctx.attempts).toBe(1);
    expect(m.continueCounter).toBe(24);
  });

  test('D: search budget per distance and the heuristic', () => {
    expect(iterationCap(10, 10, 15, 10, 2500, 1)).toBe(1250);
    expect(iterationCap(10, 10, 20, 10, 2500, 1)).toBe(2500);
    expect(iterationCap(10, 10, 21, 10, 2500, 1)).toBe(275);
    expect(iterationCap(10, 10, 30, 10, 2500, 1)).toBe(500);
    expect(iterationCap(10, 10, 15, 10, 2500, 0)).toBe(100);
    expect(estimate(15, 12, 10, 10)).toBe(93);
  });

  test('E: the heap pop does not sift a heap of three', () => {
    const open = new OpenList();
    [5, 9, 7, 8].forEach((total, i) => {
      open.x[i + 1] = total;
      open.total[i + 1] = total;
    });
    open.size = 4;
    open.pop();
    expect(open.size).toBe(3);
    expect([...open.total.slice(1, 4)]).toEqual([8, 9, 7]);
    expect(open.x[1]).toBe(8);
  });
});

/** A 32 x 32 grass map whose tiles from column 12 east are one level up: column 11 is the slope (type 8, rz = rx). */
function eastHill(): TileMap {
  const map = new TileMap(32, 32);
  for (let row = 0; row < 32; row++) for (let col = 12; col < 32; col++) map.setTile(col, row, 0, 1);
  return map;
}

describe('world_z from the ground (teleport, src/stat_obj.cpp:1586-1596)', () => {
  test('a ground object takes the ground height wherever it is teleported, whatever z it is given', () => {
    const { ctx, add } = setup([14.5, 10.5], 14, eastHill());
    const e = add(10.5, 10.5);
    expect(e.z).toBe(0);
    teleport(ctx, e, UNIT, f32(11.25), f32(10.5), 5);
    expect(e.z).toBe(0.25);
    teleport(ctx, e, UNIT, f32(14.5), f32(10.5), 0);
    expect(e.z).toBe(1);
  });

  test('a flying object (movement_type 1) keeps its z above the ground and is lifted to the ground below it', () => {
    const { ctx, add } = setup([14.5, 10.5], 14, eastHill());
    const flying: UnitType = { ...UNIT, flying: true, radiusZ: 0 };
    const e = add(10.5, 10.5);
    expect(teleport(ctx, e, flying, f32(14.5), f32(10.5), 3)).toBe(1);
    expect(e.z).toBe(3);
    expect(teleport(ctx, e, flying, f32(14.5), f32(10.5), f32(0.5))).toBe(1);
    expect(e.z).toBe(1);
  });
});

describe('movement.md §8.5: climbing and descending speed (src/move_obj.cpp:1382-1396)', () => {
  /** Steps toward the waypoint until it is reached; each step's z change and the speed it leaves for the next. */
  function walk(start: number, goal: number): { dz: number; before: number; speed: number }[] {
    const { unit, m, step } = setup([goal, 10.5], 14, eastHill(), f32(start));
    const out: { dz: number; before: number; speed: number }[] = [];
    for (let i = 0; i < 40 && Math.abs(unit.x - goal) > 0.3; i++) {
      const z = unit.z;
      const before = m.speed;
      if (step() !== 0) break;
      out.push({ dz: unit.z - z, before, speed: m.speed });
    }
    return out;
  }

  test('walking up the slope: each step that rises more than 0.02 multiplies the speed by 0.9', () => {
    const steps = walk(10.5, 14.5);
    const up = steps.filter((s) => s.dz > 0.02);
    expect(up.length).toBeGreaterThan(2);
    for (const s of up) expect(s.speed).toBe(mul32(s.before, f32(0.9)));
    // Up on the plateau the speed is reset to the unit's speed.
    expect(steps.at(-1)!.dz).toBe(0);
    expect(steps.at(-1)!.speed).toBe(f32(1.2));
  });

  test('walking down the slope: each step that falls more than 0.02 multiplies the speed by 1.03', () => {
    const steps = walk(13.5, 9.5);
    const down = steps.filter((s) => s.dz < -0.02);
    expect(down.length).toBeGreaterThan(2);
    for (const s of down) expect(s.speed).toBe(mul32(s.before, f32(1.03)));
    expect(steps.at(-1)!.dz).toBe(0);
    expect(steps.at(-1)!.speed).toBe(f32(1.2));
  });

  test('walking on level ground: the speed stays the unit speed', () => {
    const steps = walk(10.5, 3.5);
    expect(steps.length).toBeGreaterThan(5);
    for (const s of steps) expect([s.dz, s.speed]).toEqual([0, f32(1.2)]);
  });
});
