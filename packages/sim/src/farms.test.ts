import { describe, expect, test } from 'vitest';
import type { Command } from './commands';
import { ObjectState, type Entity } from './entities';
import { ACTION_GATHER, WORK_IDLE, WORK_WORKING } from './gather';
import { ATTR_FARM_FOOD, startMake, updateMake } from './make';
import { typeOf } from './masters';
import { add32, f32, mul32, MS_TO_SECONDS, sub32 } from './num';
import { isEnabled } from './techs';
import { AI_ACTION_GATHER, AI_ACTION_MOVE } from './unit-ai';
import { BUILDER, FARM, MARKET, TOWN_CENTER, VILLAGER } from './units';
import { VICTORY_SPECIAL } from './victory';
import { ATTR_FOOD, ATTR_WOOD, COMMAND_DELAY_TURNS, World, type StartUnit } from './world';

const FARMER = 259;
const DEAD_FARM = 244;
/** Graphics (empires.dat): the Farm, the Farmer's work sprite "Man Farm", its carry sprite "Carry Farmer". */
const FARM_SPRITE = 273;
const MAN_FARM = 468;
const CARRY_FARMER = 829;

function order(world: World, player: number, command: Command): void {
  world.addBatch(world.turn, player, [command]);
}

/** Run the turns up to and including the one a command issued now executes on. */
function applied(world: World): void {
  for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) world.runTurn();
}

/** Run turns until `done` holds; fails after `limit` turns. */
function runUntil(world: World, done: () => boolean, limit = 2000): void {
  for (let i = 0; i < limit && !done(); i++) world.runTurn();
  expect(done()).toBe(true);
}

/** Gaia and two players with these objects; ids follow the list order from 1. Conquest off. */
function world(...units: StartUnit[]): World {
  return new World({ players: 3, units, victory: { type: VICTORY_SPECIAL } });
}

const farmsOf = (w: World) => [...w.entities.all()].filter((e) => e.type === FARM);

/** A Villager (1), a Market (2) and a Town Center (3) for player 1: the Market's tech has enabled the Farm. */
function farmWorld(...more: StartUnit[]): World {
  return world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 }, { owner: 1, type: MARKET, x: 20, y: 20 }, { owner: 1, type: TOWN_CENTER, x: 10, y: 20 }, ...more);
}

/** Built Farm `id`, its make action started as its first update would (`set_task(default_task)`). */
function builtFarm(w: World, id: number): Entity {
  const farm = w.entities.get(id)!;
  startMake(w.gameContext(), farm, 0);
  return farm;
}

describe('economy.md §4.7: Farm requirement and foundation', () => {
  test('the Farm is enabled by the Market (tech 26), not before', () => {
    expect(isEnabled(world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 }), 1, FARM)).toBe(false);
    expect(isEnabled(farmWorld(), 1, FARM)).toBe(true);
  });

  test('placing a Farm costs 75 wood; its foundation holds its 15 food (type 0) and needs 30 build points', () => {
    const w = farmWorld();
    const wood = w.attributes[1]![ATTR_WOOD]!;
    order(w, 1, { type: 'build', units: [1], unitType: FARM, x: 13.5, y: 10.5 });
    applied(w);
    const [farm] = farmsOf(w);
    expect(w.attributes[1]![ATTR_WOOD]).toBe(wood - 75);
    expect([farm!.state, farm!.heldType, farm!.heldAmount, farm!.hp]).toEqual([ObjectState.Unbuilt, 0, 15, 1]);
    expect(typeOf(w, farm!).creatable!.trainTime).toBe(30);
  });
});

