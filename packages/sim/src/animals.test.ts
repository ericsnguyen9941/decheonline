import { describe, expect, test } from 'vitest';
import type { Command } from './commands';
import { ObjectState, type Entity } from './entities';
import { add32, mul32 } from './num';
import { AiClass } from './unit-ai';
import { ALLIGATOR, BOWMAN, CLUBMAN, ELEPHANT, GAZELLE, HUNTER, LION, TOWN_CENTER, VILLAGER } from './units';
import { VICTORY_SPECIAL } from './victory';
import { World, type StartUnit } from './world';

/** Gaia and two players; ids follow the list order from 1. Conquest off, so a side left with nothing does not end it. */
function world(...units: StartUnit[]): World {
  return new World({ players: 3, units, victory: { type: VICTORY_SPECIAL } });
}

function order(w: World, player: number, command: Command): void {
  w.addBatch(w.turn, player, [command]);
}

/** Run turns until `done` holds; fails after `limit` turns. */
function runUntil(w: World, done: () => boolean, limit = 600): void {
  for (let i = 0; i < limit && !done(); i++) w.runTurn();
  expect(done()).toBe(true);
}

function distance(a: Entity, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

describe('unit-ai.md §5.2: a hunted elephant fights back', () => {
  test('a Villager spears a wild Elephant: it records the hunter, charges it and kills it', () => {
    const w = world(
      { owner: 1, type: VILLAGER, x: 12.5, y: 10.5 },
      { owner: 0, type: ELEPHANT, x: 16.5, y: 12.5 },
      { owner: 1, type: TOWN_CENTER, x: 6.5, y: 10.5 },
    );
    const [hunter, elephant] = [w.entities.get(1)!, w.entities.get(2)!];
    expect(elephant.ai!.kind).toBe(AiClass.Elephant);
    const start = { x: elephant.x, y: elephant.y };
    order(w, 1, { type: 'work', units: [1], target: 2, x: elephant.x, y: elephant.y });
    runUntil(w, () => elephant.attack?.target === 1);
    expect(hunter.type).toBe(HUNTER);
    expect(elephant.ai!.target).toBe(1);
    expect(elephant.ai!.attackers).toEqual([1]);
    let moved = 0;
    runUntil(w, () => {
      moved = Math.max(moved, distance(elephant, start));
      return hunter.state > ObjectState.Active || elephant.state > ObjectState.Active;
    });
    expect(moved).toBeGreaterThan(1);
    expect(hunter.hp).toBe(0);
    expect(elephant.state).toBe(ObjectState.Active);
  });

  test('an idle Elephant ignores a Villager in view', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 12.5, y: 10.5 }, { owner: 0, type: ELEPHANT, x: 14.5, y: 10.5 });
    const elephant = w.entities.get(2)!;
    for (let i = 0; i < 100; i++) w.runTurn();
    expect([elephant.x, elephant.y, elephant.ai!.action]).toEqual([14.5, 10.5, -1]);
  });
});

describe('unit-ai.md §5.3: a lion hunts what comes into its view', () => {
  test('an idle Lion attacks a Villager within its sight, kills it, then rests 18.75..31.25 s', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 12.5, y: 10.5 }, { owner: 0, type: LION, x: 14.5, y: 10.5 });
    const [villager, lion] = [w.entities.get(1)!, w.entities.get(2)!];
    expect(lion.ai!.kind).toBe(AiClass.Lion);
    // A Villager fights back against an animal (unit-ai.md §4.3) and wins from full health, so this one is hurt.
    villager.hp = 5;
    runUntil(w, () => lion.attack?.target === 1);
    expect(lion.ai!.target).toBe(1);
    runUntil(w, () => villager.state > ObjectState.Active || lion.state > ObjectState.Active, 1200);
    expect(villager.hp).toBe(0);
    runUntil(w, () => lion.ai!.action === -1 && lion.ai!.target === -1, 100);
    expect(lion.ai!.idleTimeout).toBe(25000);
    expect(lion.ai!.adjustedIdleTimeout).toBeGreaterThanOrEqual(18750);
    expect(lion.ai!.adjustedIdleTimeout).toBeLessThan(31250);
  });

  test('a Villager outside the Lion sight (3 tiles) is left alone', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 }, { owner: 0, type: LION, x: 16.5, y: 10.5 });
    const lion = w.entities.get(2)!;
    for (let i = 0; i < 150; i++) w.runTurn();
    expect([lion.x, lion.y, lion.ai!.action]).toEqual([16.5, 10.5, -1]);
  });

  test('a Lion attacked from outside its sight fights back (base reaction)', () => {
    const w = world({ owner: 1, type: BOWMAN, x: 10.5, y: 10.5 }, { owner: 0, type: LION, x: 15.5, y: 10.5 });
    const lion = w.entities.get(2)!;
    order(w, 1, { type: 'attack', units: [1], target: 2 });
    runUntil(w, () => lion.attack?.target === 1);
    expect(lion.ai!.target).toBe(1);
  });
});

