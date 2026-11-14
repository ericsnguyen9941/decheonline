import { describe, expect, test } from 'vitest';
import { ACTION_BUILD } from './build';
import { addToQueue, ATTR_HEADROOM, ATTR_POPULATION, cancelBuild, updateQueue } from './buildings';
import type { Command } from './commands';
import { ObjectState, type Entity } from './entities';
import { updateWork } from './gather';
import { MS_TO_SECONDS, mul32 } from './num';
import { CrtRand } from './rng';
import { isEnabled, TECH_DONE } from './techs';
import { BARRACKS, BUILDER, CLUBMAN, HOUSE, TOWN_CENTER, unitType, VILLAGER } from './units';
import { ATTR_FOOD, ATTR_WOOD, World } from './world';

const ATTR_BUILDING_ALLOWANCE = 30;
const ATTR_POPULATION_LIMIT = 32;

function order(world: World, player: number, command: Command): void {
  world.addBatch(world.turn, player, [command]);
}

/** Run turns until `done` holds; fails after `limit` turns. */
function runUntil(world: World, done: () => boolean, limit = 400): void {
  for (let i = 0; i < limit && !done(); i++) world.runTurn();
  expect(done()).toBe(true);
}

/** The context the vectors step with: 50 ms steps. */
function stepContext(world: World) {
  const ctx = world.gameContext();
  ctx.deltaSeconds = mul32(50, MS_TO_SECONDS);
  expect(ctx.deltaSeconds).toBe(0.05000000074505806);
  return ctx;
}

function first(seed: number): number {
  const r = new CrtRand();
  r.srand(seed);
  return r.rand();
}

function units(world: World, owner: number, type: number): Entity[] {
  return [...world.entities.all()].filter((e) => e.owner === owner && e.type === type && e.state <= ObjectState.Active);
}

describe('start techs and the new game attributes', () => {
  test('player creation completes the zero-time start techs; new_game sets attributes 30, 32, 33, 45 for players', () => {
    const world = new World({ players: 2 });
    for (const p of [0, 1]) {
      for (const tech of [29, 82, 87, 88, 91, 99, 100, 104]) expect(world.techs[p]![tech]).toBe(TECH_DONE);
      // Stone Age (tech 100, effect 94).
      expect(world.attributes[p]![6]).toBe(1);
      // Techs 88-91 enable the Granary, Storage Pit, Dock and Barracks; the Barracks' own tech has not run.
      expect(isEnabled(world, p, BARRACKS)).toBe(true);
      expect(isEnabled(world, p, HOUSE)).toBe(true);
      expect(isEnabled(world, p, CLUBMAN)).toBe(false);
    }
    expect([30, 32, 33, 45].map((a) => world.attributes[1]![a])).toEqual([500, 50, 0, 1]);
    // Gaia keeps what the start techs gave (Stone Age adds 8 building allowance).
    expect([30, 32].map((a) => world.attributes[0]![a])).toEqual([8, 0]);
    expect(new World({ players: 2, populationLimit: 20 }).attributes[1]![ATTR_POPULATION_LIMIT]).toBe(20);
  });

  test('a starting Town Center is built all the way: +4 headroom, its tech 105 done', () => {
    const world = new World({ players: 2, units: [{ owner: 1, type: TOWN_CENTER, x: 20.5, y: 20.5 }] });
    const tc = world.entities.get(1)!;
    expect(tc.state).toBe(ObjectState.Active);
    expect([tc.hp, tc.buildPoints]).toEqual([unitType(TOWN_CENTER).hitPoints, unitType(TOWN_CENTER).creatable!.trainTime]);
    expect(world.attributes[1]![ATTR_HEADROOM]).toBe(4);
    expect(world.techs[1]![105]).toBe(TECH_DONE);
  });
});

