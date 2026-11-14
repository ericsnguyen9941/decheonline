import { expect, test } from 'vitest';
import { facingFrame } from './facing';

test('an 8-facet mirrored graphic stores south..north through west and flips the east side', () => {
  // Villager graphics: 8 angles, mirror flag 6, 5 stored angles (facet 2 = south ... facet 6 = north).
  const at = (facet: number) => facingFrame(facet, 1, 8, 6, 6);
  expect([2, 3, 4, 5, 6].map(at)).toEqual([0, 1, 2, 3, 4].map((a) => ({ index: a * 6 + 1, flipped: false })));
  // East (0) shows west (4) flipped, south-east (1) shows south-west (3), north-east (7) shows north-west (5).
  expect(at(0)).toEqual({ index: 2 * 6 + 1, flipped: true });
  expect(at(1)).toEqual({ index: 1 * 6 + 1, flipped: true });
  expect(at(7)).toEqual({ index: 3 * 6 + 1, flipped: true });
});

test('an unmirrored graphic stores every facet in order', () => {
  expect(facingFrame(3, 2, 8, 10, 0)).toEqual({ index: 32, flipped: false });
});
