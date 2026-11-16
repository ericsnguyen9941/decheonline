import { describe, expect, test } from 'vitest';
import { ATTACK_FAILED } from './combat';
import { parseCommand, type Command } from './commands';
import { ObjectState, type Entity } from './entities';
import { NOTIFY_CANNOT_REPAIR } from './game-log';
import { ACTION_GATHER } from './gather';
import { typeOf } from './masters';
import { add32, div32, f32, mul32, sub32 } from './num';
import { ACTION_REPAIR, REPAIR_MAN } from './repair';
import { AI_ACTION_ATTACK, AI_ACTION_REPAIR, AI_ORDER_REPAIR, AI_ORDER_STAND_GROUND } from './unit-ai';
import { BOWMAN, CLUBMAN, HOUSE, MINE_GOLD, TOWN_CENTER, VILLAGER } from './units';
import { VICTORY_SPECIAL } from './victory';
import { ATTR_WOOD, COMMAND_DELAY_TURNS, World, type StartUnit } from './world';

function order(world: World, player: number, command: Command): void {
  world.addBatch(world.turn, player, [command]);
}

/** Run the turns up to and including the one a command issued now executes on. */
function applied(world: World): void {
  for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) world.runTurn();
}

/** Run turns until `done` holds; fails after `limit` turns. */
function runUntil(world: World, done: () => boolean, limit = 400): void {
  for (let i = 0; i < limit && !done(); i++) world.runTurn();
  expect(done()).toBe(true);
}

/** Gaia and two players with these objects; ids follow the list order from 1. Conquest off. */
function world(...units: StartUnit[]): World {
  return new World({ players: 3, units, victory: { type: VICTORY_SPECIAL } });
}

describe('commands.md §1: the new commands on the wire', () => {
  test('repair and stand-ground parse to fresh objects; bad ids, empty or oversized unit lists are rejected', () => {
    expect(parseCommand({ type: 'repair', units: [3, 4], target: 7, extra: 1 })).toEqual({ type: 'repair', units: [3, 4], target: 7 });
    expect(parseCommand({ type: 'stand-ground', units: [3] })).toEqual({ type: 'stand-ground', units: [3] });
    expect(parseCommand({ type: 'repair', units: [3], target: 0 })).toBeNull();
    expect(parseCommand({ type: 'repair', units: [], target: 7 })).toBeNull();
    expect(parseCommand({ type: 'stand-ground', units: [] })).toBeNull();
    expect(parseCommand({ type: 'stand-ground', units: Array.from({ length: 256 }, (_, i) => i + 1) })).toBeNull();
    expect(parseCommand({ type: 'stand-ground', units: [1.5] })).toBeNull();
  });
});

describe('commands.md §2: stop on units', () => {
  test('a walking Villager stops where it is: no action, no order, standing sprite', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 });
    const v = w.entities.get(1)!;
    order(w, 1, { type: 'move', units: [1], x: 30.5, y: 10.5 });
    applied(w);
    w.runTurn();
    expect(v.mover!.action).not.toBeNull();
    order(w, 1, { type: 'stop', objects: [1] });
    applied(w);
    const x = v.x;
    expect([v.mover!.action, v.ai!.order, v.ai!.action]).toEqual([null, -1, -1]);
    for (let i = 0; i < 5; i++) w.runTurn();
    expect(v.x).toBe(x);
    expect(v.sprite!.graphic).toBe(typeOf(w, v).standing.graphic);
  });

  test('a gathering Villager drops its gather action and stays idle', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 }, { owner: 0, type: MINE_GOLD, x: 12.5, y: 10.5 });
    const v = w.entities.get(1)!;
    order(w, 1, { type: 'work', units: [1], target: 2, x: 12.5, y: 10.5 });
    applied(w);
    expect(v.work?.type).toBe(ACTION_GATHER);
    order(w, 1, { type: 'stop', objects: [1] });
    applied(w);
    expect([v.work, v.ai!.order, v.ai!.action]).toEqual([null, -1, -1]);
    for (let i = 0; i < 10; i++) w.runTurn();
    expect(v.work).toBeNull();
  });

  test('an attacking Clubman stops attacking; another player cannot stop it', () => {
    const w = world({ owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 }, { owner: 2, type: HOUSE, x: 14, y: 10 });
    const c = w.entities.get(1)!;
    const house = w.entities.get(2)!;
    order(w, 1, { type: 'attack', units: [1], target: 2 });
    applied(w);
    order(w, 2, { type: 'stop', objects: [1] });
    applied(w);
    expect([c.attack?.target, c.ai!.action]).toEqual([2, AI_ACTION_ATTACK]);
    runUntil(w, () => house.hp < 75);
    order(w, 1, { type: 'stop', objects: [1] });
    applied(w);
    expect([c.attack ?? null, c.ai!.order, c.ai!.action]).toEqual([null, -1, -1]);
    const hp = house.hp;
    for (let i = 0; i < 20; i++) w.runTurn();
    expect(house.hp).toBe(hp);
  });
});

