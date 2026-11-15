import { describe, expect, test } from 'vitest';
import { areaAttack, doAttack, launch } from './combat';
import { parseCommand, type Command } from './commands';
import type { Entity } from './entities';
import { master } from './masters';
import { runReplay, sampleSiegeReplay } from './replay';
import { doTech, TECH_AVAILABLE } from './techs';
import { BARRACKS, CLUBMAN, GAZELLE, HOUSE, TREES, UNIT_TYPES } from './units';
import { VICTORY_SPECIAL } from './victory';
import { World, type StartUnit } from './world';

const STONE_THROWER = 35;
const HEAVY_CATAPULT = 280;
const BALLISTA = 11;
const HOPLITE = 93;
const STONE = 34;
const BOLT = 204;
const CIV_EGYPTIAN = 1;
const CIV_GREEK = 2;

function order(world: World, player: number, command: Command): void {
  world.addBatch(world.turn, player, [command]);
}

/** A world of Gaia and two players with these objects; ids follow the list order from 1. Conquest off. */
function world(units: StartUnit[], civ = CIV_EGYPTIAN): World {
  return new World({ players: 3, civs: [0, civ, civ], units, victory: { type: VICTORY_SPECIAL } });
}

function entity(w: World, id: number): Entity {
  return w.entities.get(id)!;
}

/** Run turns until `done` holds or `limit` turns pass; returns the ids of every object of `type` seen meanwhile. */
function watch(w: World, type: number, limit: number, done: () => boolean = () => false): Set<number> {
  const seen = new Set<number>();
  for (let i = 0; i < limit && !done(); i++) {
    w.runTurn();
    for (const e of w.entities.all()) if (e.type === type) seen.add(e.id);
  }
  return seen;
}

describe('combat.md §4.4: a missile launcher blasts the point (radius, level, no falloff, friendly fire)', () => {
  // The blast point (15.5, 10.5); a Hoplite's radius is 0.3, so its edge is inside 0.5 up to 0.8 off the centre.
  const P = { x: 15.5, y: 10.5 };
  const objects = (thrower: number): StartUnit[] => [
    { owner: 1, type: thrower, x: 5.5, y: 10.5 },
    { owner: 2, type: HOPLITE, x: P.x, y: P.y },
    { owner: 2, type: HOPLITE, x: P.x + 0.79, y: P.y },
    { owner: 2, type: HOPLITE, x: P.x + 0.81, y: P.y },
    { owner: 1, type: HOPLITE, x: P.x, y: P.y + 0.6 },
    { owner: 0, type: GAZELLE, x: P.x - 0.6, y: P.y },
    { owner: 0, type: TREES[1], x: P.x, y: P.y - 0.6 },
  ];

  test('Stone Thrower (radius 0.5, level 2): every object of level >= 2 with its edge inside takes the full 50 - 5; its own Hoplite too; the tree (level 1) and the Hoplite whose edge is 0.51 off do not', () => {
    const w = world(objects(STONE_THROWER));
    const st = entity(w, 1);
    expect([master(w, 1, STONE_THROWER).combat!.blastWidth, master(w, 1, STONE_THROWER).combat!.blastLevel]).toEqual([0.5, 2]);
    const tree = entity(w, 7);
    const wood = tree.heldAmount;
    // The launcher's `do_attack` (range 10 >= 0.99): the blast only, the target is hit as one of its victims.
    doAttack(w.gameContext(), st, entity(w, 2), P.x, P.y);
    expect([2, 3, 4, 5].map((id) => entity(w, id).hp)).toEqual([75, 75, 120, 75]);
    expect(entity(w, 6).hp).toBe(0);
    expect([tree.hp, tree.heldAmount]).toEqual([UNIT_TYPES.get(TREES[1])!.hitPoints, wood]);
  });

  test('Heavy Catapult (radius 1.5, level 1) fells the tree, and the felled tree loses its wood', () => {
    const w = world(objects(HEAVY_CATAPULT));
    const tree = entity(w, 7);
    expect(tree.heldAmount).toBeGreaterThan(0);
    areaAttack(w.gameContext(), entity(w, 1), P.x, P.y, null);
    expect([tree.hp, tree.heldAmount]).toEqual([0, 0]);
    // 60 - 5; the third Hoplite is inside 1.5 now.
    expect([2, 3, 4, 5].map((id) => entity(w, id).hp)).toEqual([65, 65, 65, 65]);
  });

  test('Ballista (radius 0): one roll, only its target', () => {
    const w = world(objects(BALLISTA));
    doAttack(w.gameContext(), entity(w, 1), entity(w, 2), P.x, P.y);
    // (3, 40) against the Hoplite's pierce armour 0.
    expect([2, 3, 4, 5].map((id) => entity(w, id).hp)).toEqual([80, 120, 120, 120]);
  });
});

