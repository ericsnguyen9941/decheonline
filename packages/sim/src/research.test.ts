import { describe, expect, test } from 'vitest';
import { checkPlacement } from './buildings';
import type { Command } from './commands';
import { ObjectState, type Entity } from './entities';
import { copyMasters, master } from './masters';
import { ActionResult } from './movement';
import { add32, f32, mul32, MS_TO_SECONDS } from './num';
import { orderResearch, updateResearch } from './research';
import {
  buildingFacet,
  doTech,
  isEnabled,
  TECH_AVAILABLE,
  TECH_DISABLED,
  TECH_DONE,
  TECH_LOCKED,
  TECH_RESEARCHING,
  TOOL_AGE,
  IRON_AGE,
} from './techs';
import {
  ARCHERY_RANGE,
  BARRACKS,
  BOWMAN,
  CIV_EGYPTIAN,
  CIV_GAIA,
  civUnitTypes,
  GRANARY,
  HOUSE,
  MARKET,
  MINER_GOLD,
  MINER_STONE,
  SCOUT,
  SLINGER,
  STABLE,
  TOWN_CENTER,
  VILLAGER,
  WATCH_TOWER,
} from './units';
import { VICTORY_SPECIAL } from './victory';
import { ATTR_FOOD, ATTR_GOLD, ATTR_WOOD, COMMAND_DELAY_TURNS, startingObjects, STEP_MS, stepsInTurn, World } from './world';

const CIV_BABYLONIAN = 3;
const ATTR_AGE = 6;
const ATTR_TECH_COUNT = 21;
const ATTR_BUILDING_ALLOWANCE = 30;
/** The 2-second techs a finished Granary, Storage Pit and Barracks complete (`on_build_make_tech`). */
const GRANARY_BUILT = 10;
const STORAGE_PIT_BUILT = 39;
const BARRACKS_BUILT = 62;
/** Tool Age prerequisite: two of Dock, Granary, Storage Pit, Barracks built. */
const TOOL_AGE_SHADOW = 74;

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

/** Steps and the float32 sum when `research` seconds are first reached by `work`-sized steps (techs.md §6). */
function stepsToResearch(work: number, research: number): [steps: number, sum: number] {
  let sum = 0;
  let steps = 0;
  while (sum < research) {
    sum = add32(sum, work);
    steps++;
  }
  return [steps, sum];
}

/** A Town Center for player 1 with the Tool Age available (Granary and Storage Pit techs done as if built). */
function toolAgeReady(): { world: World; tc: Entity } {
  // Conquest off: player 2 has nothing and would otherwise lose at step 12, which ends the game.
  const world = new World({ players: 3, units: [{ owner: 1, type: TOWN_CENTER, x: 20.5, y: 20.5 }], victory: { type: VICTORY_SPECIAL } });
  const ctx = world.gameContext();
  expect(world.techs[1]![TOOL_AGE]).toBe(TECH_LOCKED);
  doTech(ctx, 1, GRANARY_BUILT);
  doTech(ctx, 1, STORAGE_PIT_BUILT);
  expect([world.techs[1]![TOOL_AGE_SHADOW], world.techs[1]![TOOL_AGE]]).toEqual([TECH_DONE, TECH_AVAILABLE]);
  return { world, tc: world.entities.get(1)! };
}

/** Step a research with `updateResearch` at `ms` per step; returns the number of steps until it is done. */
function stepResearch(world: World, tc: Entity, ms: number): number {
  const ctx = world.gameContext();
  ctx.deltaSeconds = mul32(ms, MS_TO_SECONDS);
  let steps = 0;
  for (;;) {
    steps++;
    if (updateResearch(ctx, tc, tc.research!) === ActionResult.Remove) break;
    expect(steps).toBeLessThan(5000);
  }
  tc.research = null;
  return steps;
}

