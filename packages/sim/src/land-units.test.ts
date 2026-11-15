import { describe, expect, test } from 'vitest';
import { checkPlacement } from './buildings';
import type { Command } from './commands';
import { ObjectState, type Entity } from './entities';
import { master } from './masters';
import { doTech, isEnabled, TECH_AVAILABLE, TECH_DISABLED, TECH_DONE } from './techs';
import { ARCHERY_RANGE, BARRACKS, copyUnitType, HOUSE, MARKET, STABLE, STORAGE_PIT, TECHS, TOWN_CENTER, UNIT_TYPES, VILLAGER } from './units';
import { VICTORY_SPECIAL } from './victory';
import { AGE_BRONZE, AGE_IRON, ATTR_FOOD, ATTR_GOLD, ATTR_STONE, ATTR_WOOD, COMMAND_DELAY_TURNS, startingObjects, type StartUnit, World } from './world';

const ACADEMY = 0;
const GOVERNMENT_CENTER = 82;
const TEMPLE = 104;
const SIEGE_WORKSHOP = 49;

const CIV_EGYPTIAN = 1;
const CIV_GREEK = 2;
const CIV_BABYLONIAN = 3;
const CIV_PERSIAN = 9;
const CIV_ROMAN = 13;

/** Player 1's base on the test map (Town Center at 11.5, 13.5): every building the land units and their techs need, built. */
const BASE: StartUnit[] = [
  { owner: 1, type: BARRACKS, x: 17.5, y: 9.5 },
  { owner: 1, type: ARCHERY_RANGE, x: 17.5, y: 14.5 },
  { owner: 1, type: STABLE, x: 17.5, y: 19.5 },
  { owner: 1, type: ACADEMY, x: 5.5, y: 20.5 },
  { owner: 1, type: MARKET, x: 21.5, y: 9.5 },
  { owner: 1, type: GOVERNMENT_CENTER, x: 21.5, y: 14.5 },
  { owner: 1, type: TEMPLE, x: 21.5, y: 19.5 },
  { owner: 1, type: SIEGE_WORKSHOP, x: 25.5, y: 9.5 },
  { owner: 1, type: STORAGE_PIT, x: 25.5, y: 19.5 },
  { owner: 1, type: HOUSE, x: 25.5, y: 13.5 },
  { owner: 1, type: HOUSE, x: 25.5, y: 15.5 },
];

function order(world: World, player: number, command: Command): void {
  world.addBatch(world.turn, player, [command]);
}

/** Run turns until `done` holds; fails after `limit` turns. */
function runUntil(world: World, done: () => boolean, limit = 400): void {
  for (let i = 0; i < limit && !done(); i++) world.runTurn();
  expect(done()).toBe(true);
}

function units(world: World, owner: number, type: number): Entity[] {
  return [...world.entities.all()].filter((e) => e.owner === owner && e.type === type && e.state <= ObjectState.Active);
}

function stock(world: World): number[] {
  const a = world.attributes[1]!;
  return [a[ATTR_FOOD]!, a[ATTR_WOOD]!, a[ATTR_STONE]!, a[ATTR_GOLD]!];
}

/** An Iron Age (or `age`) game for `civ` as player 1 with `BASE` built and 5000 of each resource. */
function ironBase(civ: number, age = AGE_IRON, extra: StartUnit[] = BASE): World {
  // Conquest off: player 2 only has its start objects.
  const world = new World({ players: 3, civs: [0, civ, CIV_EGYPTIAN], startingAge: age, units: [...startingObjects(3), ...extra], victory: { type: VICTORY_SPECIAL } });
  const a = world.attributes[1]!;
  [a[ATTR_FOOD], a[ATTR_WOOD], a[ATTR_STONE], a[ATTR_GOLD]] = [5000, 5000, 5000, 5000];
  return world;
}

/** Research `tech` through `research` commands at its building, its unmet researchable prerequisites first. */
function research(world: World, tech: number): void {
  const states = world.techs[1]!;
  if (states[tech] === TECH_DONE) return;
  for (const r of TECHS[tech]!.requires) if (r >= 0 && states[r] !== TECH_DONE && TECHS[r]!.location >= 0) research(world, r);
  expect([tech, states[tech]]).toEqual([tech, TECH_AVAILABLE]);
  const building = units(world, 1, TECHS[tech]!.location).find((e) => e.state === ObjectState.Active)!;
  order(world, 1, { type: 'research', building: building.id, tech });
  runUntil(world, () => states[tech] === TECH_DONE, 2000);
}