describe('economy.md §8.2 vector E2: one builder raises a Barracks', () => {
  test('build points and hp per 50 ms step; hp first 350 at step 599, complete at step 601 with one fenced draw', () => {
    const world = new World({ players: 2, units: [{ owner: 1, type: BUILDER, x: 18.5, y: 20.5 }] });
    const builder = world.entities.get(1)!;
    const barracks = world.createObject(1, BARRACKS, 20.5, 20.5, 0);
    expect([barracks.state, barracks.buildPoints, barracks.hp]).toEqual([ObjectState.Unbuilt, 0, 1]);
    const task = unitType(BUILDER).action!.tasks.findIndex((k) => k.actionType === ACTION_BUILD);
    // Already facing the foundation, in state 7.
    builder.work = { type: ACTION_BUILD, task, state: 7, timer: 0, target: barracks.id, target2: -1, x: barracks.x, y: barracks.y, z: 0 };
    const ctx = stepContext(world);
    const expected: Record<number, [number, number]> = {
      1: [0.05000000074505806, 1.5833332538604736],
      2: [0.10000000149011612, 2.1666665077209473],
      300: [15.000039100646973, 175.9998016357422],
    };
    let full = 0;
    for (let step = 1; step <= 600; step++) {
      updateWork(ctx, builder);
      const e = expected[step];
      if (e) expect([barracks.buildPoints, barracks.hp]).toEqual(e);
      if (full === 0 && barracks.hp === 350) full = step;
    }
    expect(full).toBe(599);
    expect(barracks.state).toBe(ObjectState.Unbuilt);
    expect(barracks.buildPoints).toBeLessThan(30);
    ctx.rng.srand(5);
    updateWork(ctx, builder);
    expect([barracks.buildPoints, barracks.hp, barracks.state]).toEqual([30, 350, ObjectState.Active]);
    // Completion: rand() then srand(r); the standing sprite draws nothing.
    expect(ctx.rng.rand()).toBe(first(first(5)));
    expect(builder.work.state).toBe(3);
    expect(world.techs[1]![62]).toBe(TECH_DONE);
    expect(isEnabled(world, 1, CLUBMAN)).toBe(true);
  });
});

describe('economy.md §8.3 vector E3: Town Center trains a villager and places it', () => {
  test('food 200 -> 150; work_done reaches 20 at step 401; placed at (21.621126174926758, 22.209999084472656)', () => {
    const world = new World({ players: 2, units: [{ owner: 1, type: TOWN_CENTER, x: 20.5, y: 20.5 }] });
    const tc = world.entities.get(1)!;
    const ctx = stepContext(world);
    const attributes = world.attributes[1]!;
    expect(attributes[ATTR_FOOD]).toBe(200);
    addToQueue(ctx, tc, VILLAGER, 1);
    expect(attributes[ATTR_FOOD]).toBe(150);
    expect([attributes[ATTR_HEADROOM], attributes[ATTR_POPULATION]]).toEqual([4, 0]);
    for (let step = 1; step <= 400; step++) updateQueue(ctx, tc);
    expect(tc.train!.workDone).toBeLessThan(20);
    expect(world.entities.size).toBe(1);
    ctx.rng.srand(14);
    updateQueue(ctx, tc);
    expect(tc.train).toBeNull();
    expect(tc.queue).toEqual([]);
    const man = world.entities.get(2)!;
    expect([man.type, man.x, man.y]).toEqual([VILLAGER, 21.621126174926758, 22.209999084472656]);
    // srand(14)'s stream: 84 (side 0), 27125 (offset), then the Villager's setup: 9192 for its standing sprite's start
    // frame, the next value for the setup fence (reseeded with it), one draw for its facing, one for its unit AI's idle
    // timeout.
    const stream = new CrtRand();
    stream.srand(14);
    expect([stream.rand(), stream.rand(), stream.rand()]).toEqual([84, 27125, 9192]);
    const after = new CrtRand();
    after.srand(stream.rand());
    after.rand();
    after.rand();
    expect(ctx.rng.rand()).toBe(after.rand());
    expect([attributes[ATTR_HEADROOM], attributes[ATTR_POPULATION]]).toEqual([3, 1]);
  });

  test('the train time adds up as n float32 increments: 20.04998016357422 after 401 steps', () => {
    let done = 0;
    const dts = mul32(50, MS_TO_SECONDS);
    for (let step = 1; step <= 401; step++) done = Math.fround(dts + done);
    expect(done).toBe(20.04998016357422);
  });
});

