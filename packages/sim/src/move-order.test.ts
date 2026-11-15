import { describe, expect, test } from 'vitest';
import { type Command } from './commands';
import { AI_ORDER_MOVE } from './unit-ai';
import { CLUBMAN, VILLAGER } from './units';
import { VICTORY_SPECIAL } from './victory';
import { COMMAND_DELAY_TURNS, World, type StartUnit } from './world';

function order(world: World, player: number, command: Command): void {
  world.addBatch(world.turn, player, [command]);
}

function applied(world: World): void {
  for (let i = 0; i <= COMMAND_DELAY_TURNS; i++) world.runTurn();
}

function runUntil(world: World, done: () => boolean, limit = 400): void {
  for (let i = 0; i < limit && !done(); i++) world.runTurn();
  expect(done()).toBe(true);
}

function world(...units: StartUnit[]): World {
  return new World({ players: 3, units, victory: { type: VICTORY_SPECIAL } });
}

describe('movement.md §5: a top-level move that ends tells the unit AI (src/act_move.cpp:140, :205, :218, :236)', () => {
  test('a completed move resets the order and the action', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 10.5 });
    const v = w.entities.get(1)!;
    order(w, 1, { type: 'move', units: [1], x: 16.5, y: 10.5 });
    applied(w);
    w.runTurn();
    expect([v.ai!.order, v.mover!.action === null]).toEqual([AI_ORDER_MOVE, false]);
    runUntil(w, () => v.mover!.action === null);
    for (let i = 0; i < 3; i++) w.runTurn();
    expect([v.ai!.order, v.ai!.action]).toEqual([-1, -1]);
    expect(Math.abs(v.x - 16.5)).toBeLessThan(1);
  });

  test('a move to a point off the map fails, the unit stays, and the order resets', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 46.5, y: 10.5 });
    const v = w.entities.get(1)!;
    order(w, 1, { type: 'move', units: [1], x: 60.5, y: 10.5 });
    applied(w);
    for (let i = 0; i < 20; i++) w.runTurn();
    expect([v.mover!.action, v.ai!.order, v.ai!.action]).toEqual([null, -1, -1]);
    expect(v.x).toBeLessThan(48);
  });

  test('a moved Villager flees when attacked, as an unmoved one does', () => {
    const w = world({ owner: 1, type: VILLAGER, x: 10.5, y: 20.5 }, { owner: 2, type: CLUBMAN, x: 10.5, y: 26.5 });
    const v = w.entities.get(1)!;
    order(w, 1, { type: 'move', units: [1], x: 14.5, y: 20.5 });
    applied(w);
    runUntil(w, () => v.mover!.action === null);
    for (let i = 0; i < 3; i++) w.runTurn();
    const [sx, sy] = [v.x, v.y];
    order(w, 2, { type: 'attack', units: [2], target: 1 });
    for (let i = 0; i < 100; i++) w.runTurn();
    expect(v.hp).toBeLessThan(25);
    expect(Math.sqrt((v.x - sx) ** 2 + (v.y - sy) ** 2)).toBeGreaterThan(5);
  });
});
