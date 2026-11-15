import { describe, expect, test } from 'vitest';
import { ATTR_HEADROOM, ATTR_POPULATION } from './buildings';
import type { Command } from './commands';
import { ObjectState, type Entity } from './entities';
import { targetActionType, type WorkAction } from './gather';
import { master, typeOf } from './masters';
import { f32 } from './num';
import { ACTION_CONVERT, ACTION_HEAL, conversionSucceeds, FAITH_MAX, RESOURCE_FAITH } from './priest';
import { runReplay, samplePriestReplay } from './replay';
import { CrtRand } from './rng';
import { doTech, TECH_AVAILABLE, TECH_DONE } from './techs';
import { BARRACKS, CLUBMAN, HOUSE, TOWN_CENTER, VILLAGER } from './units';
import { VICTORY_SPECIAL, VICTORY_STANDARD } from './victory';
import { TILE_FOGGED, TILE_VISIBLE } from './visibility';
import { AGE_BRONZE, AGE_IRON, ATTR_GOLD, COMMAND_DELAY_TURNS, startingObjects, World, type StartUnit } from './world';

const PRIEST = 125;
const TEMPLE = 104;
const CHARIOT = 40;
const CHARIOT_ARCHER = 41;
const FLARE = 112;

const CIV_EGYPTIAN = 1;
const CIV_GREEK = 2;
const CIV_BABYLONIAN = 3;
const CIV_CHOSON = 12;
const CIV_MACEDONIAN = 16;

const AFTERLIFE = 18;
const MONOTHEISM = 19;
const FANATICISM = 20;
const MYSTICISM = 21;
const ASTROLOGY = 22;
const POLYTHEISM = 24;
const MEDICINE = 119;
const MARTYRDOM = 120;

const ATTR_PRIEST_CONVERSION = 27;
const ATTR_BUILDING_CONVERSION = 28;
const ATTR_FAITH_RECHARGE = 35;
const ATTR_CONVERSIONS = 41;
const ATTR_HEAL_RATE = 56;
const ATTR_MARTYRDOM = 57;

/** The convert action's states (support-actions.md §4.3). */
const WORKING = 7;

function order(w: World, player: number, command: Command): void {
  w.addBatch(w.turn, player, [command]);
}

/** A world of Gaia and two players with these objects; ids follow the list order from 1. Conquest off unless `victory`. */
function world(units: StartUnit[], civs: [number, number] = [CIV_GREEK, CIV_GREEK], options: { victory?: number; startingAge?: number } = {}): World {
  return new World({ players: 3, civs: [0, ...civs], units, victory: { type: options.victory ?? VICTORY_SPECIAL }, startingAge: options.startingAge });
}

function entity(w: World, id: number): Entity {
  return w.entities.get(id)!;
}

/** Run turns until `done` holds; fails after `limit` turns. */
function runUntil(w: World, done: () => boolean, limit = 400): void {
  for (let i = 0; i < limit && !done(); i++) w.runTurn();
  expect(done()).toBe(true);
}

function live(w: World, owner: number, type: number): Entity[] {
  return [...w.entities.all()].filter((e) => e.owner === owner && e.type === type && e.state <= ObjectState.Active);
}

function techs(w: World, player: number, ...ids: number[]): void {
  for (const id of ids) expect([id, doTech(w.gameContext(), player, id)]).toEqual([id, true]);
}

/** The priest's task of action `type` (the Priest has one heal and one convert task). */
function taskOf(w: World, type: number): number {
  return master(w, 1, PRIEST).action!.tasks.findIndex((k) => k.actionType === type);
}

