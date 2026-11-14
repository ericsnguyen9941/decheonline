/**
 * Number helpers (docs/spec/core.md §3). The original keeps positions, hit points, rates and game speed
 * in C `float`, clocks and counters in 32-bit integers. Port rule: round to float32 with `f32` at every
 * store to a float field and after each `+ - * /` and square root; these are correctly rounded under
 * IEEE 754, so every JS engine gives the same bits. Transcendental `Math.*` is banned in the sim (lint).
 */

export const f32 = Math.fround;

export function add32(a: number, b: number): number {
  return Math.fround(Math.fround(a) + Math.fround(b));
}

export function sub32(a: number, b: number): number {
  return Math.fround(Math.fround(a) - Math.fround(b));
}

export function mul32(a: number, b: number): number {
  return Math.fround(Math.fround(a) * Math.fround(b));
}

export function div32(a: number, b: number): number {
  return Math.fround(Math.fround(a) / Math.fround(b));
}

export function sqrt32(a: number): number {
  return Math.fround(Math.sqrt(Math.fround(a)));
}

/** C cast float -> int: truncate toward zero, wrap to signed 32 bits. */
export function toInt(a: number): number {
  return Math.trunc(a) | 0;
}

/** C cast float -> unsigned int: truncate toward zero, wrap to unsigned 32 bits. */
export function toUint(a: number): number {
  return Math.trunc(a) >>> 0;
}

/** C narrowing of an int to `short`: wrap to signed 16 bits. */
export function i16(a: number): number {
  return (a << 16) >> 16;
}

/** C narrowing of an int to `unsigned char`: wrap to 8 bits. */
export function u8(a: number): number {
  return a & 0xff;
}

export function u32(a: number): number {
  return a >>> 0;
}

/** `delta * 0.001f` (src/world.cpp:1272): milliseconds to float seconds. */
export const MS_TO_SECONDS = Math.fround(0.001);