describe('techs.md §7.1 vector R1: research timing in 90 ms steps', () => {
  test('Tool Age at a rate-1 Town Center: 500 food paid at once, work 0.09000000357627869 a step, done on step 1334 at 120.05781555175781', () => {
    const { world, tc } = toolAgeReady();
    world.attributes[1]![ATTR_FOOD] = 500;
    expect(mul32(90, MS_TO_SECONDS)).toBe(0.09000000357627869);
    orderResearch(world.gameContext(), tc, TOOL_AGE);
    expect([world.attributes[1]![ATTR_FOOD], world.techs[1]![TOOL_AGE]]).toEqual([0, TECH_RESEARCHING]);
    expect(stepResearch(world, tc, 90)).toBe(1334);
    expect(world.researchDone[1]![TOOL_AGE]).toBe(120.05781555175781);
    expect(world.techs[1]![TOOL_AGE]).toBe(TECH_DONE);
  });

  test('the same at 100 ms: 1201 steps, 120.09873962402344 (float drift costs a step)', () => {
    const { world, tc } = toolAgeReady();
    world.attributes[1]![ATTR_FOOD] = 500;
    orderResearch(world.gameContext(), tc, TOOL_AGE);
    expect(stepResearch(world, tc, 100)).toBe(1201);
    expect(world.researchDone[1]![TOOL_AGE]).toBe(120.09873962402344);
  });

  test('a free 2-second building tech (Barracks built, 62) researched at the Town Center: 23 steps, 2.070000410079956', () => {
    const { world, tc } = toolAgeReady();
    orderResearch(world.gameContext(), tc, BARRACKS_BUILT);
    expect(world.attributes[1]![ATTR_FOOD]).toBe(200);
    expect(stepResearch(world, tc, 90)).toBe(23);
    expect(world.researchDone[1]![BARRACKS_BUILT]).toBe(2.070000410079956);
  });

  test('the other rows: Leather Armor - Soldiers 334 steps, Bronze Age 1556, Iron Age 1778 (state 1 and resources set by the test)', () => {
    const rows: [tech: number, steps: number, sum: number][] = [
      [40, 334, 30.060041427612305],
      [102, 1556, 140.03700256347656],
      [IRON_AGE, 1778, 160.0161895751953],
    ];
    for (const [tech, steps, sum] of rows) {
      const { world, tc } = toolAgeReady();
      world.techs[1]![tech] = TECH_AVAILABLE;
      world.attributes[1]![ATTR_FOOD] = 2000;
      world.attributes[1]![ATTR_GOLD] = 2000;
      orderResearch(world.gameContext(), tc, tech);
      expect(world.techs[1]![tech]).toBe(TECH_RESEARCHING);
      expect([tech, stepResearch(world, tc, 90), world.researchDone[1]![tech]]).toEqual([tech, steps, sum]);
    }
  });

  test('through the command: paid on its own step, which adds the first work; done when the 90 ms sum reaches 120', () => {
    const { world, tc } = toolAgeReady();
    world.attributes[1]![ATTR_FOOD] = 600;
    order(world, 1, { type: 'research', building: tc.id, tech: TOOL_AGE });
    const start = world.turn + COMMAND_DELAY_TURNS;
    while (world.turn < start) world.runTurn();
    expect(world.attributes[1]![ATTR_FOOD]).toBe(600);
    const [n, sum] = stepsToResearch(mul32(STEP_MS, MS_TO_SECONDS), 120);
    let steps = 0;
    let last = 0;
    while (world.techs[1]![TOOL_AGE] !== TECH_DONE) {
      last = stepsInTurn(world.turn);
      world.runTurn();
      steps += last;
      expect(world.attributes[1]![ATTR_FOOD]).toBe(100);
    }
    // The research ended inside the last turn, on step n counting the command's step as 1.
    expect(steps >= n && steps - last < n).toBe(true);
    expect(world.researchDone[1]![TOOL_AGE]).toBe(sum);
    expect(tc.research).toBeNull();
  });
});