describe('support-actions.md §2: the Priest (125) at the Temple and the Temple techs', () => {
  /** A Bronze (or `age`) Age game for `civ` as player 1 with a built Temple, two Houses and 5000 gold. */
  function templeGame(civ: number, age = AGE_BRONZE): World {
    const extra: StartUnit[] = [
      { owner: 1, type: TEMPLE, x: 21.5, y: 19.5 },
      { owner: 1, type: HOUSE, x: 25.5, y: 13.5 },
      { owner: 1, type: HOUSE, x: 25.5, y: 15.5 },
    ];
    const w = new World({ players: 3, civs: [0, civ, CIV_EGYPTIAN], startingAge: age, units: [...startingObjects(3), ...extra], victory: { type: VICTORY_SPECIAL } });
    w.attributes[1]![ATTR_GOLD] = 5000;
    return w;
  }

  function research(w: World, tech: number): void {
    expect([tech, w.techs[1]![tech]]).toEqual([tech, TECH_AVAILABLE]);
    order(w, 1, { type: 'research', building: live(w, 1, TEMPLE)[0]!.id, tech });
    runUntil(w, () => w.techs[1]![tech] === TECH_DONE, 2000);
  }

  test('the built Temple completes tech 17 (enables the Priest); a queued Priest costs 125 gold and comes out with 100 faith', () => {
    const w = templeGame(CIV_GREEK);
    expect(w.techs[1]![17]).toBe(TECH_DONE);
    const t = master(w, 1, PRIEST);
    // The dat's Priest: 25 hp, range 10, sight 12, speed 0.8, heal 3 hp/s, convert 0.3 per attempt every 3 s.
    expect([t.hitPoints, t.combat!.range, t.los, t.speed, t.action!.workRate]).toEqual([25, 10, 12, f32(0.8), 1]);
    expect(t.action!.tasks[taskOf(w, ACTION_HEAL)]!.workValue1).toBe(3);
    expect([t.action!.tasks[taskOf(w, ACTION_CONVERT)]!.workValue1, t.action!.tasks[taskOf(w, ACTION_CONVERT)]!.workValue2]).toEqual([f32(0.3), 3]);
    expect(w.attributes[1]![ATTR_FAITH_RECHARGE]).toBe(2);
    const temple = live(w, 1, TEMPLE)[0]!;
    order(w, 1, { type: 'queue', building: temple.id, unit: PRIEST, count: 1 });
    for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) w.runTurn();
    expect(w.attributes[1]![ATTR_GOLD]).toBe(5000 - 125);
    runUntil(w, () => live(w, 1, PRIEST).length === 1, 800);
    const priest = live(w, 1, PRIEST)[0]!;
    expect([priest.heldType, priest.heldAmount]).toEqual([RESOURCE_FAITH, FAITH_MAX]);
  });

  test('civ bonuses: Babylonian faith recharge 2.75/s (effect 82), Egyptian priest range and sight +3 (83), Choson priest at 85 gold (91)', () => {
    expect(templeGame(CIV_BABYLONIAN).attributes[1]![ATTR_FAITH_RECHARGE]).toBe(2.75);
    const egypt = master(templeGame(CIV_EGYPTIAN), 1, PRIEST);
    expect([egypt.combat!.range, egypt.los]).toEqual([13, 15]);
    expect(master(templeGame(CIV_CHOSON), 1, PRIEST).creatable!.costs[0]).toEqual({ type: ATTR_GOLD, amount: 85, flag: 1 });
  });

  test('Bronze Age Temple techs researched at the Temple: Mysticism hp ×2, Astrology work rate +0.3, Polytheism speed ×1.4', () => {
    const w = templeGame(CIV_BABYLONIAN);
    research(w, MYSTICISM);
    research(w, ASTROLOGY);
    research(w, POLYTHEISM);
    const t = master(w, 1, PRIEST);
    expect([t.hitPoints, t.action!.workRate, t.speed]).toEqual([50, f32(1.3), f32(f32(0.8) * f32(1.4))]);
  });

  test('Iron Age Temple techs: Afterlife range and sight +3, Monotheism attributes 27 and 28, Fanaticism +1.5 faith/s, Medicine attribute 56, Martyrdom attribute 57', () => {
    const w = templeGame(CIV_BABYLONIAN, AGE_IRON);
    const a = w.attributes[1]!;
    expect([a[ATTR_PRIEST_CONVERSION], a[ATTR_BUILDING_CONVERSION], a[ATTR_HEAL_RATE], a[ATTR_MARTYRDOM]]).toEqual([0, 0, 0, 0]);
    for (const tech of [AFTERLIFE, MONOTHEISM, FANATICISM, MEDICINE, MARTYRDOM]) research(w, tech);
    const t = master(w, 1, PRIEST);
    expect([t.combat!.range, t.los]).toEqual([13, 15]);
    expect([a[ATTR_PRIEST_CONVERSION], a[ATTR_BUILDING_CONVERSION], a[ATTR_FAITH_RECHARGE], a[ATTR_HEAL_RATE], a[ATTR_MARTYRDOM]]).toEqual([1, 1, 4.25, 3, 1]);
  });

  test('faith recharges by attribute 35 × the step time every step, before the action, up to 100: 556 steps from 0 (support-actions.md §9)', () => {
    const w = world([{ owner: 1, type: PRIEST, x: 12.5, y: 12.5 }]);
    const priest = entity(w, 1);
    priest.heldAmount = 0;
    let steps = 0;
    while (priest.heldAmount < FAITH_MAX) {
      w.runStep();
      steps++;
    }
    expect(w.deltaSeconds).toBe(f32(0.09));
    expect(steps).toBe(556);
    w.runStep();
    expect(priest.heldAmount).toBe(FAITH_MAX);
  });
});

