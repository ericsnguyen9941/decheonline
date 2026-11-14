import { expect, test } from 'vitest';
import { CrtRand } from './rng';
import { World } from './world';

test('rand() matches the core.md §4.3 worked example (seed 14 -> 84, 27125, ...)', () => {
  const rng = new CrtRand();
  rng.srand(14);
  expect([rng.rand(), rng.rand(), rng.rand(), rng.rand(), rng.rand()]).toEqual([84, 27125, 9192, 11643, 22187]);
});

test('world steps carry random_seed as in core.md §4.3 (14 -> 312 -> 3490 -> 4612)', () => {
  const world = new World({ players: 3, randomSeed: 14 });
  const seeds: number[] = [];
  for (let i = 0; i < 3; i++) {
    world.runTurn();
    seeds.push(world.randomSeed);
  }
  expect(seeds).toEqual([312, 3490, 4612]);
});

test('rand() stays in 0..32767 and wraps the 32-bit state', () => {
  const rng = new CrtRand();
  rng.srand(0xffffffff);
  for (let i = 0; i < 10000; i++) {
    const r = rng.rand();
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(32767);
  }
});
