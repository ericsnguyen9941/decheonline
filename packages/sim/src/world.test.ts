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

test('the sync checksum agrees between twin worlds and changes with a stockpile, a position, hit points or the random seed', () => {
  const log = sampleReplay();
  const a = new World({ players: log.players, randomSeed: log.randomSeed, units: log.units });
  const b = new World({ players: log.players, randomSeed: log.randomSeed, units: log.units });
  runReplay({ ...log, turns: 10 }, a);
  runReplay({ ...log, turns: 10 }, b);
  const sum = a.syncChecksum();
  expect(b.syncChecksum()).toBe(sum);
  a.attributes[1]![0]! += 1;
  expect(a.syncChecksum()).not.toBe(sum);
  a.attributes[1]![0]! -= 1;
  expect(a.syncChecksum()).toBe(sum);
  const unit = [...a.entities.all()][0]!;
  unit.x += 0.5;
  expect(a.syncChecksum()).not.toBe(sum);
  unit.x -= 0.5;
  unit.hp -= 1;
  expect(a.syncChecksum()).not.toBe(sum);
  unit.hp += 1;
  a.randomSeed += 1;
  expect(a.syncChecksum()).not.toBe(sum);
}, REPLAY_TIMEOUT);
