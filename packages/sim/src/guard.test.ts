import { describe, expect, test } from 'vitest';
import type { Command } from './commands';
import type { Entity } from './entities';
import { CLUBMAN, TOWN_CENTER, VILLAGER } from './units';
import type { Order } from './unit-ai';
import { VICTORY_SPECIAL } from './victory';
import { World, type StartUnit } from './world';

/** `UNIT_AI_ORDER_DEFEND`, `UNIT_AI_ORDER_FOLLOW`, `UNIT_AI_ACTION_DEFEND`, `UNIT_AI_ACTION_FOLLOW` (include/stat_obj.h). */
const ORDER_DEFEND = 0x2bd;
const ORDER_FOLLOW = 0x2c8;
const ACTION_DEFEND = 0x259;
const ACTION_FOLLOW = 0x264;

function world(units: StartUnit[]): World {
  return new World({ players: 3, units: [{ owner: 1, type: TOWN_CENTER, x: 4.5, y: 4.5 }, ...units], victory: { type: VICTORY_SPECIAL } });
}

function order(w: World, player: number, command: Command): void {
  w.addBatch(w.turn, player, [command]);
}

function runUntil(w: World, done: () => boolean, limit = 500): void {
  for (let i = 0; i < limit && !done(); i++) w.runTurn();
  expect(done()).toBe(true);
}

/** Queue a computer player's order (`order(..., immediate 0)`): the idle unit runs it on its next update. */
function give(e: Entity, type: number, target: number, x: number, y: number, range: number): void {
  const o: Order = { issuer: e.owner, type, target, targetOwner: -1, x, y, z: 0, range, priority: 100 };
  e.ai!.orders.push(o);
}

function gap(a: Entity, b: Entity): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

describe('unit-ai.md §4.7: DEFEND and FOLLOW (processMisc, src/aiuaimod.cpp:3477-3690; a computer player’s orders)', () => {
  test('FOLLOW: the Clubman records the target, walks after it once it moved more than a tile, and the order ends when it dies', () => {
    const w = world([
      { owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 },
      { owner: 1, type: VILLAGER, x: 12.5, y: 10.5 },
    ]);
    const [clubman, villager] = [w.entities.get(2)!, w.entities.get(3)!];
    w.runTurn();
    give(clubman, ORDER_FOLLOW, villager.id, -1, -1, 2);
    w.runTurn();
    expect([clubman.ai!.order, clubman.ai!.action, clubman.ai!.target]).toEqual([ORDER_FOLLOW, ACTION_FOLLOW, villager.id]);
    order(w, 1, { type: 'move', units: [villager.id], x: 30.5, y: 20.5 });
    runUntil(w, () => Math.abs(villager.x - 30.5) < 1 && Math.abs(villager.y - 20.5) < 1 && clubman.mover?.action == null);
    expect(gap(clubman, villager)).toBeLessThan(3.5);
    expect(clubman.ai!.order).toBe(ORDER_FOLLOW);
    villager.hp = 0;
    runUntil(w, () => clubman.ai!.order === -1, 20);
    expect(clubman.ai!.target).toBe(-1);
  });

  test('DEFEND an object: the Clubman walks back to the Villager, then attacks the enemy that hits it', () => {
    const w = world([
      { owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 },
      { owner: 1, type: VILLAGER, x: 20.5, y: 10.5 },
      { owner: 2, type: CLUBMAN, x: 40.5, y: 10.5 },
    ]);
    const [defender, villager, enemy] = [w.entities.get(2)!, w.entities.get(3)!, w.entities.get(4)!];
    w.runTurn();
    give(defender, ORDER_DEFEND, villager.id, -1, -1, 2);
    runUntil(w, () => defender.ai!.order === ORDER_DEFEND, 5);
    expect([defender.ai!.defendTarget, defender.ai!.lastAction === ACTION_DEFEND || defender.ai!.action === ACTION_DEFEND]).toEqual([villager.id, true]);
    // The walk back is a MOVE action, cleared when it ends; the order stays DEFEND.
    runUntil(w, () => gap(defender, villager) < 3.5 && defender.mover?.action == null, 200);
    expect(defender.ai!.order).toBe(ORDER_DEFEND);
    order(w, 2, { type: 'attack', units: [enemy.id], target: villager.id });
    runUntil(w, () => villager.ai!.attackers.includes(enemy.id), 500);
    runUntil(w, () => defender.attack?.target === enemy.id, 50);
  });

  test('DEFEND a position: the Clubman walks there and holds it; a guarded object that dies ends the order', () => {
    const w = world([{ owner: 1, type: CLUBMAN, x: 10.5, y: 10.5 }]);
    const clubman = w.entities.get(2)!;
    w.runTurn();
    give(clubman, ORDER_DEFEND, -1, 20.5, 14.5, 1);
    runUntil(w, () => clubman.ai!.order === ORDER_DEFEND, 5);
    expect([clubman.ai!.defendTarget, clubman.ai!.targetX, clubman.ai!.targetY]).toEqual([-1, 20.5, 14.5]);
    runUntil(w, () => Math.abs(clubman.x - 20.5) < 2.5 && Math.abs(clubman.y - 14.5) < 2.5 && clubman.mover?.action == null);
    for (let i = 0; i < 10; i++) w.runTurn();
    expect(clubman.ai!.order).toBe(ORDER_DEFEND);
  });
});