describe('techs.md §7.2 cost and refund, through commands', () => {
  /** Iron Age made available by the test; food and gold as given. */
  function ironAge(food: number, gold: number): { world: World; tc: Entity } {
    const { world, tc } = toolAgeReady();
    world.techs[1]![IRON_AGE] = TECH_AVAILABLE;
    world.attributes[1]![ATTR_FOOD] = food;
    world.attributes[1]![ATTR_GOLD] = gold;
    order(world, 1, { type: 'research', building: tc.id, tech: IRON_AGE });
    for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) world.runTurn();
    return { world, tc };
  }

  test('1000 food and 800 gold: with 700 gold nothing is paid and the failed research is gone after its first update', () => {
    const { world, tc } = ironAge(1200, 700);
    expect([world.attributes[1]![ATTR_FOOD], world.attributes[1]![ATTR_GOLD], world.techs[1]![IRON_AGE]]).toEqual([1200, 700, TECH_AVAILABLE]);
    expect(tc.research).toBeNull();
  });

  test('with 900 gold: food 200, gold 100; stop refunds 1200 and 900 and clears the progress', () => {
    const { world, tc } = ironAge(1200, 900);
    expect([world.attributes[1]![ATTR_FOOD], world.attributes[1]![ATTR_GOLD], world.techs[1]![IRON_AGE]]).toEqual([200, 100, TECH_RESEARCHING]);
    expect(world.researchDone[1]![IRON_AGE]).toBeGreaterThan(0);
    order(world, 1, { type: 'stop', objects: [tc.id] });
    for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) world.runTurn();
    expect([world.attributes[1]![ATTR_FOOD], world.attributes[1]![ATTR_GOLD], world.techs[1]![IRON_AGE]]).toEqual([1200, 900, TECH_AVAILABLE]);
    expect(world.researchDone[1]![IRON_AGE]).toBe(0);
    expect(tc.research).toBeNull();
  });

  test('the Town Center destroyed instead: no refund (food 200, gold 100), the tech available again', () => {
    const { world, tc } = ironAge(1200, 900);
    tc.hp = 0;
    world.runTurn();
    expect([world.attributes[1]![ATTR_FOOD], world.attributes[1]![ATTR_GOLD], world.techs[1]![IRON_AGE]]).toEqual([200, 100, TECH_AVAILABLE]);
    expect(world.researchDone[1]![IRON_AGE]).toBe(0);
  });

  test('another player\'s stop and research commands are ignored', () => {
    const { world, tc } = ironAge(1200, 900);
    order(world, 2, { type: 'stop', objects: [tc.id] });
    order(world, 2, { type: 'research', building: tc.id, tech: TOOL_AGE });
    for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) world.runTurn();
    expect([world.attributes[1]![ATTR_FOOD], world.techs[1]![IRON_AGE], world.techs[1]![TOOL_AGE]]).toEqual([200, TECH_RESEARCHING, TECH_AVAILABLE]);
  });
});

describe('a building does one thing at a time (techs.md §3.1, economy.md §5.1)', () => {
  test('a research drops the production queue without refund; a second research is dropped while the first runs', () => {
    const { world, tc } = toolAgeReady();
    world.attributes[1]![ATTR_FOOD] = 1000;
    order(world, 1, { type: 'queue', building: tc.id, unit: VILLAGER, count: 3 });
    for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) world.runTurn();
    expect(tc.queue).toEqual([{ unit: VILLAGER, count: 3 }]);
    expect(tc.train).not.toBeNull();
    expect(world.attributes[1]![ATTR_FOOD]).toBe(850);
    order(world, 1, { type: 'research', building: tc.id, tech: TOOL_AGE });
    for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) world.runTurn();
    expect([tc.queue, tc.train, world.attributes[1]![ATTR_FOOD]]).toEqual([[], null, 350]);
    order(world, 1, { type: 'research', building: tc.id, tech: BARRACKS_BUILT });
    for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) world.runTurn();
    expect([tc.research?.tech, world.techs[1]![BARRACKS_BUILT]]).toEqual([TOOL_AGE, TECH_AVAILABLE]);
  });

  test('stop with units queued and no research refunds every queued unit', () => {
    const { world, tc } = toolAgeReady();
    world.attributes[1]![ATTR_FOOD] = 1000;
    order(world, 1, { type: 'queue', building: tc.id, unit: VILLAGER, count: 3 });
    for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) world.runTurn();
    order(world, 1, { type: 'stop', objects: [tc.id] });
    for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) world.runTurn();
    expect([tc.queue, tc.train, world.attributes[1]![ATTR_FOOD]]).toEqual([[], null, 1000]);
  });
});

/** A free spot for building `type` of `player` near (x, y), searched outwards ring by ring. */
function spot(world: World, player: number, type: number, x: number, y: number): [number, number] {
  const t = master(world, player, type);
  const ctx = world.gameContext();
  for (let r = 3; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = f32(x + dx);
        const py = f32(y + dy);
        if (checkPlacement(ctx, t, px, py, true, true) === 0) return [px, py];
      }
    }
  }
  throw new Error(`no spot for ${type}`);
}

/** Order `builders` to build `type` near the player's Town Center; returns the foundation once it exists. */
function buildNear(world: World, player: number, builders: number[], type: number, tc: Entity): Entity {
  const [x, y] = spot(world, player, type, tc.x, tc.y);
  order(world, player, { type: 'build', units: builders, unitType: type, x, y });
  let found: Entity | undefined;
  runUntil(world, () => (found = units(world, player, type).find((e) => e.state === ObjectState.Unbuilt)) !== undefined, 5);
  return found!;
}

