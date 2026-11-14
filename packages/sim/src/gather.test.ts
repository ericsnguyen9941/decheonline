import { describe, expect, test } from 'vitest';
import type { Command } from './commands';
import { ObjectState } from './entities';
import { ACTION_GATHER, updateWork, WORK_DROP_OFF, WORK_TO_TARGET, WORK_WORKING } from './gather';
import { f32, mul32, MS_TO_SECONDS, add32, sub32 } from './num';
import { GAZELLE, HUNTER, LUMBERJACK, MINE_GOLD, MINER_GOLD, TOWN_CENTER, TREES, unitType, VILLAGER } from './units';
import { ATTR_FOOD, ATTR_GOLD, ATTR_WOOD, startingObjects, World, type StartUnit } from './world';

const GOLD_EARNED = 49;

function order(world: World, player: number, command: Command): void {
  world.addBatch(world.turn, player, [command]);
}

/** Run turns until `done` holds; fails after `limit` turns. */
function runUntil(world: World, done: () => boolean, limit = 400): void {
  for (let i = 0; i < limit && !done(); i++) world.runTurn();
  expect(done()).toBe(true);
}

/** Gaia objects keep their starting load; ids follow the list order. */
function objects(...list: StartUnit[]): StartUnit[] {
  return list;
}

describe('economy.md §8.1 vector E1: gold miner fills up and drops off', () => {
  test('445 steps of 50 ms fill the miner to exactly 10.0, the mine keeps 390.0038146972656; the Town Center gets 10', () => {
    const world = new World({
      players: 2,
      units: objects(
        { owner: 1, type: MINER_GOLD, x: 12.5, y: 10.5 },
        { owner: 0, type: MINE_GOLD, x: 13.5, y: 10.5 },
        { owner: 1, type: TOWN_CENTER, x: 8.5, y: 10.5 },
      ),
    });
    const miner = world.entities.get(1)!;
    const mine = world.entities.get(2)!;
    expect([mine.heldType, mine.heldAmount]).toEqual([ATTR_GOLD, 400]);
    expect(world.attributes[1]![47]).toBe(1);
    // Already facing the mine, in state 7.
    miner.work = { type: ACTION_GATHER, task: 0, state: WORK_WORKING, timer: 0, target: mine.id, target2: -1, x: mine.x, y: mine.y, z: 0 };
    miner.heldType = ATTR_GOLD;
    miner.heldAmount = 0;
    const ctx = world.gameContext();
    ctx.deltaSeconds = mul32(50, MS_TO_SECONDS);
    expect(ctx.deltaSeconds).toBe(0.05000000074505806);
    const give = 0.022499999031424522;
    let expected = 0;
    for (let step = 1; step <= 444; step++) {
      updateWork(ctx, miner);
      expected = f32(expected + give);
      expect(miner.heldAmount).toBe(expected);
      expect(miner.work.state).toBe(WORK_WORKING);
    }
    updateWork(ctx, miner);
    expect(miner.heldAmount).toBe(10);
    expect(mine.heldAmount).toBe(390.0038146972656);
    expect(miner.work.state).toBe(WORK_DROP_OFF);
    expect(miner.work.target2).toBe(3);

    const gold = world.attributes[1]![ATTR_GOLD]!;
    for (let i = 0; i < 400 && miner.heldType !== -1; i++) {
      ctx.attempts = 0;
      updateWork(ctx, miner);
    }
    expect([miner.heldType, miner.heldAmount]).toEqual([-1, 0]);
    expect(world.attributes[1]![ATTR_GOLD]).toBe(gold + 10);
    expect(world.attributes[1]![GOLD_EARNED]).toBe(10);
    // Back to the mine.
    expect(miner.work.state).toBe(WORK_TO_TARGET);
  });
});

