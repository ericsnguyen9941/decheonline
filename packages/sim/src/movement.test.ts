import { describe, expect, test } from 'vitest';
import { EntityStore, type Entity } from './entities';
import { TileMap } from './map';
import { doTrivialMove, newMover, teleport, type MoveContext } from './movement';
import { f32 } from './num';
import { estimate, iterationCap, OpenList, PathingSystem } from './pathing';
import { CrtRand } from './rng';
import type { UnitType } from './units';

// docs/spec/movement.md §13: chosen inputs, not empires.dat values.
const UNIT: UnitType = {
  id: 1,
  name: 'example',
  hitPoints: 1,
  speed: f32(1.2),
  radiusX: f32(0.2),
  radiusY: f32(0.2),
  radiusZ: f32(1),
  turnSpeed: 0,
  terrainRestriction: 0,
  terrainTable: [f32(1)],
  standing: { graphic: 0, facets: 8, baseSpeed: 0, hasFacings: true },
  walking: null,
};

function setup(waypoint: [number, number], seed = 14) {
  const map = new TileMap(32, 32);
  const entities = new EntityStore();
  const pathing = new PathingSystem(map, entities);
  const rng = new CrtRand();
  rng.srand(seed);
  const ctx: MoveContext = { map, entities, pathing, rng, deltaSeconds: f32(200 * f32(0.001)), attempts: 0 };
  const add = (x: number, y: number): Entity => {
    const e = entities.create({ owner: 1, type: 1, x, y, z: 0, hp: 1, mover: newMover() });
    teleport(ctx, e, UNIT, e.x, e.y, 0);
    return e;
  };
  const unit = add(10.5, 10.5);
  const m = unit.mover!;
  m.path = [
    { x: f32(10.5), y: f32(10.5), z: 0, facet: 0xff },
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