describe('support-actions.md §4.4: the conversion roll', () => {
  const units: StartUnit[] = [
    { owner: 1, type: PRIEST, x: 10.5, y: 10.5 },
    { owner: 2, type: CLUBMAN, x: 14.5, y: 10.5 },
    { owner: 2, type: PRIEST, x: 14.5, y: 12.5 },
    { owner: 2, type: CHARIOT, x: 14.5, y: 14.5 },
    { owner: 2, type: CHARIOT_ARCHER, x: 14.5, y: 16.5 },
  ];
  const action = (w: World): WorkAction => ({ type: ACTION_CONVERT, task: taskOf(w, ACTION_CONVERT), state: WORKING, timer: 0, target: 2, target2: -1, x: 0, y: 0, z: 0 });
  /** The highest roll that converts target `id`. */
  function threshold(w: World, id: number): number {
    const ctx = w.gameContext();
    let r = 0;
    while (r < 32768 && conversionSucceeds(ctx, entity(w, 1), action(w), entity(w, id), r + 1)) r++;
    expect(conversionSucceeds(ctx, entity(w, 1), action(w), entity(w, id), r)).toBe(true);
    return r;
  }

  test('rand() × 1/32767 against 0.3 × work rate: ≤ 9830 converts a plain unit, ×2 for a priest (4915), ×8 for chariots (1228)', () => {
    const w = world(units);
    expect([threshold(w, 2), threshold(w, 3), threshold(w, 4), threshold(w, 5)]).toEqual([9830, 4915, 1228, 1228]);
  });

  test('a Macedonian target is ×4 whatever its class (2457); Astrology (work rate 1.3) raises a plain unit to 12779', () => {
    const w = world(units, [CIV_GREEK, CIV_MACEDONIAN]);
    expect([threshold(w, 2), threshold(w, 3), threshold(w, 4)]).toEqual([2457, 2457, 2457]);
    const astro = world(units, [CIV_BABYLONIAN, CIV_GREEK]);
    techs(astro, 1, ASTROLOGY);
    expect(threshold(astro, 2)).toBe(12779);
  });

  test('Example A: from RNG state 14 the flare draws 84 and reseeds, the roll is 312, which converts', () => {
    const rng = new CrtRand();
    rng.srand(14);
    const flare = rng.rand();
    rng.srand(flare);
    const r = rng.rand();
    expect([flare, r]).toEqual([84, 312]);
    const w = world(units);
    expect(conversionSucceeds(w.gameContext(), entity(w, 1), action(w), entity(w, 2), r)).toBe(true);
  });
});