describe('economy.md §8.4 vector E4: cancelling a Barracks at 12 build points', () => {
  test('refund p = 0.30000001192092896 of the 125 wood: 37.5; hp 0, the building dies and returns its allowance', () => {
    const world = new World({ players: 2 });
    const barracks = world.createObject(1, BARRACKS, 20.5, 20.5, 0);
    const attributes = world.attributes[1]!;
    expect(attributes[ATTR_BUILDING_ALLOWANCE]).toBe(499);
    barracks.buildPoints = 12;
    const wood = attributes[ATTR_WOOD]!;
    cancelBuild(world.gameContext(), barracks);
    expect(Math.fround(((30 - 12) / 30) * 0.5)).toBe(0.30000001192092896);
    expect(attributes[ATTR_WOOD]).toBe(wood + 37.5);
    expect(barracks.hp).toBe(0);
    runUntil(world, () => !world.entities.get(barracks.id), 10);
    expect(attributes[ATTR_BUILDING_ALLOWANCE]).toBe(500);
  });

  test('the cancel command on a new foundation refunds half its cost', () => {
    const world = new World({ players: 2 });
    // The site must be explored (placement reason 5): player 1 has seen it before.
    world.visibility.explore(1, 20, 20, 4, false);
    order(world, 1, { type: 'build', units: [], unitType: BARRACKS, x: 20.5, y: 20.5 });
    runUntil(world, () => world.entities.size === 1, 5);
    expect(world.attributes[1]![ATTR_WOOD]).toBe(75);
    order(world, 1, { type: 'cancel', target: 1 });
    runUntil(world, () => world.attributes[1]![ATTR_WOOD] !== 75, 5);
    expect(world.attributes[1]![ATTR_WOOD]).toBe(137.5);
    expect(world.entities.get(1)!.state).toBeGreaterThan(ObjectState.Active);
    // Rubble (the Barracks' dead object) takes its place.
    runUntil(world, () => !world.entities.get(1), 40);
    expect([...world.entities.all()].map((e) => e.type)).toEqual([unitType(BARRACKS).deadUnitId]);
  });
});