describe('unit-ai.md §5.4: an alligator attacks on sight', () => {
  test('an idle Alligator picks a Villager in view with bestUnitToAttack and attacks it', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 12.5, y: 10.5 }, { owner: 0, type: ALLIGATOR, x: 15.5, y: 10.5 });
    const alligator = w.entities.get(2)!;
    expect(alligator.ai!.kind).toBe(AiClass.Predator);
    runUntil(w, () => alligator.attack?.target === 1);
    expect(alligator.ai!.target).toBe(1);
  });
});

describe('unit-ai.md §5.1: a gazelle runs', () => {
  test('a speared Gazelle records the hunter and runs 4 × its speed directly away', () => {
    const w = world(
      { owner: 1, type: VILLAGER, x: 12.5, y: 10.5 },
      { owner: 0, type: GAZELLE, x: 16.5, y: 10.5 },
      { owner: 1, type: TOWN_CENTER, x: 6.5, y: 10.5 },
    );
    const gazelle = w.entities.get(2)!;
    expect(gazelle.ai!.kind).toBe(AiClass.Hunted);
    order(w, 1, { type: 'work', units: [1], target: 2, x: gazelle.x, y: gazelle.y });
    runUntil(w, () => gazelle.ai!.attackers.length > 0);
    expect(gazelle.ai!.attackers).toEqual([1]);
    const move = gazelle.mover!.action!;
    // From where it stood when hit: the hunter is due west, so it runs due east.
    expect([move.x, move.y]).toEqual([add32(16.5, mul32(4, 1.100000023841858)), 10.5]);
    expect(gazelle.hp).toBeGreaterThan(0);
  });

  test('an idle Gazelle runs from a Villager in its view and never attacks', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 14.5, y: 10.5 }, { owner: 0, type: GAZELLE, x: 15.5, y: 10.5 });
    const [villager, gazelle] = [w.entities.get(1)!, w.entities.get(2)!];
    runUntil(w, () => !!gazelle.mover!.action, 200);
    expect(gazelle.mover!.action!.x).toBeGreaterThan(15.5);
    runUntil(w, () => !gazelle.mover!.action, 200);
    expect(distance(gazelle, villager)).toBeGreaterThan(3);
    expect(villager.hp).toBe(25);
  });
});

describe('unit-ai.md §4.2: a soldier attacked at range closes in', () => {
  test('an idle Clubman shot by a Bowman 4.5 tiles away walks to it and attacks', () => {
    const w = world({ owner: 1, type: BOWMAN, x: 12.5, y: 10.5 }, { owner: 2, type: CLUBMAN, x: 16.5, y: 12.5 });
    const [bowman, clubman] = [w.entities.get(1)!, w.entities.get(2)!];
    const start = { x: clubman.x, y: clubman.y };
    order(w, 1, { type: 'attack', units: [1], target: 2 });
    runUntil(w, () => clubman.attack?.target === 1);
    expect(clubman.ai!.target).toBe(1);
    runUntil(w, () => bowman.hp < 35 || clubman.state > ObjectState.Active);
    expect(distance(clubman, start)).toBeGreaterThan(3);
  });
});