describe('commands.md §3: stand ground', () => {
  test('a Bowman standing its ground shoots a Villager in range on its own but does not follow it when it flees', () => {
    const w = world({ owner: 1, type: BOWMAN, x: 10.5, y: 10.5 }, { owner: 2, type: VILLAGER, x: 14.5, y: 10.5 });
    const bowman = w.entities.get(1)!;
    const villager = w.entities.get(2)!;
    order(w, 1, { type: 'stand-ground', units: [1] });
    applied(w);
    expect([bowman.ai!.order, bowman.ai!.action, bowman.x, bowman.y]).toEqual([AI_ORDER_STAND_GROUND, -1, 10.5, 10.5]);
    // Its idle scan finds the Villager (an attack order would replace the stand-ground order).
    runUntil(w, () => villager.hp < 25);
    expect(bowman.ai!.order).toBe(AI_ORDER_STAND_GROUND);
    // Hit, the Villager runs away east (unit-ai.md §4.3); a Bowman not standing its ground follows it (combat Example 8).
    for (let i = 0; i < 100; i++) w.runTurn();
    expect(villager.x).toBeGreaterThan(14.5);
    expect([bowman.x, bowman.y]).toEqual([10.5, 10.5]);
  });

  test('an idle Clubman standing its ground does not walk to a Villager in view; one at its side it attacks', () => {
    const w = world({ owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 }, { owner: 2, type: VILLAGER, x: 13.5, y: 10.5 });
    const c = w.entities.get(1)!;
    order(w, 1, { type: 'stand-ground', units: [1] });
    applied(w);
    for (let i = 0; i < 60; i++) w.runTurn();
    expect([c.x, c.y, c.ai!.order]).toEqual([10.5, 10.5, AI_ORDER_STAND_GROUND]);
    expect(c.attack?.state ?? ATTACK_FAILED).toBe(ATTACK_FAILED);
    expect(w.entities.get(2)!.hp).toBe(25);

    const near = world({ owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 }, { owner: 2, type: VILLAGER, x: 11.3, y: 10.5 });
    order(near, 1, { type: 'stand-ground', units: [1] });
    applied(near);
    const villager = near.entities.get(2)!;
    runUntil(near, () => villager.hp < 25, 60);
    expect([near.entities.get(1)!.x, near.entities.get(1)!.y]).toEqual([10.5, 10.5]);
  });

  test('another player cannot make a unit stand its ground', () => {
    const w = world({ owner: 1, type: BOWMAN, x: 10.5, y: 10.5 });
    order(w, 2, { type: 'stand-ground', units: [1] });
    applied(w);
    expect(w.entities.get(1)!.ai!.order).toBe(-1);
  });
});

/** A Villager of player 1 beside its Town Center (300 of 600 hp), and 1000 wood. */
function damagedTownCenter(): { w: World; v: Entity; tc: Entity } {
  const w = world({ owner: 1, type: TOWN_CENTER, x: 20.5, y: 20.5 }, { owner: 1, type: VILLAGER, x: 22.5, y: 20.5 });
  const tc = w.entities.get(1)!;
  tc.hp = 300;
  w.attributes[1]![ATTR_WOOD] = 1000;
  return { w, v: w.entities.get(2)!, tc };
}