describe('construction and training through commands', () => {
  /** Player 1: a Town Center built at start and three Villagers next to it. */
  function base(options: { populationLimit?: number } = {}): World {
    return new World({
      players: 2,
      units: [
        { owner: 1, type: VILLAGER, x: 16.5, y: 16.5 },
        { owner: 1, type: VILLAGER, x: 17.5, y: 16.5 },
        { owner: 1, type: VILLAGER, x: 18.5, y: 16.5 },
        { owner: 1, type: TOWN_CENTER, x: 17.5, y: 19.5 },
      ],
      ...options,
    });
  }

  test('a foundation in the way of another building or off the map is refused and costs nothing', () => {
    const world = base();
    order(world, 1, { type: 'build', units: [1], unitType: HOUSE, x: 17.5, y: 19.5 });
    order(world, 1, { type: 'build', units: [1], unitType: HOUSE, x: 0.5, y: 0.5 });
    for (let i = 0; i < 4; i++) world.runTurn();
    expect(world.entities.size).toBe(4);
    expect(world.attributes[1]![ATTR_WOOD]).toBe(200);
  });

  test('House then train to the population cap: the cap blocks further training', () => {
    const world = base();
    const attributes = world.attributes[1]!;
    // Three Villagers in a Town Center's 4: headroom 1.
    expect([attributes[ATTR_HEADROOM], attributes[ATTR_POPULATION]]).toEqual([1, 3]);
    order(world, 1, { type: 'build', units: [1, 2, 3], unitType: HOUSE, x: 21, y: 16 });
    runUntil(world, () => world.entities.size === 5, 5);
    const house = world.entities.get(5)!;
    expect([house.type, house.state]).toEqual([HOUSE, ObjectState.Unbuilt]);
    // The Villagers turned Builders.
    runUntil(world, () => world.entities.get(1)!.type === BUILDER, 5);
    runUntil(world, () => house.state === ObjectState.Active);
    expect(attributes[ATTR_HEADROOM]).toBe(5);

    attributes[ATTR_FOOD] = 1000;
    order(world, 1, { type: 'queue', building: 4, unit: VILLAGER, count: 8 });
    runUntil(world, () => units(world, 1, VILLAGER).length === 5, 600);
    expect(attributes[ATTR_FOOD]).toBe(600);
    expect([attributes[ATTR_HEADROOM], attributes[ATTR_POPULATION]]).toEqual([0, 8]);
    const tc = world.entities.get(4)!;
    expect(tc.queue).toEqual([{ unit: VILLAGER, count: 3 }]);
    // No headroom: nothing more trains however long the queue waits.
    for (let i = 0; i < 100; i++) world.runTurn();
    expect(units(world, 1, VILLAGER).length).toBe(5);
    expect(tc.train).toBeNull();
    expect(tc.queue).toEqual([{ unit: VILLAGER, count: 3 }]);
    // Unqueueing refunds the waiting units.
    order(world, 1, { type: 'queue', building: 4, unit: VILLAGER, count: -3 });
    runUntil(world, () => tc.queue!.length === 0, 5);
    expect(attributes[ATTR_FOOD]).toBe(750);
  });

  test('queue and cancel aimed at another player\'s object are ignored but draw their rand() like a noop (economy.md §5.5)', () => {
    /** Player 1's base plus a foundation of player 1's; player 2 sends `command` in the first turn, the rest idle. */
    function run(command: Command): World {
      const world = base();
      world.attributes[1]![ATTR_FOOD] = 1000;
      order(world, 1, { type: 'build', units: [], unitType: HOUSE, x: 21, y: 16 });
      for (let i = 0; i < 3; i++) world.runTurn();
      expect(world.entities.get(5)!.state).toBe(ObjectState.Unbuilt);
      order(world, 2, command);
      for (let i = 0; i < 5; i++) world.runTurn();
      return world;
    }
    const baseline = run({ type: 'noop' });
    const queued = run({ type: 'queue', building: 4, unit: VILLAGER, count: 1 });
    const cancelled = run({ type: 'cancel', target: 5 });
    for (const world of [queued, cancelled]) {
      expect(world.entities.get(4)!.queue).toEqual([]);
      expect(world.entities.get(4)!.train).toBeNull();
      expect(world.entities.get(5)!.state).toBe(ObjectState.Unbuilt);
      expect(world.attributes[1]![ATTR_FOOD]).toBe(1000);
      expect(world.attributes[1]![ATTR_WOOD]).toBe(baseline.attributes[1]![ATTR_WOOD]);
      // Same state, random stream included, as a world that received a noop.
      expect(world.hash()).toBe(baseline.hash());
    }
  });

  test('the owner\'s own queue and cancel commands still work', () => {
    const world = base();
    world.attributes[1]![ATTR_FOOD] = 1000;
    order(world, 1, { type: 'build', units: [], unitType: HOUSE, x: 21, y: 16 });
    order(world, 1, { type: 'queue', building: 4, unit: VILLAGER, count: 1 });
    for (let i = 0; i < 3; i++) world.runTurn();
    expect(world.entities.get(4)!.queue).toEqual([{ unit: VILLAGER, count: 1 }]);
    expect(world.attributes[1]![ATTR_FOOD]).toBe(950);
    order(world, 1, { type: 'cancel', target: 5 });
    runUntil(world, () => world.entities.get(5)!.state > ObjectState.Active, 5);
  });

  test('the population limit (attribute 32) stops training even with headroom left', () => {
    const world = base({ populationLimit: 3 });
    const attributes = world.attributes[1]!;
    order(world, 1, { type: 'queue', building: 4, unit: VILLAGER, count: 1 });
    for (let i = 0; i < 100; i++) world.runTurn();
    expect(units(world, 1, VILLAGER).length).toBe(3);
    expect([attributes[ATTR_HEADROOM], attributes[ATTR_POPULATION]]).toEqual([1, 3]);
    expect(world.entities.get(4)!.queue).toEqual([{ unit: VILLAGER, count: 1 }]);
    expect(world.entities.get(4)!.train).toBeNull();
  });
});