describe('economy.md §4.7: the Farm makes its food (RGE_Action_Make, vector F1)', () => {
  test('F1: the make action starts at attribute 36 (250); each 50 ms step adds 0.4 × dts to the Farm, capped at 15, and takes the increase off the timer', () => {
    const w = farmWorld({ owner: 1, type: FARM, x: 13.5, y: 10.5 });
    const farm = builtFarm(w, 4);
    expect([farm.heldType, farm.heldAmount, farm.make!.timer]).toEqual([16, 0, 250]);
    const ctx = w.gameContext();
    ctx.deltaSeconds = mul32(50, MS_TO_SECONDS);
    // work = work_rate × dts × work_val1, in that order: 0.4000000059604645 × 0.05000000074505806 × 1.
    const work = mul32(mul32(0.4000000059604645, ctx.deltaSeconds), 1);
    expect(work).toBe(0.020000001415610313);
    updateMake(ctx, farm, farm.make!);
    expect([farm.heldAmount, farm.make!.timer]).toEqual([work, sub32(250, work)]);
    let held = work;
    let timer = sub32(250, work);
    for (let step = 2; step <= 760; step++) {
      updateMake(ctx, farm, farm.make!);
      const next = Math.min(add32(work, held), 15);
      timer = sub32(timer, sub32(next, held));
      held = next;
      expect([farm.heldAmount, farm.make!.timer]).toEqual([held, timer]);
    }
    // 15 food after 750 steps (37.5 s); a full Farm grows no more and its timer stays.
    expect(farm.heldAmount).toBe(15);
    expect(farm.make!.timer).toBe(234.9969482421875);
  });

  test('a spent timer stops the growth; the Farm, once empty, tells its owner (OBJECT_DEPLETED) and dies into a Dead_Farm', () => {
    const w = farmWorld({ owner: 1, type: FARM, x: 13.5, y: 10.5 });
    const farm = builtFarm(w, 4);
    const ctx = w.gameContext();
    farm.make!.timer = f32(-0.01);
    farm.heldAmount = f32(3);
    updateMake(ctx, farm, farm.make!);
    expect([farm.heldAmount, farm.hp, w.depleted[1]]).toEqual([3, 50, 0]);
    farm.heldAmount = 0;
    updateMake(ctx, farm, farm.make!);
    expect([farm.hp, w.depleted[1]]).toEqual([0, 1]);
    runUntil(w, () => !w.entities.get(4));
    expect([...w.entities.all()].some((e) => e.type === DEAD_FARM && e.x === 13.5 && e.y === 10.5 && e.owner === 1)).toBe(true);
  });

  test('with attribute 36 at 0 the timer is ignored: the Farm never runs out', () => {
    const w = farmWorld({ owner: 1, type: FARM, x: 13.5, y: 10.5 });
    w.attributes[1]![ATTR_FARM_FOOD] = 0;
    const farm = builtFarm(w, 4);
    expect(farm.make!.timer).toBe(0);
    const ctx = w.gameContext();
    ctx.deltaSeconds = mul32(50, MS_TO_SECONDS);
    updateMake(ctx, farm, farm.make!);
    expect(farm.heldAmount).toBeGreaterThan(0);
    expect(farm.hp).toBe(50);
  });

  test('a built Farm starts its make action by itself on its first update, and Stop drops it: the next update starts it again from the full 250 (src/act_obj.cpp:366-407)', () => {
    const w = farmWorld({ owner: 1, type: FARM, x: 13.5, y: 10.5 });
    const farm = w.entities.get(4)!;
    expect(farm.make).toBeUndefined();
    // Turn 1 is one step: the make action starts and does nothing more.
    w.runTurn();
    expect([farm.heldType, farm.heldAmount, farm.make!.timer]).toEqual([16, 0, 250]);
    w.runTurn();
    expect(farm.make!.timer).toBeLessThan(250);
    for (let i = 0; i < 20; i++) w.runTurn();
    const before = farm.make!.timer;
    expect(before).toBeLessThan(245);
    order(w, 1, { type: 'stop', objects: [4] });
    applied(w);
    // The stop's turn: the action dropped, started again from 250 at the next step, then a few steps of growth.
    expect(farm.make!.timer).toBeGreaterThan(249);
  });
});