/** Queue one `unit` at player 1's `building`: the cost is paid on the command's step and the unit comes out. */
function train(world: World, building: number, unit: number): Entity {
  const at = units(world, 1, building)[0]!;
  const before = new Set(units(world, 1, unit).map((e) => e.id));
  const was = stock(world);
  order(world, 1, { type: 'queue', building: at.id, unit, count: 1 });
  for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) world.runTurn();
  const paid = [0, 0, 0, 0];
  for (const c of master(world, 1, unit).creatable!.costs) if (c.flag !== 0 && c.type <= 3) paid[[ATTR_FOOD, ATTR_WOOD, ATTR_STONE, ATTR_GOLD].indexOf(c.type)] = c.amount;
  expect(stock(world)).toEqual(was.map((v, i) => v - paid[i]!));
  let made: Entity | undefined;
  runUntil(world, () => (made = units(world, 1, unit).find((e) => !before.has(e.id))) !== undefined, 400);
  return made!;
}

/**
 * The land units of the Barracks, Archery Range, Stable and Academy: the button's unit type, its building, a civ whose
 * tree has the line, the techs researched first and the record the type then copies (`copy_obj`, techs.md §4.5).
 */
const LINES: [name: string, unit: number, building: number, civ: number, techs: number[], record: number][] = [
  // An Iron Age start completes every tech the civ has that needs only earlier ones (`startInAge`): a line's first
  // unit is tried with a civ whose tree stops there.
  ['Short Swordsman', 75, BARRACKS, CIV_EGYPTIAN, [64], 75],
  ['Broad Swordsman', 75, BARRACKS, CIV_PERSIAN, [65], 76],
  ['Long Swordsman', 75, BARRACKS, CIV_PERSIAN, [66], 77],
  ['Legion', 75, BARRACKS, CIV_PERSIAN, [77], 282],
  ['Improved Bowman', 5, ARCHERY_RANGE, CIV_ROMAN, [56], 5],
  ['Composite Bowman', 5, ARCHERY_RANGE, CIV_EGYPTIAN, [57], 6],
  ['Chariot Archer', 41, ARCHERY_RANGE, CIV_EGYPTIAN, [59], 41],
  ['Horse Archer', 39, ARCHERY_RANGE, CIV_PERSIAN, [60], 39],
  ['Heavy Horse Archer', 39, ARCHERY_RANGE, CIV_PERSIAN, [38], 281],
  ['Elephant Archer', 25, ARCHERY_RANGE, CIV_PERSIAN, [61], 25],
  ['Cavalry', 37, STABLE, CIV_PERSIAN, [69], 37],
  ['Heavy Cavalry', 37, STABLE, CIV_PERSIAN, [71], 38],
  ['Cataphract', 37, STABLE, CIV_PERSIAN, [78], 283],
  ['Chariot', 40, STABLE, CIV_EGYPTIAN, [68], 40],
  ['Scythe Chariot', 40, STABLE, CIV_EGYPTIAN, [126], 339],
  ['Camel Rider', 338, STABLE, CIV_EGYPTIAN, [], 338],
  ['War Elephant', 46, STABLE, CIV_PERSIAN, [70], 46],
  ['Armored Elephant', 46, STABLE, CIV_PERSIAN, [125], 345],
  ['Hoplite', 93, ACADEMY, CIV_GREEK, [], 93],
  ['Phalanx', 93, ACADEMY, CIV_GREEK, [73], 94],
  ['Centurion', 93, ACADEMY, CIV_GREEK, [79], 291],
];

describe('land units: every Barracks, Archery Range, Stable and Academy unit trains at its building', () => {
  for (const [name, unit, building, civ, techs, record] of LINES) {
    const source = UNIT_TYPES.get(record)!;
    test(`${name}: ${source.name} (${record}) as unit ${unit} at building ${building}, ${source.hitPoints} hp`, () => {
      const world = ironBase(civ);
      for (const tech of techs) research(world, tech);
      expect(isEnabled(world, 1, unit)).toBe(true);
      const t = master(world, 1, unit);
      expect([t.name, t.creatable!.trainLocationId]).toEqual([source.name, building]);
      const e = train(world, building, unit);
      expect([e.type, e.hp]).toEqual([unit, t.hitPoints]);
    });
  }
});

describe('land units: civ tech trees (the civ effect disables the enabling tech)', () => {
  const rows: [civ: string, id: number, unit: number, tech: number][] = [
    ['Greek', CIV_GREEK, 41, 59],
    ['Greek', CIV_GREEK, 40, 68],
    ['Greek', CIV_GREEK, 25, 61],
    ['Greek', CIV_GREEK, 46, 70],
    ['Greek', CIV_GREEK, 5, 56],
    ['Egyptian', CIV_EGYPTIAN, 37, 69],
    ['Egyptian', CIV_EGYPTIAN, 39, 60],
    ['Persian', CIV_PERSIAN, ACADEMY, 92],
  ];
  for (const [civName, civ, unit, tech] of rows) {
    test(`${civName}: no ${UNIT_TYPES.get(unit)!.name} (${unit}); tech ${tech} disabled, its research command does nothing`, () => {
      const world = ironBase(civ);
      expect(world.techs[1]![tech]).toBe(TECH_DISABLED);
      const location = TECHS[tech]!.location;
      if (location >= 0) {
        order(world, 1, { type: 'research', building: units(world, 1, location)[0]!.id, tech });
        for (let i = 0; i < 10; i++) world.runTurn();
      }
      expect([world.techs[1]![tech], isEnabled(world, 1, unit)]).toEqual([TECH_DISABLED, false]);
    });
  }
});

