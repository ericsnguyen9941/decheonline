import { describe, expect, test } from 'vitest';
import type { Command } from './commands';
import { ObjectState, type Entity } from './entities';
import { mul32 } from './num';
import { AiClass } from './unit-ai';
import { ALLIGATOR, BOWMAN, CLUBMAN, ELEPHANT, GAZELLE, HUNTER, LION, LUMBERJACK, TOWN_CENTER, VILLAGER } from './units';
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

describe('unit-ai.md §5.5: with nothing acting on them, animals stand still (captain\'s decision 2026-11-16)', () => {
  test('a Gazelle, an Elephant, a Lion and an Alligator with no player unit near keep their exact position for 2 game minutes', () => {
    // A lone player Villager far away keeps the game going; the animals stand in each other's view.
    const w = world(
      { owner: 1, type: VILLAGER, x: 40.5, y: 40.5 },
      { owner: 0, type: GAZELLE, x: 10.5, y: 10.5 },
      { owner: 0, type: ELEPHANT, x: 12.5, y: 10.5 },
      { owner: 0, type: LION, x: 10.5, y: 12.5 },
      { owner: 0, type: ALLIGATOR, x: 12.5, y: 12.5 },
    );
    const animals = [2, 3, 4, 5].map((id) => w.entities.get(id)!);
    const start = animals.map((a) => [a.x, a.y]);
    while (w.worldTime < 120000) {
      w.runTurn();
      expect(animals.map((a) => [a.x, a.y])).toEqual(start);
    }
    expect(animals.map((a) => [a.hp > 0, a.mover?.action ?? null, a.attack ?? null])).toEqual(animals.map(() => [true, null, null]));
  });
});

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

  test('an Elephant charging a hunter who walks away a few tiles and stops follows it there and hits it', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 12.5, y: 10.5 }, { owner: 0, type: ELEPHANT, x: 16.5, y: 12.5 });
    const [hunter, elephant] = [w.entities.get(1)!, w.entities.get(2)!];
    order(w, 1, { type: 'work', units: [1], target: 2, x: elephant.x, y: elephant.y });
    runUntil(w, () => elephant.attack?.target === 1);
    order(w, 1, { type: 'move', units: [1], x: hunter.x - 6, y: hunter.y });
    const seen = { x: hunter.x, y: hunter.y };
    const hp = hunter.hp;
    // The charge re-paths to the hunter as it walks, never to where it stood when the charge began.
    runUntil(w, () => {
      expect(elephant.attack?.target).toBe(1);
      return hunter.hp < hp;
    }, 300);
    expect(distance(hunter, seen)).toBeGreaterThan(4);
    expect(distance(elephant, hunter)).toBeLessThan(2);
  });

  test('an idle Elephant ignores a Villager in view and stands still', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 12.5, y: 10.5 }, { owner: 0, type: ELEPHANT, x: 14.5, y: 10.5 });
    const [villager, elephant] = [w.entities.get(1)!, w.entities.get(2)!];
    for (let i = 0; i < 100; i++) {
      w.runTurn();
      expect(elephant.attack).toBeFalsy();
    }
    expect([elephant.ai!.action, elephant.ai!.target, villager.hp]).toEqual([-1, -1, 25]);
    expect([elephant.x, elephant.y]).toEqual([14.5, 10.5]);
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

  test('an idle Lion follows a Villager walking past and bites it', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 6.5 }, { owner: 0, type: LION, x: 13.5, y: 12.5 });
    const [villager, lion] = [w.entities.get(1)!, w.entities.get(2)!];
    order(w, 1, { type: 'move', units: [1], x: 10.5, y: 30.5 });
    runUntil(w, () => lion.attack?.target === 1);
    const seen = { x: villager.x, y: villager.y };
    runUntil(w, () => {
      expect(lion.attack?.target).toBe(1);
      return villager.hp < 25;
    }, 300);
    expect(distance(lion, villager)).toBeLessThan(1.5);
    expect(distance(lion, seen)).toBeGreaterThan(6);
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

  test('an idle Alligator follows a Villager walking past to where it stops and bites it', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 8.5, y: 10.5 }, { owner: 0, type: ALLIGATOR, x: 13.5, y: 12.5 });
    const [villager, alligator] = [w.entities.get(1)!, w.entities.get(2)!];
    order(w, 1, { type: 'move', units: [1], x: 19.5, y: 10.5 });
    runUntil(w, () => alligator.attack?.target === 1);
    const seen = { x: villager.x, y: villager.y };
    expect(seen.x).toBeLessThan(15);
    // The walk re-paths to the Villager as it moves, never to where it was seen, and the attack holds until the bite.
    runUntil(w, () => {
      expect(alligator.attack?.target).toBe(1);
      return villager.hp < 25;
    }, 300);
    expect(villager.x).toBeGreaterThan(18.5);
    expect(distance(alligator, villager)).toBeLessThan(1.5);
    expect(alligator.x - seen.x).toBeGreaterThan(4);
  });

  test('an Alligator chasing a Villager gives up once it is out of its sight (5 tiles) and stands', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 6.5, y: 10.5 }, { owner: 0, type: ALLIGATOR, x: 13.5, y: 12.5 });
    const [villager, alligator] = [w.entities.get(1)!, w.entities.get(2)!];
    order(w, 1, { type: 'move', units: [1], x: 30.5, y: 10.5 });
    runUntil(w, () => alligator.attack?.target === 1);
    runUntil(w, () => alligator.ai!.target === -1, 100);
    expect(distance(alligator, villager)).toBeGreaterThan(5);
    const stop = [alligator.x, alligator.y];
    for (let i = 0; i < 100; i++) w.runTurn();
    expect([alligator.x, alligator.y, alligator.attack ?? null, villager.hp]).toEqual([...stop, null, 25]);
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
    // Step by step: the spear lands after the Gazelle's own update of that step.
    for (let i = 0; i < 20000 && gazelle.ai!.attackers.length === 0; i++) w.runStep();
    expect(gazelle.ai!.attackers).toEqual([1]);
    const [hunter, move] = [w.entities.get(1)!, gazelle.mover!.action!];
    const run = { x: move.x - gazelle.x, y: move.y - gazelle.y };
    const away = { x: gazelle.x - hunter.x, y: gazelle.y - hunter.y };
    expect(Math.sqrt((run.x) ** 2 + (run.y) ** 2)).toBeCloseTo(mul32(4, 1.100000023841858), 4);
    expect((run.x * away.x + run.y * away.y) / (Math.sqrt((run.x) ** 2 + (run.y) ** 2) * Math.sqrt((away.x) ** 2 + (away.y) ** 2))).toBeCloseTo(1, 4);
    expect(gazelle.hp).toBeGreaterThan(0);
  });

  test('an idle Gazelle stands until a Villager walks up to it, then runs from it and never attacks', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 27.5, y: 10.5 }, { owner: 0, type: GAZELLE, x: 15.5, y: 10.5 });
    const [villager, gazelle] = [w.entities.get(1)!, w.entities.get(2)!];
    for (let i = 0; i < 100; i++) w.runTurn();
    expect([gazelle.x, gazelle.y, gazelle.ai!.action]).toEqual([15.5, 10.5, -1]);
    order(w, 1, { type: 'move', units: [1], x: 16.5, y: 10.5 });
    runUntil(w, () => gazelle.ai!.action !== -1, 200);
    expect(distance(villager, gazelle)).toBeLessThan(10);
    expect(distance(villager, gazelle.mover!.action!)).toBeGreaterThan(distance(villager, gazelle));
    runUntil(w, () => gazelle.ai!.action === -1, 200);
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

