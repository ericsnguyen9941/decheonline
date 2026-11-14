/* eslint-disable no-restricted-properties -- the test compares the sim's trig with the engine's Math.* */
import { expect, test } from 'vitest';
import { CrtRand } from './rng';
import { atan2, cos, sin } from './trig';

const f64 = new Float64Array(1);
const bits = new BigInt64Array(f64.buffer);

/** Distance in units in the last place between two finite doubles of the same sign. */
function ulps(a: number, b: number): number {
  f64[0] = a;
  const x = bits[0]!;
  f64[0] = b;
  const d = x - bits[0]!;
  return Number(d < 0n ? -d : d);
}

test('atan2 is within one ulp of Math.atan2', () => {
  const gen = new CrtRand();
  gen.srand(7);
  const special: [number, number][] = [[0, 1], [0, -1], [-0, -1], [1, 0], [-1, 0], [1e300, 1e-300], [1e-300, -1e300]];
  for (const [y, x] of special) expect(atan2(y, x)).toBe(Math.atan2(y, x));
  for (let i = 0; i < 20000; i++) {
    const y = (gen.rand() - 16384) / (1 + (gen.rand() % 300));
    const x = (gen.rand() - 16384) / (1 + (gen.rand() % 300));
    expect(ulps(atan2(y, x), Math.atan2(y, x)), `atan2(${y}, ${x})`).toBeLessThanOrEqual(1);
  }
});

test('sin and cos are within one ulp of Math.sin and Math.cos', () => {
  const angles: number[] = [];
  for (let i = -40; i <= 40; i++) angles.push(Math.fround(i * Math.fround(0.7853982)), Math.fround(i * Math.fround(0.3926991)));
  const gen = new CrtRand();
  gen.srand(9);
  for (let i = 0; i < 20000; i++) angles.push(((gen.rand() - 16384) / 16384) * 20);
  for (const a of angles) {
    expect(ulps(sin(a), Math.sin(a)), `sin(${a})`).toBeLessThanOrEqual(1);
    expect(ulps(cos(a), Math.cos(a)), `cos(${a})`).toBeLessThanOrEqual(1);
  }
});
