import { expect, test } from 'vitest';
import { CommandQueue, parseCommand } from './commands';
import { STEP_MS, World } from './world';

test('commands run ordered by sender player, then sequence; passed turns are dropped', () => {
  const q = new CommandQueue();
  q.push(5, 2, [{ type: 'test', x: 1, y: 1 }, { type: 'noop' }]);
  q.push(5, 1, [{ type: 'noop' }]);
  q.push(5, 1, [{ type: 'test', x: 2, y: 2 }]);
  q.push(4, 1, [{ type: 'noop' }]);
  q.push(6, 1, [{ type: 'noop' }]);
  expect(q.take(5).map((c) => [c.player, c.seq])).toEqual([
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2],
  ]);
  expect(q.size).toBe(1);
  expect(q.take(6)).toHaveLength(1);
});

test('a command issued on turn N runs on turn N + 2', () => {
  const world = new World({ players: 2 });
  world.addBatch(0, 1, [{ type: 'test', x: 3, y: 4 }]);
  world.runTurn();
  world.runTurn();
  expect(world.entities.size).toBe(0);
  world.runTurn();
  expect(world.entities.size).toBe(1);
  expect(world.pendingCommands).toBe(0);
});

test('turns 0..6 are one step, later turns the boundary step plus 10 buffer frames', () => {
  const world = new World({ players: 2 });
  for (let i = 0; i < 7; i++) world.runTurn();
  expect(world.worldTime).toBe(7 * STEP_MS);
  world.runTurn();
  expect(world.worldTime).toBe(7 * STEP_MS + 11 * STEP_MS);
});

test('parseCommand accepts the vocabulary and rejects anything else', () => {
  expect(parseCommand({ type: 'noop', extra: 1 })).toEqual({ type: 'noop' });
  expect(parseCommand({ type: 'test', x: 1.5, y: -2 })).toEqual({ type: 'test', x: 1.5, y: -2 });
  expect(parseCommand({ type: 'test', x: 'a', y: 1 })).toBeNull();
  expect(parseCommand({ type: 'test', x: Infinity, y: 1 })).toBeNull();
  expect(parseCommand({ type: 'move' })).toBeNull();
  expect(parseCommand([])).toBeNull();
  expect(parseCommand(null)).toBeNull();
});