describe('support-actions.md §6 / §10.4 Example D: repair', () => {
  test('repair command: the Villager becomes the Repair_Man; 0.27000001 hp and 0.045 wood a 90 ms step; full after 1112 steps', () => {
    const { w, v, tc } = damagedTownCenter();
    expect(typeOf(w, tc).hitPoints).toBe(600);
    order(w, 1, { type: 'repair', units: [2], target: 1 });
    applied(w);
    expect([v.type, v.work?.type, v.work?.target, v.ai!.order, v.ai!.action]).toEqual([REPAIR_MAN, ACTION_REPAIR, 1, AI_ORDER_REPAIR, AI_ACTION_REPAIR]);
    // amount = float(0.75 × 0.090000004) × 0.4; h = amount × 600 / 60, added to the float hp each working step.
    const amount = mul32(mul32(f32(0.75), w.deltaSeconds), f32(0.4));
    const h = div32(mul32(amount, 600), 60);
    expect([amount, h]).toEqual([f32(0.027000001), f32(0.27000001)]);
    let expected = f32(300);
    let steps = 0;
    for (let n = 0; tc.hp < 600; n++) {
      const before = tc.hp;
      w.runStep();
      expect(n).toBeLessThan(2000);
      if (tc.hp === before) continue;
      steps++;
      expected = add32(expected, h) > 600 ? f32(600) : add32(expected, h);
      expect(tc.hp).toBe(expected);
    }
    expect(steps).toBe(1112);
    // Half of 200 wood × 300/600, with float stores: 1000 → 950.0186157226562.
    expect(w.attributes[1]![ATTR_WOOD]).toBe(f32(950.01862));
    // Done: the action ends, the unit stays a Repair_Man, idle.
    runUntil(w, () => v.work === null, 5);
    expect([v.type, v.ai!.order, v.ai!.action]).toEqual([REPAIR_MAN, -1, -1]);
  });

  test('without wood nothing is repaired and the repair ends; the owner is told it cannot repair (cantdo.wav)', () => {
    const { w, v, tc } = damagedTownCenter();
    w.attributes[1]![ATTR_WOOD] = 0;
    order(w, 1, { type: 'repair', units: [2], target: 1 });
    applied(w);
    runUntil(w, () => v.work === null, 40);
    expect([tc.hp, v.ai!.action]).toEqual([300, -1]);
    const refusals = w.log.notifications.filter((n) => n.type === NOTIFY_CANNOT_REPAIR).map((n) => n.args.slice(0, 2));
    expect(refusals).toEqual([[1, tc.id]]);
  });

  test('a right-click work order on a damaged own building repairs it (the Villager swaps to the Repair_Man)', () => {
    const { w, v, tc } = damagedTownCenter();
    order(w, 1, { type: 'work', units: [2], target: 1, x: tc.x, y: tc.y });
    applied(w);
    expect([v.type, v.work?.type, v.ai!.action]).toEqual([REPAIR_MAN, ACTION_REPAIR, AI_ACTION_REPAIR]);
    runUntil(w, () => tc.hp > 310, 40);
  });

  test('a builder whose finished building is damaged repairs it (src/tact_bld.cpp:155-162)', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 });
    const v = w.entities.get(1)!;
    order(w, 1, { type: 'build', units: [1], unitType: HOUSE, x: 13, y: 10 });
    applied(w);
    const house = [...w.entities.all()].find((e) => e.type === HOUSE)!;
    runUntil(w, () => house.hp > 20, 200);
    house.hp = sub32(house.hp, 10);
    runUntil(w, () => house.state === ObjectState.Active, 400);
    runUntil(w, () => v.work?.type === ACTION_REPAIR, 5);
    expect([v.type, v.work?.target, v.ai!.order]).toEqual([REPAIR_MAN, house.id, AI_ORDER_REPAIR]);
    runUntil(w, () => house.hp === 75 && v.work === null, 400);
  });

  test('guards: another player\'s Villager and a Bowman are skipped; an enemy building and a full one are not repaired', () => {
    const { w, v, tc } = damagedTownCenter();
    const enemy = w.createUnit({ owner: 2, type: VILLAGER, x: 18.5, y: 20.5 });
    const bowman = w.createUnit({ owner: 1, type: BOWMAN, x: 20.5, y: 22.5 });
    order(w, 2, { type: 'repair', units: [v.id], target: tc.id });
    order(w, 1, { type: 'repair', units: [bowman.id], target: tc.id });
    applied(w);
    expect([v.type, v.work ?? null, bowman.type, tc.hp]).toEqual([VILLAGER, null, BOWMAN, 300]);
    // As in the original, the enemy's Villager becomes its Repair_Man; the repair ends at once (not its building).
    order(w, 2, { type: 'repair', units: [enemy.id], target: tc.id });
    applied(w);
    w.runTurn();
    expect([enemy.type, enemy.work ?? null, tc.hp]).toEqual([REPAIR_MAN, null, 300]);
    tc.hp = 600;
    order(w, 1, { type: 'repair', units: [v.id], target: tc.id });
    applied(w);
    w.runTurn();
    expect([tc.hp, v.work ?? null, w.attributes[1]![ATTR_WOOD]]).toEqual([600, null, 1000]);
  });
});