describe('techs.md §7.5 vector R2: the Tool Age through commands', () => {
  test('a player researches the Tool Age, builds an Archery Range and trains a Bowman; the other player\'s masters and techs are unchanged', () => {
    const world = new World({ players: 3, units: startingObjects(3) });
    const tc = units(world, 1, TOWN_CENTER)[0]!;
    const villagers = units(world, 1, VILLAGER).map((e) => e.id);
    const start = { masters: copyMasters(world.masters), techs: world.techs.map((t) => [...t]), attributes: world.attributes.map((a) => [...a]) };
    const attributes = world.attributes[1]!;
    attributes[ATTR_FOOD] = 2000;
    attributes[ATTR_WOOD] = 2000;

    // Stone Age: no Archery Range; the Tool Age needs two of Dock, Granary, Storage Pit and Barracks.
    expect([isEnabled(world, 1, ARCHERY_RANGE), world.techs[1]![TOOL_AGE]]).toEqual([false, TECH_LOCKED]);
    const house = buildNear(world, 1, [villagers[0]!], HOUSE, tc);
    const granary = buildNear(world, 1, [villagers[1]!], GRANARY, tc);
    const barracks = buildNear(world, 1, [villagers[2]!], BARRACKS, tc);
    runUntil(world, () => [house, granary, barracks].every((b) => b.state === ObjectState.Active), 800);
    expect([GRANARY_BUILT, BARRACKS_BUILT, TOOL_AGE_SHADOW].map((t) => world.techs[1]![t])).toEqual([TECH_DONE, TECH_DONE, TECH_DONE]);
    expect(world.techs[1]![TOOL_AGE]).toBe(TECH_AVAILABLE);
    const houseSprite = house.sprite?.graphic;

    const before = { food: attributes[ATTR_FOOD]!, techCount: attributes[ATTR_TECH_COUNT]!, allowance: attributes[ATTR_BUILDING_ALLOWANCE]! };
    order(world, 1, { type: 'research', building: tc.id, tech: TOOL_AGE });
    runUntil(world, () => world.techs[1]![TOOL_AGE] === TECH_DONE, 300);
    // Effect 95: age 2, Town Center facet 2, House <- House1 (154), technology count +1, building allowance +8, Scout
    // line of sight +2. Techs 94/95/97/123 complete at once: Market, Archery Range, Stable and Slinger enabled; the
    // Granary's Stone Wall (11) and Watch Tower (16) open; the Bronze Age waits for two Tool Age buildings.
    expect(attributes[ATTR_FOOD]).toBe(before.food - 500);
    expect([attributes[ATTR_AGE], attributes[ATTR_TECH_COUNT], attributes[ATTR_BUILDING_ALLOWANCE]]).toEqual([2, before.techCount + 1, before.allowance + 8]);
    expect(buildingFacet(world, 1, TOWN_CENTER)).toBe(2);
    expect(master(world, 1, HOUSE).standing.graphic).toBe(civUnitTypes(CIV_EGYPTIAN)[154]!.standing.graphic);
    expect(house.sprite?.graphic).not.toBe(houseSprite);
    expect(master(world, 1, SCOUT).los).toBe(f32(civUnitTypes(CIV_EGYPTIAN)[SCOUT]!.los + 2));
    expect([94, 95, 97, 123].map((t) => world.techs[1]![t])).toEqual([TECH_DONE, TECH_DONE, TECH_DONE, TECH_DONE]);
    expect([MARKET, ARCHERY_RANGE, STABLE, SLINGER].map((id) => isEnabled(world, 1, id))).toEqual([true, true, true, true]);
    expect([11, 16, 102].map((t) => world.techs[1]![t])).toEqual([TECH_AVAILABLE, TECH_AVAILABLE, TECH_LOCKED]);

    expect(isEnabled(world, 1, BOWMAN)).toBe(false);
    const range = buildNear(world, 1, villagers, ARCHERY_RANGE, tc);
    runUntil(world, () => range.state === ObjectState.Active, 800);
    // The finished Range completes its tech 55, which enables the Bowman.
    expect([world.techs[1]![55], isEnabled(world, 1, BOWMAN)]).toEqual([TECH_DONE, true]);
    order(world, 1, { type: 'queue', building: range.id, unit: BOWMAN, count: 1 });
    runUntil(world, () => units(world, 1, BOWMAN).length === 1, 800);

    // Player 2 issued nothing: its masters, techs and attributes are as they started.
    expect(world.masters[2]).toEqual(start.masters[2]);
    expect(world.techs[2]).toEqual(start.techs[2]);
    // Except attribute 22, % explored, and 9, the trade goods, which the per-second block rewrites (victory.md §4,
    // support-actions.md §7.4).
    const unexplored = (a: number[]) => a.map((v, i) => (i === 22 || i === 9 ? 0 : v));
    expect(unexplored(world.attributes[2]!)).toEqual(unexplored(start.attributes[2]!));
    expect(world.masters[1]).not.toEqual(start.masters[1]);
    expect([isEnabled(world, 2, ARCHERY_RANGE), buildingFacet(world, 2, TOWN_CENTER)]).toEqual([false, 1]);
  });
});