/** A free spot for building `type` of player 1 near (x, y), searched outwards ring by ring. */
function spot(world: World, type: number, x: number, y: number): [number, number] {
  const t = master(world, 1, type);
  const ctx = world.gameContext();
  for (let r = 3; r < 14; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (checkPlacement(ctx, t, x + dx, y + dy, true, true) === 0) return [x + dx, y + dy];
      }
    }
  }
  throw new Error(`no spot for ${type}`);
}

describe('land units: Academy, Government Center, Temple and Siege Workshop', () => {
  const PREREQS: StartUnit[] = [
    { owner: 1, type: BARRACKS, x: 17.5, y: 9.5 },
    { owner: 1, type: ARCHERY_RANGE, x: 17.5, y: 14.5 },
    { owner: 1, type: STABLE, x: 17.5, y: 19.5 },
    { owner: 1, type: MARKET, x: 21.5, y: 9.5 },
  ];
  const rows: [name: string, building: number, civ: number, age: number, tech: number, techName: string][] = [
    ['Academy', ACADEMY, CIV_GREEK, AGE_IRON, 73, 'Phalanx'],
    ['Government Center', GOVERNMENT_CENTER, CIV_EGYPTIAN, AGE_BRONZE, 112, 'Architecture'],
    ['Temple', TEMPLE, CIV_EGYPTIAN, AGE_BRONZE, 22, 'Astrology'],
    ['Siege Workshop', SIEGE_WORKSHOP, CIV_BABYLONIAN, AGE_IRON, 54, 'Heavy Catapult'],
  ];
  for (const [name, building, civ, age, tech, techName] of rows) {
    const t = UNIT_TYPES.get(building)!;
    const wood = t.creatable!.costs.find((c) => c.type === ATTR_WOOD)!.amount;
    test(`${name} (${building}): enabled, Villagers build it for ${wood} wood, then ${techName} (${tech}) is researched there`, () => {
      const world = ironBase(civ, age, PREREQS);
      expect(isEnabled(world, 1, building)).toBe(true);
      const tc = units(world, 1, TOWN_CENTER)[0]!;
      const [x, y] = spot(world, building, tc.x, tc.y);
      const was = stock(world)[1]!;
      order(world, 1, { type: 'build', units: units(world, 1, VILLAGER).map((e) => e.id), unitType: building, x, y });
      let found: Entity | undefined;
      runUntil(world, () => (found = units(world, 1, building)[0]) !== undefined, 5);
      expect(stock(world)[1]).toBe(was - wood);
      runUntil(world, () => found!.state === ObjectState.Active, 1500);
      const built = master(world, 1, building).building!.techId;
      if (built >= 0) expect(world.techs[1]![built]).toBe(TECH_DONE);
      research(world, tech);
    });
  }
});

describe('no land-unit tech is a no-op for want of a master', () => {
  // The button's unit each tech changes: `make_available` (type 2) or `copy_obj` from the next record (type 3).
  const rows: [tech: number, name: string, unit: number, record: number | null][] = [
    [64, 'Short Sword', 75, null],
    [65, 'Broad Sword', 75, 76],
    [66, 'Long Sword', 75, 77],
    [77, 'Legion', 75, 282],
    [56, 'Improved Bow', 5, null],
    [57, 'Composite Bow', 5, 6],
    [38, 'Heavy Horse Archer', 39, 281],
    [71, 'Heavy Cavalry', 37, 38],
    [78, 'Cataphracts', 37, 283],
    [125, 'Armored Elephants', 46, 345],
    [126, 'Heavy Chariots', 40, 339],
  ];
  for (const [tech, name, unit, record] of rows) {
    test(`${name} (${tech}) changes unit ${unit}${record === null ? ': enabled' : ` into ${UNIT_TYPES.get(record)!.name}`}`, () => {
      const world = new World({ players: 2, civs: [0, CIV_EGYPTIAN], fullTechTree: true, victory: { type: VICTORY_SPECIAL } });
      const before = copyUnitType(master(world, 1, unit));
      world.techs[1]![tech] = TECH_AVAILABLE;
      expect(doTech(world.gameContext(), 1, tech)).toBe(true);
      const after = master(world, 1, unit);
      expect(after).not.toEqual(before);
      if (record === null) expect([before.enabled, after.enabled]).toEqual([false, true]);
      else expect([after.name, after.hitPoints]).toEqual([UNIT_TYPES.get(record)!.name, UNIT_TYPES.get(record)!.hitPoints]);
    });
  }
});
