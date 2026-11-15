import { expect, test } from 'vitest';
import { FRAME_BOX, IN_RANGE, partConfidence, pickWeight, PIXEL, ROW_SPAN, spriteCheck, type FramePixels } from './pick';
import { outlinePoint } from './unit-layer';

/** A frame from rows of '#' (drawn) and '.' (see-through). */
function frame(rows: string[]): FramePixels {
  const width = rows[0]!.length;
  const pixels = new Uint8ClampedArray(width * rows.length * 4);
  rows.forEach((row, y) => [...row].forEach((c, x) => (pixels[(y * width + x) * 4 + 3] = c === '#' ? 255 : 0)));
  return { pixels, stride: width, width, height: rows.length };
}

// A sparse building row, as the Stone Age Town Center's tents with grass between them.
const camp = frame(['..#...#..', '.........', '#.......#']);

test('sprite_check: a drawn pixel is 2, a gap inside the row span 1, outside the span or on an empty row 0', () => {
  expect(spriteCheck(camp, 2, 0)).toBe(2);
  expect(spriteCheck(camp, 4, 0)).toBe(1);
  // The span ends one past the last drawn pixel (`check_x <= width - right_pad`).
  expect(spriteCheck(camp, 7, 0)).toBe(1);
  expect(spriteCheck(camp, 8, 0)).toBe(0);
  expect(spriteCheck(camp, 1, 0)).toBe(0);
  expect(spriteCheck(camp, 4, 1)).toBe(0);
  expect(spriteCheck(camp, 4, 2)).toBe(1);
});

test('pick_objects confidence: pixel, row span, frame box, 15 px round the box, then nothing', () => {
  expect(partConfidence(camp, 9, 3, 2.5, 0.5)).toBe(PIXEL);
  expect(partConfidence(camp, 9, 3, 4.5, 0.5)).toBe(ROW_SPAN);
  expect(partConfidence(camp, 9, 3, 4.5, 1.5)).toBe(FRAME_BOX);
  expect(partConfidence(camp, 9, 3, -15, 1)).toBe(IN_RANGE);
  expect(partConfidence(camp, 9, 3, 9 + 14.5, 1)).toBe(IN_RANGE);
  expect(partConfidence(camp, 9, 3, -16, 1)).toBe(0);
  expect(partConfidence(camp, 9, 3, 9 + 15, 1)).toBe(0);
});

test('pick_weight: a building only on its drawn span, a unit also in its box and range; towers weigh as buildings', () => {
  // Town Center (select_level 3), Villager (4), a tree (2), the Watch Tower (79, select_level 4 in the dat).
  expect([PIXEL, ROW_SPAN, FRAME_BOX, IN_RANGE].map((c) => pickWeight(3, 109, false, c))).toEqual([3, 3, 0, 0]);
  expect(pickWeight(3, 109, true, FRAME_BOX)).toBe(2);
  expect([PIXEL, ROW_SPAN, FRAME_BOX, IN_RANGE].map((c) => pickWeight(4, 83, false, c))).toEqual([4, 4, 3, 2]);
  expect([PIXEL, ROW_SPAN, FRAME_BOX, IN_RANGE].map((c) => pickWeight(2, 141, false, c))).toEqual([3, 3, 2, 0]);
  expect(pickWeight(4, 79, false, FRAME_BOX)).toBe(0);
});

test('get_point truncates each term: the Villager diamond (radii 0.2) spans x -12..12, y -7..6', () => {
  // Radii as the dat's float32 values; an object on a whole pixel.
  const r = Math.fround(0.2);
  const o = { x: 100, y: 50 };
  const corners = [outlinePoint(o, r, -r, 0), outlinePoint(o, r, r, 0), outlinePoint(o, -r, r, 0), outlinePoint(o, -r, -r, 0)];
  expect(corners.map((c) => [c.x - 100, c.y - 50])).toEqual([
    [0, -7],
    [12, 0],
    [0, 6],
    [-12, 0],
  ]);
  // A fraction of a pixel in the object's position is dropped, as `screen_x_offset` is a short.
  expect(outlinePoint({ x: 100.9, y: 50.9 }, r, r, 0)).toEqual({
    x: 112,
    y: 50,
  });
});