describe('support-actions.md §4.2-§4.3, §4.6: a conversion', () => {
  test('a work order on an enemy Villager converts it: owner, attribute 41, faith 0, population, sight, the old civ record, a flare per attempt', () => {
    const w = world([
      { owner: 1, type: PRIEST, x: 10.5, y: 10.5 },
      { owner: 2, type: VILLAGER, x: 16.5, y: 10.5 },
      { owner: 2, type: HOUSE, x: 30.5, y: 30.5 },
    ], [CIV_GREEK, CIV_EGYPTIAN]);
    const priest = entity(w, 1);
    const villager = entity(w, 2);
    const pop = [w.attributes[1]![ATTR_POPULATION], w.attributes[2]![ATTR_POPULATION]];
    order(w, 1, { type: 'work', units: [1], target: 2, x: villager.x, y: villager.y });
    for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) w.runTurn();
    expect(priest.work?.type).toBe(ACTION_CONVERT);
    // Range is the priest's weapon range for a unit.
    expect(priest.work!.range).toBe(10);
    const seen = new Set<number>();
    let flares = 0;
    let faithAt = -1;
    const owner = () => villager.owner;
    for (let i = 0; i < 4000 && owner() === 2; i++) {
      w.runStep();
      for (const e of w.entities.all()) {
        if (e.type !== FLARE || e.owner !== 2 || seen.has(e.id)) continue;
        seen.add(e.id);
        flares++;
      }
      if (owner() === 1) faithAt = priest.heldAmount;
    }
    expect(villager.owner).toBe(1);
    // The success zeroed faith; this step's recharge came before the action.
    expect(faithAt).toBe(0);
    expect(flares).toBeGreaterThanOrEqual(2);
    expect(w.attributes[1]![ATTR_CONVERSIONS]).toBe(1);
    expect([w.attributes[1]![ATTR_POPULATION], w.attributes[2]![ATTR_POPULATION]]).toEqual([pop[0]! + 1, pop[1]! - 1]);
    // It keeps its Egyptian record; player 2 no longer sees its tile, player 1 does.
    expect(villager.ownMaster).toBeTruthy();
    expect(typeOf(w, villager)).not.toBe(master(w, 1, VILLAGER));
    const [col, row] = [Math.trunc(villager.x), Math.trunc(villager.y)];
    expect(w.tileVisibility(1, col, row)).toBe(TILE_VISIBLE);
    expect(w.tileVisibility(2, col, row)).toBe(TILE_FOGGED);
    // Next step the target is the priest's own: the action ends.
    for (let i = 0; i < 3; i++) w.runStep();
    expect(priest.work ?? null).toBeNull();
  });

  test('converting the last enemy unit wins a conquest game (victory.md: elimination)', () => {
    const w = world([
      { owner: 1, type: PRIEST, x: 10.5, y: 10.5 },
      { owner: 2, type: VILLAGER, x: 14.5, y: 10.5 },
    ], [CIV_GREEK, CIV_GREEK], { victory: VICTORY_STANDARD });
    order(w, 1, { type: 'work', units: [1], target: 2, x: 14.5, y: 10.5 });
    runUntil(w, () => w.gameResult() !== null, 2000);
    expect(entity(w, 2).owner).toBe(1);
    expect(w.gameResult()!.winners).toEqual([1]);
    expect(w.playerStatus(2)).toBe(2);
  });

  test('without Monotheism a priest or a building is refused; with it both convert, a building from range 1; a Town Center never', () => {
    const units: StartUnit[] = [
      { owner: 1, type: PRIEST, x: 10.5, y: 10.5 },
      { owner: 2, type: PRIEST, x: 14.5, y: 10.5 },
      { owner: 2, type: BARRACKS, x: 15.5, y: 16.5 },
      { owner: 2, type: TOWN_CENTER, x: 22.5, y: 10.5 },
    ];
    for (const target of [2, 3, 4]) {
      const w = world(units, [CIV_BABYLONIAN, CIV_GREEK], { startingAge: AGE_IRON });
      order(w, 1, { type: 'work', units: [1], target, x: entity(w, target).x, y: entity(w, target).y });
      for (let i = 0; i < 200; i++) w.runTurn();
      expect([target, entity(w, target).owner, entity(w, 1).work ?? null]).toEqual([target, 2, null]);
    }
    for (const [target, range] of [
      [2, 10],
      [3, 1],
    ] as const) {
      const w = world(units, [CIV_BABYLONIAN, CIV_GREEK], { startingAge: AGE_IRON });
      techs(w, 1, MONOTHEISM);
      // A priest under conversion walks away (it cannot fight back): it stands its ground here.
      order(w, 2, { type: 'stand-ground', units: [2] });
      order(w, 1, { type: 'work', units: [1], target, x: entity(w, target).x, y: entity(w, target).y });
      for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) w.runTurn();
      expect([target, entity(w, 1).work!.range]).toEqual([target, range]);
      runUntil(w, () => entity(w, target).owner === 1, 3000);
    }
    const w = world(units, [CIV_BABYLONIAN, CIV_GREEK], { startingAge: AGE_IRON });
    techs(w, 1, MONOTHEISM);
    order(w, 1, { type: 'work', units: [1], target: 4, x: 22.5, y: 10.5 });
    for (let i = 0; i < 200; i++) w.runTurn();
    expect([entity(w, 4).owner, entity(w, 1).work ?? null]).toEqual([2, null]);
  });

  test('Afterlife lengthens the convert range to 13', () => {
    const w = world([
      { owner: 1, type: PRIEST, x: 10.5, y: 10.5 },
      { owner: 2, type: VILLAGER, x: 25.5, y: 10.5 },
    ], [CIV_BABYLONIAN, CIV_GREEK], { startingAge: AGE_IRON });
    techs(w, 1, AFTERLIFE);
    order(w, 1, { type: 'work', units: [1], target: 2, x: 25.5, y: 10.5 });
    for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) w.runTurn();
    expect(entity(w, 1).work!.range).toBe(13);
  });

  test('rejuvenation: below 100 faith the order fails; once faith is back the next order converts', () => {
    const w = world([
      { owner: 1, type: PRIEST, x: 10.5, y: 10.5 },
      { owner: 2, type: VILLAGER, x: 14.5, y: 10.5 },
    ]);
    const priest = entity(w, 1);
    priest.heldAmount = f32(99);
    order(w, 1, { type: 'work', units: [1], target: 2, x: 14.5, y: 10.5 });
    for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) w.runTurn();
    expect(priest.work ?? null).toBeNull();
    runUntil(w, () => priest.heldAmount === FAITH_MAX, 100);
    expect(entity(w, 2).owner).toBe(2);
    order(w, 1, { type: 'work', units: [1], target: 2, x: 14.5, y: 10.5 });
    runUntil(w, () => entity(w, 2).owner === 1, 2000);
  });

  test('a converted priest keeps its old record: the new owner’s Afterlife does not lengthen its range; snapshots keep it', () => {
    const w = world([
      { owner: 1, type: PRIEST, x: 10.5, y: 10.5 },
      { owner: 2, type: PRIEST, x: 14.5, y: 10.5 },
    ], [CIV_BABYLONIAN, CIV_GREEK], { startingAge: AGE_IRON });
    techs(w, 1, MONOTHEISM);
    order(w, 2, { type: 'stand-ground', units: [2] });
    order(w, 1, { type: 'work', units: [1], target: 2, x: 14.5, y: 10.5 });
    runUntil(w, () => entity(w, 2).owner === 1, 3000);
    techs(w, 1, AFTERLIFE);
    expect([master(w, 1, PRIEST).combat!.range, typeOf(w, entity(w, 2)).combat!.range, master(w, 2, PRIEST).combat!.range]).toEqual([13, 10, 10]);
    const copy = World.restore(JSON.parse(JSON.stringify(w.snapshot())));
    expect(copy.hash()).toBe(w.hash());
    for (let i = 0; i < 20; i++) [w, copy].forEach((x) => x.runTurn());
    expect(copy.hash()).toBe(w.hash());
    expect(typeOf(copy, copy.entities.get(2)!).combat!.range).toBe(10);
  });

  test('a converted Temple gives its new owner tech 17 (the Priest), a converted House its population room, a Barracks keeps one unit of its queue', () => {
    const w = world([
      { owner: 1, type: PRIEST, x: 10.5, y: 10.5 },
      { owner: 2, type: TEMPLE, x: 14.5, y: 10.5 },
      { owner: 2, type: HOUSE, x: 10.5, y: 14.5 },
      { owner: 2, type: BARRACKS, x: 14.5, y: 16.5 },
      { owner: 2, type: HOUSE, x: 30.5, y: 30.5 },
    ], [CIV_BABYLONIAN, CIV_GREEK]);
    techs(w, 1, MONOTHEISM);
    w.attributes[2]![0] = 1000;
    order(w, 2, { type: 'queue', building: 4, unit: CLUBMAN, count: 5 });
    expect(w.techs[1]![17]).not.toBe(TECH_DONE);
    for (const target of [4, 2, 3]) {
      const room = [w.attributes[1]![ATTR_HEADROOM]!, w.attributes[2]![ATTR_HEADROOM]!];
      order(w, 1, { type: 'work', units: [1], target, x: entity(w, target).x, y: entity(w, target).y });
      for (let i = 0; i < 6000 && entity(w, target).owner === 2; i++) w.runStep();
      expect([target, entity(w, target).owner]).toEqual([target, 1]);
      if (target === 4) expect(entity(w, 4).queue).toEqual([{ unit: CLUBMAN, count: 1 }]);
      if (target === 2) expect(w.techs[1]![17]).toBe(TECH_DONE);
      if (target === 3) expect([w.attributes[1]![ATTR_HEADROOM]! - room[0]!, room[1]! - w.attributes[2]![ATTR_HEADROOM]!]).toEqual([4, 4]);
      runUntil(w, () => entity(w, 1).heldAmount === FAITH_MAX, 1000);
    }
  });

  test('Martyrdom: a priest deleted while working on a non-priest converts it at once; without the tech it does not', () => {
    for (const martyr of [true, false]) {
      const w = world([
        { owner: 1, type: PRIEST, x: 10.5, y: 10.5 },
        { owner: 2, type: VILLAGER, x: 14.5, y: 10.5 },
      ], [CIV_BABYLONIAN, CIV_GREEK], { startingAge: AGE_IRON });
      if (martyr) techs(w, 1, MARTYRDOM);
      const priest = entity(w, 1);
      order(w, 1, { type: 'work', units: [1], target: 2, x: 14.5, y: 10.5 });
      runUntil(w, () => priest.work?.state === WORKING, 200);
      order(w, 1, { type: 'cancel', target: 1 });
      // The timer runs 34 steps: the delete lands while the priest still works.
      for (let i = 0; i < COMMAND_DELAY_TURNS; i++) w.runTurn();
      expect(priest.work?.state).toBe(WORKING);
      w.runTurn();
      expect([martyr, entity(w, 2).owner, priest.hp]).toEqual([martyr, martyr ? 1 : 2, 0]);
    }
  });
});

