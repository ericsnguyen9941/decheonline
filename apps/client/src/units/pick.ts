/**
 * Picking objects under the pointer as the original does (`RGE_View::pick_objects`, src/view.cpp:3125): every drawn part
 * of draw level 10 to 20 near the point gets a confidence, and `pick_weight` turns an object's best confidence into a
 * weight; the heaviest object wins.
 */

/** `pick_objects(x, y, 10, 20, 15, 4, 1)`: the draw levels searched and how far outside a part's box still counts. */
export const PICK_MIN_LEVEL = 10;
export const PICK_MAX_LEVEL = 20;
export const PICK_RANGE = 15;

/** Confidences, best first: an opaque pixel, inside the row's drawn span, inside the frame box, within range of it. */
export const PIXEL = 1;
export const ROW_SPAN = 2;
export const FRAME_BOX = 3;
export const IN_RANGE = 4;

/** The dat's tower masters, which `TRIBE_Main_View::pick_weight` weighs as buildings (`select_level` 3). */
const TOWERS = new Set([69, 79, 199, 278]);

/** Alpha above which a texture pixel counts as drawn. */
export const DRAWN_ALPHA = 8;

/** RGBA pixels of a frame, rows `stride` pixels apart, `width` x `height` of them used. */
export interface FramePixels {
  pixels: Uint8ClampedArray;
  stride: number;
  width: number;
  height: number;
}

/**
 * `RGE_View::sprite_check` (src/view.cpp:3306) at frame pixel (x, y): 2 on a drawn pixel, 1 inside the row's outline
 * span (from its first drawn pixel to one past its last, see-through gaps included), 0 elsewhere.
 */
export function spriteCheck(f: FramePixels, x: number, y: number): 0 | 1 | 2 {
  if (x < 0 || y < 0 || x >= f.width || y >= f.height) return 0;
  const drawn = (c: number) => f.pixels[(y * f.stride + c) * 4 + 3]! > DRAWN_ALPHA;
  let left = 0;
  while (left < f.width && !drawn(left)) left++;
  // An empty row's outline is -32768: nothing on it picks.
  if (left === f.width) return 0;
  let right = f.width - 1;
  while (!drawn(right)) right--;
  if (x < left || x > right + 1) return 0;
  return drawn(x) ? 2 : 1;
}

/**
 * Confidence of point (x, y), in a part's frame pixels, for a part `width` x `height`: `pick_objects` gives 4 within
 * `PICK_RANGE` of the frame box, 3 inside it, 2 inside the row's span and 1 on a drawn pixel; 0 for none.
 */
export function partConfidence(f: FramePixels | null, width: number, height: number, x: number, y: number): number {
  const px = Math.floor(x);
  const py = Math.floor(y);
  // The box is the frame's pixels (`x2 = x1 + width - 1`, src/view.cpp:4369); the dat's select boxes (`box_x1`, set on
  // a few fish and Tree13 only) are not used.
  if (px < -PICK_RANGE || py < -PICK_RANGE || px >= width + PICK_RANGE || py >= height + PICK_RANGE) return 0;
  if (px < 0 || py < 0 || px >= width || py >= height) return IN_RANGE;
  // Without its pixels a part counts as drawn wherever its box is.
  if (!f) return PIXEL;
  const check = spriteCheck(f, px, py);
  return check === 2 ? PIXEL : check === 1 ? ROW_SPAN : FRAME_BOX;
}

/**
 * `TRIBE_Main_View::pick_weight` (src/tvw_main.cpp:601) of an object of `selectLevel` (towers count as 3) picked at
 * `confidence`; 0 means it is not picked. `unbuilt`: its `object_state` is below active (a foundation).
 */
export function pickWeight(selectLevel: number, master: number, unbuilt: boolean, confidence: number): number {
  const level = TOWERS.has(master) ? 3 : selectLevel;
  const close = confidence === PIXEL || confidence === ROW_SPAN;
  switch (level) {
    case 4:
      return close ? 4 : confidence === FRAME_BOX ? 3 : 2;
    case 3:
      return close ? 3 : confidence === FRAME_BOX && unbuilt ? 2 : 0;
    case 2:
      return close ? 3 : confidence === FRAME_BOX ? 2 : 0;
    default:
      return 1;
  }
}
