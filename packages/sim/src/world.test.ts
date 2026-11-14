import { expect, test } from 'vitest';
import { runReplay, sampleReplay } from './replay';
import { World, type Snapshot } from './world';

/** Each test replays the sample log two or three times; the suite runs files in parallel. */
const REPLAY_TIMEOUT = 30_000;

test('replaying the same command log twice gives the same hash every turn', () => {
  const log = sampleReplay();
  const first = runReplay(log);
  const second = runReplay(log);
  expect(first).toHaveLength(log.turns);
  expect(second).toEqual(first);
  const changed = { ...log, batches: log.batches.slice(1) };
  expect(runReplay(changed).at(-1)).not.toBe(first.at(-1));
}, REPLAY_TIMEOUT);

test('snapshot round-trip through JSON restores the same state and the same future', () => {
  const log = sampleReplay();
  const full = runReplay(log);

  const half = { ...log, turns: log.turns / 2 };
  const world = new World({ players: log.players, randomSeed: log.randomSeed, units: log.units });
  runReplay(half, world);
  const snapshot = JSON.parse(JSON.stringify(world.snapshot())) as Snapshot;
  const restored = World.restore(snapshot);
  expect(restored.hash()).toBe(world.hash());
  expect(restored.snapshot()).toEqual(world.snapshot());

  const rest = runReplay(log, restored);
  expect(rest.at(-1)).toBe(full.at(-1));
  expect(restored.entities.size).toBeGreaterThan(0);
}, REPLAY_TIMEOUT);