describe('support-actions.md §5: heal', () => {
  test('Example C: a priest heals a friendly priest from 10 to 25 hp in 56 steps of 0.27; with Medicine 19 steps of 0.81', () => {
    for (const [medicine, steps, per] of [
      [false, 56, f32(0.27000001)],
      [true, 19, f32(0.81000006)],
    ] as const) {
      const w = world([
        { owner: 1, type: PRIEST, x: 10.5, y: 10.5 },
        { owner: 1, type: PRIEST, x: 11.0, y: 10.5 },
      ]);
      if (medicine) techs(w, 1, MEDICINE);
      const patient = entity(w, 2);
      patient.hp = 10;
      order(w, 1, { type: 'work', units: [1], target: 2, x: patient.x, y: patient.y });
      let healed = 0;
      for (let i = 0; i < 400 && patient.hp < 25; i++) {
        const was = patient.hp;
        w.runStep();
        if (patient.hp !== was) {
          if (patient.hp < 25) expect(f32(patient.hp - was)).toBeCloseTo(per, 5);
          healed++;
        }
      }
      expect([medicine, healed, patient.hp]).toEqual([medicine, steps, 25]);
      // Full: the heal asks for a task (state 3), and nobody else is hurt.
      expect(entity(w, 1).work?.state ?? 3).toBe(3);
    }
  });

  test('a walking target is not healed; buildings and enemies take no heal (an enemy is a convert)', () => {
    const w = world([
      { owner: 1, type: PRIEST, x: 10.5, y: 10.5 },
      { owner: 1, type: VILLAGER, x: 11.0, y: 10.5 },
      { owner: 1, type: HOUSE, x: 14.5, y: 14.5 },
      { owner: 2, type: VILLAGER, x: 20.5, y: 10.5 },
    ]);
    const patient = entity(w, 2);
    patient.hp = 5;
    order(w, 1, { type: 'work', units: [1], target: 2, x: patient.x, y: patient.y });
    runUntil(w, () => patient.hp > 5, 50);
    order(w, 1, { type: 'move', units: [2], x: 20.5, y: 20.5 });
    let moved = 0;
    for (let i = 0; i < 200; i++) {
      const [x, y, hp] = [patient.x, patient.y, patient.hp];
      w.runStep();
      if (patient.x !== x || patient.y !== y) {
        moved++;
        expect(patient.hp).toBe(hp);
      }
    }
    expect(moved).toBeGreaterThan(0);
    const house = entity(w, 3);
    house.hp = 10;
    order(w, 1, { type: 'work', units: [1], target: 3, x: house.x, y: house.y });
    for (let i = 0; i < 40; i++) w.runTurn();
    expect([house.hp, entity(w, 1).work?.type ?? null]).toEqual([10, null]);
    entity(w, 4).hp = 5;
    order(w, 1, { type: 'work', units: [1], target: 4, x: 20.5, y: 10.5 });
    for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) w.runTurn();
    expect(entity(w, 1).work?.type).toBe(ACTION_CONVERT);
  });
});

