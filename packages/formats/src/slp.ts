import type { Palette } from './palette';

/** What a decoded pixel is; `SlpPixelKind.Transparent` pixels carry no palette index. */
export const SlpPixelKind = {
  Transparent: 0,
  Normal: 1,
  /** Palette index is relative to the owner's colour block (0-9 in the shipped files); see `slpFrameToRgba`. */
  PlayerColour: 2,
  /** Darkens whatever is behind it; carries no index. */
  Shadow: 3,
} as const;
export type SlpPixelKind = (typeof SlpPixelKind)[keyof typeof SlpPixelKind];

export interface SlpFrame {
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
  /** Palette index per pixel, 0 where the kind has none. */
  indices: Uint8Array;
  kinds: Uint8Array;
}

export interface SlpFile {
  version: string;
  comment: string;
  frameCount: number;
  decodeFrame(index: number): SlpFrame;
}

const HEADER_SIZE = 32;
const FRAME_INFO_SIZE = 32;
const EMPTY_ROW = 0x8000;

export function parseSlp(bytes: Uint8Array): SlpFile {
  if (bytes.length < HEADER_SIZE) throw new Error('SLP: file shorter than its header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = String.fromCharCode(...bytes.subarray(0, 4));
  if (version !== '2.0N') throw new Error(`SLP: unsupported version ${JSON.stringify(version)}`);
  const frameCount = view.getUint32(4, true);
  if (HEADER_SIZE + frameCount * FRAME_INFO_SIZE > bytes.length) {
    throw new Error('SLP: frame table runs past end of file');
  }
  let comment = '';
  for (let i = 8; i < HEADER_SIZE && bytes[i] !== 0; i++) comment += String.fromCharCode(bytes[i] ?? 0);

  return {
    version,
    comment,
    frameCount,
    decodeFrame(index) {
      if (!Number.isInteger(index) || index < 0 || index >= frameCount) {
        throw new RangeError(`SLP: no frame ${index}`);
      }
      return decodeFrame(bytes, view, HEADER_SIZE + index * FRAME_INFO_SIZE);
    },
  };
}

function decodeFrame(bytes: Uint8Array, view: DataView, at: number): SlpFrame {
  const cmdTable = view.getUint32(at, true);
  const outlineTable = view.getUint32(at + 4, true);
  const width = view.getInt32(at + 16, true);
  const height = view.getInt32(at + 20, true);
  const hotspotX = view.getInt32(at + 24, true);
  const hotspotY = view.getInt32(at + 28, true);
  if (width < 0 || height < 0 || width > 0x4000 || height > 0x4000) throw new Error('SLP: bad frame size');
  if (outlineTable + height * 4 > bytes.length || cmdTable + height * 4 > bytes.length) {
    throw new Error('SLP: frame tables run past end of file');
  }

  const indices = new Uint8Array(width * height);
  const kinds = new Uint8Array(width * height);
  let p = 0;
  const next = (): number => {
    if (p >= bytes.length) throw new Error('SLP: command data runs past end of file');
    return bytes[p++] as number;
  };

  for (let y = 0; y < height; y++) {
    const left = view.getUint16(outlineTable + y * 4, true);
    const right = view.getUint16(outlineTable + y * 4 + 2, true);
    if (left === EMPTY_ROW || right === EMPTY_ROW) continue;
    const rowEnd = width - right;
    if (left > rowEnd) throw new Error(`SLP: row ${y} margins exceed width`);
    p = view.getUint32(cmdTable + y * 4, true);
    let x = left;
    const row = y * width;

    const put = (count: number, kind: SlpPixelKind, read: () => number): void => {
      if (x + count > rowEnd) throw new Error(`SLP: row ${y} draws past its right margin`);
      for (let i = 0; i < count; i++) {
        indices[row + x] = read();
        kinds[row + x] = kind;
        x++;
      }
    };

    for (let done = false; !done; ) {
      const cmd = next();
      switch (cmd & 0x0f) {
        case 0x0:
        case 0x4:
        case 0x8:
        case 0xc:
          put(cmd >> 2 || next(), SlpPixelKind.Normal, next);
          break;
        case 0x1:
        case 0x5:
        case 0x9:
        case 0xd:
          x += cmd >> 2 || next();
          break;
        case 0x2:
          put(((cmd & 0xf0) << 4) | next(), SlpPixelKind.Normal, next);
          break;
        case 0x3:
          x += ((cmd & 0xf0) << 4) | next();
          break;
        case 0x6:
          put(cmd >> 4 || next(), SlpPixelKind.PlayerColour, next);
          break;
        case 0x7: {
          const count = cmd >> 4 || next();
          const colour = next();
          put(count, SlpPixelKind.Normal, () => colour);
          break;
        }
        case 0xa: {
          const count = cmd >> 4 || next();
          const colour = next();
          put(count, SlpPixelKind.PlayerColour, () => colour);
          break;
        }
        case 0xb:
          put(cmd >> 4 || next(), SlpPixelKind.Shadow, () => 0);
          break;
        case 0xe:
          throw new Error(`SLP: unsupported extended command 0x${cmd.toString(16)}`);
        case 0xf:
          done = true;
          break;
      }
    }
    if (x !== rowEnd) throw new Error(`SLP: row ${y} ends at ${x}, expected ${rowEnd}`);
  }
  return { width, height, hotspotX, hotspotY, indices, kinds };
}

export interface RgbaOptions {
  /**
   * Owner 0-8 (0 = gaia, 1 = blue, 2 = red, ...): player-colour pixels use palette index
   * `value + owner * 16`, the ramp layout of palette 50500. The game itself remaps through the
   * dat's colour tables; this is the same result for the shipped palette.
   */
  owner?: number;
  /** Alpha (0-255) of shadow pixels, drawn black. Default 96. */
  shadowAlpha?: number;
}

export function slpFrameToRgba(frame: SlpFrame, palette: Palette, options: RgbaOptions = {}): Uint8Array {
  const owner = options.owner ?? 1;
  const shadowAlpha = options.shadowAlpha ?? 96;
  const out = new Uint8Array(frame.width * frame.height * 4);
  for (let i = 0; i < frame.kinds.length; i++) {
    const kind = frame.kinds[i];
    if (kind === SlpPixelKind.Transparent) continue;
    if (kind === SlpPixelKind.Shadow) {
      out[i * 4 + 3] = shadowAlpha;
      continue;
    }
    let colour = frame.indices[i] as number;
    if (kind === SlpPixelKind.PlayerColour) colour = (colour + owner * 16) & 0xff;
    out[i * 4] = palette[colour * 3] as number;
    out[i * 4 + 1] = palette[colour * 3 + 1] as number;
    out[i * 4 + 2] = palette[colour * 3 + 2] as number;
    out[i * 4 + 3] = 255;
  }
  return out;
}