describe('civ effects at game start (techs.md §3.8)', () => {
  test('an Egyptian and a Babylonian player each get their civ effect on their own masters and objects only', () => {
    const world = new World({
      players: 3,
      civs: [CIV_GAIA, CIV_EGYPTIAN, CIV_BABYLONIAN],
      units: [
        { owner: 1, type: WATCH_TOWER, x: 10.5, y: 10.5 },
        { owner: 2, type: WATCH_TOWER, x: 30.5, y: 30.5 },
      ],
    });
    const egypt = civUnitTypes(CIV_EGYPTIAN);
    const babylon = civUnitTypes(CIV_BABYLONIAN);
    const plus = (a: number, b: number) => add32(a, f32(b));
    // Egyptians (effect 83): Gold Miner work rate +0.2 and carry +2.
    expect(master(world, 1, MINER_GOLD).action!.workRate).toBe(plus(egypt[MINER_GOLD]!.action!.workRate, 0.2));
    expect(master(world, 1, MINER_GOLD).resourceCapacity).toBe(egypt[MINER_GOLD]!.resourceCapacity + 2);
    expect(master(world, 2, MINER_GOLD)).toEqual(babylon[MINER_GOLD]);
    // Babylonians (effect 82): Stone Miner work rate +0.2 and carry +3, towers and walls hp x2, attribute 35 +0.75.
    expect(master(world, 2, MINER_STONE).action!.workRate).toBe(plus(babylon[MINER_STONE]!.action!.workRate, 0.2));
    expect(master(world, 2, MINER_STONE).resourceCapacity).toBe(babylon[MINER_STONE]!.resourceCapacity + 3);
    expect(master(world, 1, MINER_STONE)).toEqual(egypt[MINER_STONE]);
    expect([master(world, 1, WATCH_TOWER).hitPoints, master(world, 2, WATCH_TOWER).hitPoints]).toEqual([100, 200]);
    // Objects already placed change with their owner's masters.
    expect([world.entities.get(1)!.hp, world.entities.get(2)!.hp]).toEqual([100, 200]);
    expect([world.attributes[1]![35], world.attributes[2]![35]]).toEqual([2, 2.75]);
    // Each tech tree disables its own techs: 30 for the Egyptians, 7 for the Babylonians.
    expect([world.techs[1]![30], world.techs[2]![30]]).toEqual([TECH_DISABLED, TECH_LOCKED]);
    expect([world.techs[1]![7], world.techs[2]![7]]).toEqual([TECH_LOCKED, TECH_DISABLED]);
    // The shared civ records stay as the dat has them.
    expect(egypt[MINER_GOLD]!.action!.workRate).toBe(f32(0.45));
    expect(babylon[WATCH_TOWER]!.hitPoints).toBe(100);
  });

  test('the default civ is Egyptian for players and Gaia for player 0', () => {
    const world = new World({ players: 3 });
    expect(world.civs).toEqual([CIV_GAIA, CIV_EGYPTIAN, CIV_EGYPTIAN]);
    expect(master(world, 2, MINER_GOLD).resourceCapacity).toBe(civUnitTypes(CIV_EGYPTIAN)[MINER_GOLD]!.resourceCapacity + 2);
    expect(master(world, 0, MINER_GOLD).resourceCapacity).toBe(civUnitTypes(CIV_GAIA)[MINER_GOLD]!.resourceCapacity);
  });
});
