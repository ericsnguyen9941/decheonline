import { expect, test } from 'vitest';
import { CommandQueue, parseCommand } from './commands';
import { VICTORY_SPECIAL } from './victory';
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

/** No objects: with conquest on, player 1 would lose at step 12 and the world would stop. */
const EMPTY = { players: 2, victory: { type: VICTORY_SPECIAL } };

test('turns 0..6 are one step, later turns the boundary step plus 10 buffer frames', () => {
  const world = new World(EMPTY);
  for (let i = 0; i < 7; i++) world.runTurn();
  expect(world.worldTime).toBe(7 * STEP_MS);
  world.runTurn();
  expect(world.worldTime).toBe(7 * STEP_MS + 11 * STEP_MS);
});

test('a speed change agreed for turn E runs from turn E + 1: boundary step and buffer frames at the new G and F', () => {
  const world = new World(EMPTY);
  for (let i = 0; i < 10; i++) world.runTurn();
  world.setSpeedChange({ turn: 10, granularity: 30, frames: 9 });
  const before = world.worldTime;
  world.runTurn();
  expect(world.worldTime - before).toBe(11 * STEP_MS);
  expect(world.granularity).toBe(STEP_MS);
  world.runStep();
  expect(world.worldTime - before).toBe(11 * STEP_MS + 30);
  expect([world.granularity, world.frames, world.turnStep]).toEqual([30, 9, 1]);
  for (let i = 0; i < 9; i++) world.runStep();
  expect(world.turn).toBe(12);
  expect(world.worldTime - before).toBe(11 * STEP_MS + 10 * 30);
  expect(world.speedChanges).toEqual([]);
});

test('a pending speed change is not hashed: a world that hears of it later, before it applies, stays in step', () => {
  const early = new World({ players: 2 });
  const late = new World({ players: 2 });
  const change = { turn: 9, granularity: 20, frames: 13 };
  early.setSpeedChange(change);
  for (let i = 0; i < 9; i++) {
    early.runTurn();
    late.runTurn();
    expect(late.hash()).toBe(early.hash());
  }
  late.setSpeedChange(change);
  early.runTurn();
  late.runTurn();
  expect(late.hash()).toBe(early.hash());
  early.runTurn();
  late.runTurn();
  expect(late.hash()).toBe(early.hash());
  expect(early.frames).toBe(13);
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
