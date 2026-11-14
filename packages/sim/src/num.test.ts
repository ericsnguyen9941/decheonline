import { expect, test } from 'vitest';
import { add32, div32, f32, MS_TO_SECONDS, mul32, sqrt32, toInt, toUint } from './num';

test('float32 helpers round every result to float32', () => {
  expect(add32(0.1, 0.2)).toBe(f32(f32(0.1) + f32(0.2)));
  expect(add32(0.1, 0.2)).not.toBe(0.1 + 0.2);
  expect(mul32(90, MS_TO_SECONDS)).toBe(f32(0.09));
  expect(div32(1, 3)).toBe(f32(1 / 3));
  expect(sqrt32(2)).toBe(f32(Math.SQRT2));
});

test('float to int casts truncate toward zero like C', () => {
  expect(toInt(2.9)).toBe(2);
  expect(toInt(-2.9)).toBe(-2);
  expect(toUint(135.99)).toBe(135);
  expect(toUint(-1)).toBe(0xffffffff);
});