describe('combat.md §4.3, §4.4: melee splash around the attacker, sparing its owner', () => {
  const rows: [name: string, type: number][] = [
    ['War Elephant', 46],
    ['Armored Elephant', 345],
    ['Scythe Chariot', 339],
  ];
  for (const [name, type] of rows) {
    test(`${name} (${type}, radius 2): enemies whose edge is within 2 of the attacker take one hit each, the target exactly one; its own Hoplite none`, () => {
      const w = world([
        { owner: 1, type, x: 10.5, y: 10.5 },
        { owner: 2, type: HOPLITE, x: 11.5, y: 10.5 },
        { owner: 2, type: HOPLITE, x: 10.5, y: 12.3 },
        { owner: 2, type: HOPLITE, x: 10.5, y: 13 },
        { owner: 1, type: HOPLITE, x: 9, y: 10.5 },
      ]);
      expect(master(w, 1, type).combat!.blastWidth).toBe(2);
      launch(w.gameContext(), entity(w, 1), entity(w, 2));
      const loss = 120 - entity(w, 3).hp;
      expect(loss).toBeGreaterThan(0);
      expect([2, 3, 4, 5].map((id) => entity(w, id).hp)).toEqual([120 - loss, 120 - loss, 120, 120]);
    });
  }

  test('a Clubman (no blast) hits only its target', () => {
    const w = world([
      { owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 },
      { owner: 2, type: HOPLITE, x: 11.1, y: 10.5 },
      { owner: 2, type: HOPLITE, x: 10.5, y: 11.1 },
    ]);
    launch(w.gameContext(), entity(w, 1), entity(w, 2));
    expect([entity(w, 2).hp, entity(w, 3).hp]).toEqual([119, 120]);
  });
});

describe('techs.md §9: the siege upgrade techs change the siege masters', () => {
  const fresh = (civ: number) => new World({ players: 2, civs: [0, civ], fullTechTree: true, victory: { type: VICTORY_SPECIAL } });
  const research = (w: World, tech: number) => {
    w.techs[1]![tech] = TECH_AVAILABLE;
    expect(doTech(w.gameContext(), 1, tech)).toBe(true);
  };

  test('Alchemy (37): the stone becomes the flaming stone (329) and the bolt the flaming bolt (205); +1 attack', () => {
    const w = fresh(CIV_EGYPTIAN);
    research(w, 37);
    expect([master(w, 1, STONE).name, master(w, 1, BOLT).name]).toEqual(['Missle-Catapult_Stone_F', 'Missle-Bolt-Fire']);
    expect(master(w, 1, STONE_THROWER).combat!.attacks.find((a) => a.group === 4)!.amount).toBe(51);
    // The effect lists the Ballista's +1 pierce row twice.
    expect(master(w, 1, BALLISTA).combat!.attacks.find((a) => a.group === 3)!.amount).toBe(42);
  });

  test('Engineering (35): siege range and sight +2', () => {
    const w = fresh(CIV_EGYPTIAN);
    research(w, 35);
    expect([master(w, 1, STONE_THROWER).combat!.range, master(w, 1, BALLISTA).combat!.range]).toEqual([12, 11]);
  });

  test('Ballistics (106): the stone and the bolt lead a moving target', () => {
    const w = fresh(CIV_EGYPTIAN);
    research(w, 106);
    expect([master(w, 1, STONE).missile!.targetting, master(w, 1, BOLT).missile!.targetting]).toEqual([1, 1]);
  });
});