describe('derived vector W1: a Villager chops a tree and drops off its wood', () => {
  test('the order makes it a Lumberjack; 9 axe blows of 3 fell the 25 hp tree; 10 wood reach the Town Center', () => {
    const world = new World({
      players: 2,
      units: objects(
        { owner: 1, type: VILLAGER, x: 12.5, y: 10.5 },
        { owner: 0, type: TREES[0], x: 14.5, y: 10.5 },
        { owner: 1, type: TOWN_CENTER, x: 8.5, y: 10.5 },
      ),
    });
    const unit = world.entities.get(1)!;
    const tree = world.entities.get(2)!;
    expect([tree.hp, tree.heldType, tree.heldAmount]).toEqual([25, ATTR_WOOD, 75]);
    // A living tree sleeps: it is not in Gaia's updated list.
    expect(world.awake[0]).not.toContain(tree.id);
    order(world, 1, { type: 'work', units: [1], target: 2, x: 14.5, y: 10.5 });
    runUntil(world, () => unit.type !== VILLAGER);
    expect(unit.type).toBe(LUMBERJACK);

    const hps: number[] = [tree.hp];
    runUntil(world, () => {
      if (tree.hp !== hps.at(-1)) hps.push(tree.hp);
      return tree.state >= ObjectState.Dying;
    });
    // Static damage: the weapon value, no armour and no minimum (combat.md §2.1).
    expect(hps).toEqual([25, 22, 19, 16, 13, 10, 7, 4, 1, 0]);
    // The felled tree woke up and still holds its wood while dying (the turn's later steps may already have taken some).
    expect(world.awake[0]).toContain(tree.id);
    expect(tree.heldAmount).toBeGreaterThan(70);

    const wood = world.attributes[1]![ATTR_WOOD]!;
    runUntil(world, () => world.attributes[1]![ATTR_WOOD] !== wood);
    expect(world.attributes[1]![ATTR_WOOD]).toBe(wood + 10);
    expect([unit.heldType, unit.heldAmount]).toEqual([-1, 0]);
    // §3.3 with work rate 0.55, 90 ms steps: the tree loses exactly what the takes add up to.
    const t = unitType(LUMBERJACK);
    const give = mul32(mul32(1, t.action!.workRate), mul32(90, MS_TO_SECONDS));
    let held = 0;
    let left = f32(75);
    while (held < 10) {
      let g = give;
      let adj = g;
      const room = sub32(10, held);
      if (adj > room) {
        const excess = sub32(adj, room);
        adj = sub32(adj, excess);
        g = sub32(g, excess);
      }
      left = add32(-g, left);
      held = add32(adj, held);
    }
    expect(tree.heldAmount).toBe(left);
    expect(unit.work?.state).toBe(WORK_TO_TARGET);
  });
});

describe('derived vector H1: a Villager hunts a gazelle and drops off its food', () => {
  test('the order makes it a Hunter; spears kill the 8 hp gazelle in two hits of 4; 10 food reach the Town Center', () => {
    const world = new World({
      players: 2,
      units: objects(
        { owner: 1, type: VILLAGER, x: 12.5, y: 10.5 },
        { owner: 0, type: GAZELLE, x: 16.5, y: 12.5 },
        { owner: 1, type: TOWN_CENTER, x: 8.5, y: 10.5 },
      ),
    });
    const unit = world.entities.get(1)!;
    const gazelle = world.entities.get(2)!;
    expect([gazelle.hp, gazelle.heldType, gazelle.heldAmount]).toEqual([8, ATTR_FOOD, 150]);
    order(world, 1, { type: 'work', units: [1], target: 2, x: 16.5, y: 12.5 });
    runUntil(world, () => unit.type !== VILLAGER);
    expect(unit.type).toBe(HUNTER);

    const hps: number[] = [gazelle.hp];
    let spears = 0;
    const seen = new Set<number>();
    runUntil(world, () => {
      if (gazelle.hp !== hps.at(-1)) hps.push(gazelle.hp);
      for (const e of world.entities.all()) {
        if (e.type === 100 && !seen.has(e.id)) {
          seen.add(e.id);
          spears++;
        }
      }
      return gazelle.state >= ObjectState.Dying;
    });
    // Hunter weapon class 4 attack 4 against base armour 0 (combat.md §2.2); 80% accuracy, so misses may come first.
    expect(hps).toEqual([8, 4, 0]);
    expect(spears).toBeGreaterThanOrEqual(2);
    // A civilian's kill keeps its food (less the rot of the turn's later steps).
    expect(gazelle.heldAmount).toBeGreaterThan(145);

    const food = world.attributes[1]![ATTR_FOOD]!;
    runUntil(world, () => world.attributes[1]![ATTR_FOOD] !== food);
    expect(world.attributes[1]![ATTR_FOOD]).toBe(food + 10);
    expect(gazelle.state).toBe(ObjectState.Dead);
    // The carcass rots at 0.3 food per second besides what the hunter took.
    expect(gazelle.heldAmount).toBeLessThan(140);
    expect(gazelle.heldAmount).toBeGreaterThan(120);
    expect(unit.work?.state).toBe(WORK_TO_TARGET);
  });
});

describe('starting objects', () => {
  test('each player starts with 200 food, 200 wood, 150 stone, 0 gold and a Town Center; resources lie on land, apart', () => {
    const world = new World({ players: 3, units: startingObjects(3) });
    for (const p of [1, 2]) expect(world.attributes[p]!.slice(0, 4)).toEqual([200, 200, 150, 0]);
    const all = [...world.entities.all()];
    expect(all.filter((e) => e.type === TOWN_CENTER).map((e) => e.owner)).toEqual([1, 2]);
    for (const e of all) expect(unitType(e.type).terrainTable[world.map.terrainAt(Math.trunc(e.x), Math.trunc(e.y))]).toBeGreaterThan(0);
    expect(Math.max(...world.pathing.cells)).toBeLessThanOrEqual(1);
  });
});
