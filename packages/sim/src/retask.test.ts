import { describe, expect, test } from 'vitest';
import type { Command } from './commands';
import { ObjectState } from './entities';
import { ACTION_BUILD } from './build';
import { ACTION_GATHER } from './gather';
import { HOUSE, MINE_GOLD, TOWN_CENTER, TREES, VILLAGER } from './units';
import { Visibility } from './visibility';
import { ATTR_GOLD, World, type StartUnit } from './world';

function order(w: World, player: number, command: Command): void {
  w.addBatch(w.turn, player, [command]);
}

function runUntil(w: World, done: () => boolean, limit = 2000): void {
  for (let i = 0; i < limit && !done(); i++) w.runTurn();
  expect(done()).toBe(true);
}

function world(units: StartUnit[]): World {
  return new World({ players: 2, units });
}

describe('unit-ai.md §5.6: the visible-resource lists', () => {
  test('Get_Closest_Resource: xd + yd - trunc(-0.61 - 1.4 × the smaller) from the unit’s tile, first record on ties, excluded ids skipped, capped at 255', () => {
    const v = new Visibility(300, 300, 2);
    const gold = v.resources[1]![4]!;
    gold.push({ id: 7, x: 3, y: 1 }, { id: 8, x: 2, y: 2 }, { id: 9, x: 1, y: 3 }, { id: 10, x: 299, y: 0 });
    // (3, 1): 3 - trunc(-2.01) - 1 = 4; (2, 2): 2 - trunc(-3.41) - 2 = 3; (1, 3) ties at 4.
    expect(v.closestResource(1, 0, 0, 4, [])).toEqual({ id: 8, distance: 3 });
    expect(v.closestResource(1, 0, 0, 4, [8])).toEqual({ id: 7, distance: 4 });
    expect(v.closestResource(1, 0, 0, 4, [7, 8, 9])).toEqual({ id: 10, distance: 255 });
    expect(v.closestResource(1, 0, 0, 3, [])).toBeNull();
  });

  test('an explored tile’s trees and mines join the player’s lists at its update; a mine that is used up leaves every list', () => {
    const w = world([
      { owner: 1, type: VILLAGER, x: 10.5, y: 10.5 },
      { owner: 0, type: MINE_GOLD, x: 12.5, y: 10.5 },
      { owner: 0, type: TREES[0], x: 10.5, y: 13.5 },
      { owner: 0, type: MINE_GOLD, x: 40.5, y: 40.5 },
    ]);
    w.runTurn();
    expect(w.visibility.resources[1]![4]).toEqual([{ id: 2, x: 12, y: 10 }]);
    expect(w.visibility.resources[1]![0]).toEqual([{ id: 3, x: 10, y: 13 }]);
    expect(w.visibility.newTiles[1]).toEqual([]);
    const mine = w.entities.get(2)!;
    mine.heldAmount = 1;
    order(w, 1, { type: 'work', units: [1], target: 2, x: mine.x, y: mine.y });
    runUntil(w, () => !w.entities.get(2));
    expect(w.visibility.resources[1]![4]).toEqual([]);
  });
});

describe('economy.md §10: the civilian re-task (src/taiuaimd.cpp:707-863)', () => {
  test('a gold miner whose mine runs out goes on to the closest gold mine it knows, not a farther one', () => {
    const w = world([
      { owner: 1, type: TOWN_CENTER, x: 6.5, y: 10.5 },
      { owner: 1, type: VILLAGER, x: 10.5, y: 10.5 },
      { owner: 0, type: MINE_GOLD, x: 12.5, y: 10.5 },
      { owner: 0, type: MINE_GOLD, x: 10.5, y: 15.5 },
      { owner: 0, type: MINE_GOLD, x: 12.5, y: 13.5 },
    ]);
    const v = w.entities.get(2)!;
    w.entities.get(3)!.heldAmount = 3;
    order(w, 1, { type: 'work', units: [2], target: 3, x: 12.5, y: 10.5 });
    runUntil(w, () => !w.entities.get(3));
    runUntil(w, () => v.work?.target === 5 && v.work.type === ACTION_GATHER, 50);
    runUntil(w, () => w.entities.get(5)!.heldAmount < 400);
    expect(w.entities.get(4)!.heldAmount).toBe(400);
    expect(w.attributes[1]![ATTR_GOLD]).toBeGreaterThan(0);
  });

  test('none within its line of sight + 5 tiles: the miner waits by the empty spot (a human player’s unit is not stopped on a request)', () => {
    const w = world([
      { owner: 1, type: TOWN_CENTER, x: 6.5, y: 10.5 },
      { owner: 1, type: VILLAGER, x: 10.5, y: 10.5 },
      { owner: 0, type: MINE_GOLD, x: 12.5, y: 10.5 },
      // Seen by the House, 13 tiles from the miner: beyond its 4 + 5.
      { owner: 1, type: HOUSE, x: 25.5, y: 10.5 },
      { owner: 0, type: MINE_GOLD, x: 25.5, y: 13.5 },
    ]);
    const v = w.entities.get(2)!;
    w.entities.get(3)!.heldAmount = 3;
    order(w, 1, { type: 'work', units: [2], target: 3, x: 12.5, y: 10.5 });
    runUntil(w, () => !w.entities.get(3));
    expect(w.visibility.resources[1]![4]!.map((r) => r.id)).toEqual([5]);
    for (let i = 0; i < 30; i++) w.runTurn();
    expect(v.work?.type).toBe(ACTION_GATHER);
    expect(v.work?.target).not.toBe(5);
    expect(w.entities.get(5)!.heldAmount).toBe(400);
  });

  test('a builder whose House is done takes up the next own foundation (§4.8.3)', () => {
    const w = world([
      { owner: 1, type: TOWN_CENTER, x: 6.5, y: 10.5 },
      { owner: 1, type: VILLAGER, x: 10.5, y: 10.5 },
    ]);
    const v = w.entities.get(2)!;
    order(w, 1, { type: 'build', units: [2], unitType: HOUSE, x: 12, y: 15 });
    w.runTurn();
    order(w, 1, { type: 'build', units: [2], unitType: HOUSE, x: 12, y: 12 });
    runUntil(w, () => [...w.entities.all()].filter((e) => e.type === HOUSE).length === 2, 10);
    const [far, near] = [...w.entities.all()].filter((e) => e.type === HOUSE);
    runUntil(w, () => near!.state === ObjectState.Active);
    expect(far!.state).toBe(ObjectState.Unbuilt);
    runUntil(w, () => v.work?.type === ACTION_BUILD && v.work.target === far!.id, 50);
    runUntil(w, () => far!.state === ObjectState.Active);
  });
});