describe('commands.md §5: Attack Ground', () => {
  test('parseCommand: units and a finite point', () => {
    expect(parseCommand({ type: 'attack-ground', units: [3, 4], x: 12.5, y: 7, extra: 1 })).toEqual({ type: 'attack-ground', units: [3, 4], x: 12.5, y: 7 });
    expect(parseCommand({ type: 'attack-ground', units: [], x: 1, y: 1 })).toBeNull();
    expect(parseCommand({ type: 'attack-ground', units: [3], x: Number.NaN, y: 1 })).toBeNull();
  });

  test('a Stone Thrower ordered at a tile throws at it with no target: the enemy Barracks there loses 190 a stone till it falls, its own House 1.5 off nothing', () => {
    const w = world([
      { owner: 1, type: STONE_THROWER, x: 10.5, y: 10.5 },
      { owner: 2, type: BARRACKS, x: 18.5, y: 10.5 },
      { owner: 1, type: HOUSE, x: 18.5, y: 14 },
    ]);
    const house = entity(w, 3);
    const st = entity(w, 1);
    const barracks = entity(w, 2);
    const losses: number[] = [];
    let hp = barracks.hp;
    order(w, 1, { type: 'attack-ground', units: [1], x: 18.5, y: 10.5 });
    for (let i = 0; i < 3; i++) w.runTurn();
    expect([st.attack!.target, st.attack!.x, st.attack!.y, st.attack!.z]).toEqual([-1, 18.5, 10.5, 0]);
    watch(w, STONE, 600, () => {
      if (barracks.hp !== hp) losses.push(hp - barracks.hp);
      hp = barracks.hp;
      return hp === 0;
    });
    // (4, 50) and (6, 0) against the Barracks' (6, -140): 190 a stone, 350 hp.
    expect(losses).toEqual([190, 160]);
    expect(house.hp).toBe(UNIT_TYPES.get(HOUSE)!.hitPoints);
  });

  test('with nothing there it goes on throwing at the empty point: the ground has no target to lose', () => {
    const w = world([{ owner: 1, type: STONE_THROWER, x: 10.5, y: 10.5 }]);
    const st = entity(w, 1);
    order(w, 1, { type: 'attack-ground', units: [1], x: 16.5, y: 12.5 });
    expect(watch(w, STONE, 300).size).toBeGreaterThanOrEqual(4);
    expect([st.attack!.target, st.attack!.indirect]).toEqual([-1, 1]);
  });

  test('the blast hits whoever stands there: a Hoplite on the point takes 45', () => {
    const w = world([
      { owner: 1, type: STONE_THROWER, x: 10.5, y: 10.5 },
      { owner: 2, type: HOPLITE, x: 18.5, y: 10.5 },
    ]);
    const hoplite = entity(w, 2);
    order(w, 1, { type: 'attack-ground', units: [1], x: 18.5, y: 10.5 });
    for (let i = 0; i < 400 && hoplite.hp === 120; i++) w.runTurn();
    expect(hoplite.hp).toBe(75);
  });

  test('out of range: the Stone Thrower walks into range first (the walk spends one of the flag\'s two), then throws', () => {
    const w = world([{ owner: 1, type: STONE_THROWER, x: 5.5, y: 10.5 }]);
    const st = entity(w, 1);
    order(w, 1, { type: 'attack-ground', units: [1], x: 25.5, y: 10.5 });
    const stones = watch(w, STONE, 400, () => [...w.entities.all()].some((e) => e.type === STONE));
    expect(stones.size).toBe(1);
    expect(st.x).toBeGreaterThan(10);
    expect(st.attack!.indirect).toBe(1);
  });

  test('a Ballista (no blast) at the ground: its bolts land and hurt nothing, not even a Hoplite on the point', () => {
    const w = world([
      { owner: 1, type: BALLISTA, x: 10.5, y: 10.5 },
      { owner: 1, type: HOPLITE, x: 17.5, y: 10.5 },
    ]);
    order(w, 1, { type: 'attack-ground', units: [1], x: 17.5, y: 10.5 });
    const bolts = watch(w, BOLT, 200);
    expect(bolts.size).toBeGreaterThanOrEqual(3);
    expect(entity(w, 2).hp).toBe(120);
  });

  test('too close (under the minimum range 2): a mobile Stone Thrower waits and never throws', () => {
    const w = world([{ owner: 1, type: STONE_THROWER, x: 10.5, y: 10.5 }]);
    order(w, 1, { type: 'attack-ground', units: [1], x: 11.5, y: 10.5 });
    expect(watch(w, STONE, 60).size).toBe(0);
    expect(entity(w, 1).attack!.target).toBe(-1);
  });

  test('a melee unit ordered at the ground walks there and hits nothing', () => {
    const w = world([
      { owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 },
      { owner: 1, type: HOPLITE, x: 14.5, y: 10.5 },
    ]);
    order(w, 1, { type: 'attack-ground', units: [1], x: 14.5, y: 10.5 });
    for (let i = 0; i < 60; i++) w.runTurn();
    expect(entity(w, 1).x).toBeGreaterThan(13);
    expect(entity(w, 2).hp).toBe(120);
  });

  test("another player's units are not ordered", () => {
    const w = world([{ owner: 1, type: STONE_THROWER, x: 10.5, y: 10.5 }], CIV_GREEK);
    order(w, 2, { type: 'attack-ground', units: [1], x: 16.5, y: 10.5 });
    for (let i = 0; i < 4; i++) w.runTurn();
    expect(entity(w, 1).attack ?? null).toBeNull();
  });
});

describe('determinism with siege', () => {
  test('sampleSiegeReplay orders ground attacks, the units fight, and it replays to the same hashes', () => {
    const log = sampleSiegeReplay();
    expect(log.batches.some((b) => b.commands.some((c) => c.type === 'attack-ground'))).toBe(true);
    const w = new World({ players: log.players, randomSeed: log.randomSeed, units: log.units });
    const a = runReplay(log, w);
    expect(runReplay(log)).toEqual(a);
    // The siege and splash units come last; some of them (or the units around them) were hurt or killed.
    const first = log.units!.length - 10 + 1;
    const hurt = log.units!.slice(first - 1).filter((u, i) => {
      const e = w.entities.get(first + i);
      return !e || e.hp < UNIT_TYPES.get(u.type)!.hitPoints;
    });
    expect(hurt.length).toBeGreaterThan(0);
  });
});