describe('the priest unit AI', () => {
  test('a human priest attacked with full faith converts its attacker', () => {
    const w = world([
      { owner: 1, type: PRIEST, x: 10.5, y: 10.5 },
      { owner: 2, type: CLUBMAN, x: 16.5, y: 10.5 },
    ]);
    order(w, 2, { type: 'attack', units: [2], target: 1 });
    runUntil(w, () => entity(w, 2).owner === 1 || entity(w, 1).hp <= 0, 2000);
    expect(entity(w, 2).owner).toBe(1);
  });

  test('a priest whose heal ends heals the next hurt unit within reach', () => {
    const w = world([
      { owner: 1, type: PRIEST, x: 10.5, y: 10.5 },
      { owner: 1, type: VILLAGER, x: 11.0, y: 10.5 },
      { owner: 1, type: VILLAGER, x: 12.5, y: 11.5 },
    ]);
    entity(w, 2).hp = 20;
    entity(w, 3).hp = 20;
    order(w, 1, { type: 'work', units: [1], target: 2, x: 11, y: 10.5 });
    runUntil(w, () => entity(w, 3).hp === 25, 400);
  });
});

describe('determinism with priests', () => {
  test('samplePriestReplay converts and heals, and replays to the same hashes', () => {
    const log = samplePriestReplay();
    const w = new World({ players: log.players, randomSeed: log.randomSeed, units: log.units, civs: log.civs, ...log.start });
    const a = runReplay(log, w);
    expect(runReplay(log)).toEqual(a);
    expect(w.attributes[1]![ATTR_CONVERSIONS]! + w.attributes[2]![ATTR_CONVERSIONS]!).toBeGreaterThan(0);
  });
});

describe('targetActionType: the action a work order on an object starts (pick_best_target with an action type)', () => {
  test("a Priest converts an enemy's Clubman, heals its own hurt Villager, and has nothing for a whole one or a Barracks", () => {
    const w = world([
      { owner: 1, type: PRIEST, x: 10.5, y: 10.5 },
      { owner: 2, type: CLUBMAN, x: 14.5, y: 10.5 },
      { owner: 1, type: VILLAGER, x: 10.5, y: 12.5 },
      { owner: 1, type: VILLAGER, x: 11.5, y: 12.5 },
      { owner: 1, type: BARRACKS, x: 6.5, y: 6.5 },
    ]);
    entity(w, 3).hp = f32(10);
    const priest = entity(w, 1);
    expect([2, 3, 4, 5].map((id) => targetActionType(w, priest, entity(w, id)))).toEqual([ACTION_CONVERT, ACTION_HEAL, -1, -1]);
    // A Clubman has no heal or convert for anything.
    expect(targetActionType(w, entity(w, 2), priest)).not.toBe(ACTION_CONVERT);
  });
});