describe('unit-ai.md §4.3 step 4: a villager whose work an animal interrupts hunts it, then returns to the work', () => {
  test('a Lumberjack attacked by an Alligator on the way kills it as a Hunter, then goes back to its tree as a Lumberjack', () => {
    const w = world(
      { owner: 1, type: VILLAGER, x: 10.5, y: 10.5 },
      { owner: 0, type: 143, x: 22.5, y: 10.5 },
      { owner: 0, type: ALLIGATOR, x: 17.5, y: 11.5 },
    );
    const [v, tree, gator] = [w.entities.get(1)!, w.entities.get(2)!, w.entities.get(3)!];
    order(w, 1, { type: 'work', units: [1], target: 2, x: tree.x, y: tree.y });
    // The attack hunts the Alligator (the civilian override) and the unit becomes the Hunter.
    runUntil(w, () => v.ai!.target === 3);
    expect(v.type).toBe(HUNTER);
    expect(v.ai!.action).toBe(0x265);
    runUntil(w, () => gator.state > ObjectState.Active);
    // The queued hunt on the tree is replayed: the task group swaps the Hunter back into a Lumberjack.
    runUntil(w, () => v.ai!.target === 2, 10);
    expect(v.type).toBe(LUMBERJACK);
    expect(v.work?.target).toBe(2);
    expect(v.ai!.order).toBe(0x2c9);
    runUntil(w, () => v.heldAmount > 0, 40);
    expect(v.heldType).toBe(1);
  });
});
