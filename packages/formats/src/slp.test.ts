import { describe, expect, test } from 'vitest';
import { buildSlp, syntheticPalette } from './fixtures';
import { parseSlp, SlpPixelKind as K, slpFrameToRgba } from './slp';

const N = K.Normal;
const P = K.PlayerColour;
const S = K.Shadow;
const T = K.Transparent;

const slp = parseSlp(
  buildSlp([
    {
      width: 8,
      hotspotX: 3,
      hotspotY: -2,
      rows: [
        // colour list (2), skip 1, player colour list (2), shadow (1)
        { left: 0, right: 2, commands: [0x08, 10, 11, 0x05, 0x26, 3, 4, 0x1b, 0x0f] },
        { left: 0, right: 0 },
        // fill (3), player-colour fill (2), big colour list (1)
        { left: 1, right: 1, commands: [0x37, 200, 0x2a, 5, 0x02, 1, 77, 0x0f] },
        // counts held in the next byte: colour list (3), big skip (2), player list (2), fill (1)
        { left: 0, right: 0, commands: [0x00, 3, 21, 22, 23, 0x03, 2, 0x06, 2, 1, 2, 0x07, 1, 9, 0x0f] },
      ],
    },
    { width: 1, rows: [{ left: 0, right: 0, commands: [0x04, 5, 0x0f] }] },
  ]),
);

describe('parseSlp', () => {
  test('reads header and frame geometry', () => {
    expect(slp.version).toBe('2.0N');
    expect(slp.comment).toBe('synthetic');
    expect(slp.frameCount).toBe(2);
    const f = slp.decodeFrame(0);
    expect([f.width, f.height, f.hotspotX, f.hotspotY]).toEqual([8, 4, 3, -2]);
  });

  test('decodes every command into indices and kinds', () => {
    const f = slp.decodeFrame(0);
    expect([...f.kinds.subarray(0, 8)]).toEqual([N, N, T, P, P, S, T, T]);
    expect([...f.indices.subarray(0, 8)]).toEqual([10, 11, 0, 3, 4, 0, 0, 0]);
    expect([...f.kinds.subarray(8, 16)]).toEqual([T, T, T, T, T, T, T, T]);
    expect([...f.kinds.subarray(16, 24)]).toEqual([T, N, N, N, P, P, N, T]);
    expect([...f.indices.subarray(16, 24)]).toEqual([0, 200, 200, 200, 5, 5, 77, 0]);
    expect([...f.kinds.subarray(24, 32)]).toEqual([N, N, N, T, T, P, P, N]);
    expect([...f.indices.subarray(24, 32)]).toEqual([21, 22, 23, 0, 0, 1, 2, 9]);
  });

  test('decodes a frame whose count sits in the command byte', () => {
    const f = slp.decodeFrame(1);
    expect([f.width, f.height]).toEqual([1, 1]);
    expect([...f.indices]).toEqual([5]);
  });

  test('rejects bad input', () => {
    expect(() => slp.decodeFrame(2)).toThrow(RangeError);
    expect(() => parseSlp(new Uint8Array(8))).toThrow(/shorter/);
    const wrong = buildSlp([{ width: 1, rows: [] }]);
    wrong[0] = 0x33;
    expect(() => parseSlp(wrong)).toThrow(/unsupported version/);
  });

  test('rejects rows that do not fill their span, overrun it, or use unknown commands', () => {
    const short = parseSlp(buildSlp([{ width: 4, rows: [{ left: 0, right: 0, commands: [0x04, 1, 0x0f] }] }]));
    expect(() => short.decodeFrame(0)).toThrow(/ends at 1, expected 4/);
    const over = parseSlp(buildSlp([{ width: 1, rows: [{ left: 0, right: 0, commands: [0x08, 1, 2, 0x0f] }] }]));
    expect(() => over.decodeFrame(0)).toThrow(/past its right margin/);
    const ext = parseSlp(buildSlp([{ width: 1, rows: [{ left: 0, right: 0, commands: [0x4e, 0x0f] }] }]));
    expect(() => ext.decodeFrame(0)).toThrow(/extended command/);
  });
});

describe('slpFrameToRgba', () => {
  const palette = syntheticPalette();
  const colour = (i: number): number[] => [i, 255 - i, i ^ 0x55, 255];

  test('maps normal pixels through the palette and leaves transparent pixels clear', () => {
    const rgba = slpFrameToRgba(slp.decodeFrame(0), palette);
    expect([...rgba.subarray(0, 4)]).toEqual(colour(10));
    expect([...rgba.subarray(8, 12)]).toEqual([0, 0, 0, 0]);
  });

  test('offsets player-colour pixels by owner * 16, and only those', () => {
    const f = slp.decodeFrame(0);
    const blue = slpFrameToRgba(f, palette); // owner 1
    const red = slpFrameToRgba(f, palette, { owner: 2 });
    expect([...blue.subarray(3 * 4, 3 * 4 + 4)]).toEqual(colour(3 + 16));
    expect([...red.subarray(3 * 4, 3 * 4 + 4)]).toEqual(colour(3 + 32));
    expect([...red.subarray(0, 4)]).toEqual([...blue.subarray(0, 4)]);
  });

  test('draws shadow pixels black with the requested alpha', () => {
    const f = slp.decodeFrame(0);
    expect([...slpFrameToRgba(f, palette).subarray(5 * 4, 5 * 4 + 4)]).toEqual([0, 0, 0, 96]);
    expect([...slpFrameToRgba(f, palette, { shadowAlpha: 40 }).subarray(5 * 4, 5 * 4 + 4)]).toEqual([0, 0, 0, 40]);
  });
});