describe('economy.md §4.7: the Farmer', () => {
  test('the builder of a Farm becomes its Farmer once the Farm holds food, works it with the farming sprite and carries food home', () => {
    const w = farmWorld();
    const v = w.entities.get(1)!;
    order(w, 1, { type: 'build', units: [1], unitType: FARM, x: 13.5, y: 10.5 });
    applied(w);
    expect(v.type).toBe(BUILDER);
    const [farm] = farmsOf(w);
    runUntil(w, () => farm!.state === ObjectState.Active);
    expect(farm!.sprite!.graphic).toBe(FARM_SPRITE);
    runUntil(w, () => v.type === FARMER);
    expect([v.work!.type, v.work!.target, v.work!.targetType, v.ai!.action, v.ai!.targetType]).toEqual([ACTION_GATHER, farm!.id, FARM, AI_ACTION_GATHER, 3]);
    runUntil(w, () => v.work!.state === WORK_WORKING);
    expect(v.sprite!.graphic).toBe(MAN_FARM);
    const food = w.attributes[1]![ATTR_FOOD]!;
    runUntil(w, () => v.heldAmount >= 1 && v.work!.state !== WORK_WORKING);
    expect(v.sprite!.graphic).toBe(CARRY_FARMER);
    runUntil(w, () => w.attributes[1]![ATTR_FOOD]! > food);
    expect(w.attributes[1]![ATTR_FOOD]).toBe(food + 10);
  });

  test('a Farm yields its 250 food (and the last step’s overshoot) and dies; its Farmer, with no other Farm, steps 2.5 tiles off and idles', () => {
    const w = farmWorld({ owner: 1, type: FARM, x: 13.5, y: 10.5 });
    const v = w.entities.get(1)!;
    const food = w.attributes[1]![ATTR_FOOD]!;
    order(w, 1, { type: 'work', units: [1], target: 4, x: 13.5, y: 10.5 });
    applied(w);
    expect(v.type).toBe(FARMER);
    runUntil(w, () => !w.entities.get(4), 4000);
    expect(w.depleted[1]).toBe(1);
    runUntil(w, () => v.work?.state === WORK_IDLE && v.ai!.action === AI_ACTION_MOVE && v.mover!.speed === 0, 400);
    const gained = w.attributes[1]![ATTR_FOOD]! - food;
    expect(gained).toBeGreaterThanOrEqual(250);
    expect(gained).toBeLessThan(250.1);
    // The farm stood at (13.5, 10.5): the Farmer walked from its spot towards (x - 2.5, y - 2.5).
    expect(v.type).toBe(FARMER);
    expect(v.heldAmount).toBe(0);
  });

  test('a waiting Farmer whose Farm is gone takes the closest other active Farm', () => {
    const w = farmWorld({ owner: 1, type: FARM, x: 13.5, y: 10.5 }, { owner: 1, type: FARM, x: 13.5, y: 14.5 });
    const v = w.entities.get(1)!;
    order(w, 1, { type: 'work', units: [1], target: 4, x: 13.5, y: 10.5 });
    applied(w);
    runUntil(w, () => v.work?.state === WORK_WORKING);
    const first = w.entities.get(4)!;
    first.make!.timer = f32(0);
    first.heldAmount = f32(0);
    runUntil(w, () => !w.entities.get(4));
    runUntil(w, () => v.work?.target === 5 && v.ai!.target === 5);
    runUntil(w, () => v.work?.state === WORK_WORKING);
    expect(v.type).toBe(FARMER);
  });

  test('an empty Farm keeps its Farmer in state 7, taking nothing, until it grows food again', () => {
    const w = farmWorld({ owner: 1, type: FARM, x: 13.5, y: 10.5 });
    const v = w.entities.get(1)!;
    order(w, 1, { type: 'work', units: [1], target: 4, x: 13.5, y: 10.5 });
    applied(w);
    runUntil(w, () => v.work?.state === WORK_WORKING);
    // The Farmer (0.45/s) outpaces the Farm (0.4/s): the Farm runs dry and the Farmer stays on it.
    const farm = w.entities.get(4)!;
    runUntil(w, () => farm.heldAmount === 0 && v.heldAmount > 0 && v.heldAmount < 10);
    expect(v.work!.state).toBe(WORK_WORKING);
    expect(v.work!.target).toBe(4);
  });

  test('the make action and the depleted count survive a snapshot', () => {
    const w = farmWorld({ owner: 1, type: FARM, x: 13.5, y: 10.5 });
    for (let i = 0; i < 10; i++) w.runTurn();
    w.depleted[1] = 2;
    const copy = World.restore(JSON.parse(JSON.stringify(w.snapshot())) as ReturnType<World['snapshot']>);
    expect(copy.entities.get(4)!.make).toEqual(w.entities.get(4)!.make);
    expect(copy.depleted).toEqual(w.depleted);
    expect(copy.hash()).toBe(w.hash());
  });
});
