/** 256 colours as packed RGB triples (768 bytes). */
export type Palette = Uint8Array;

const PALETTE_COLOURS = 256;

/** Parses a JASC-PAL text palette, the form AoE1 stores palettes in (`bina` resources in interfac.drs). */
export function parseJascPalette(input: string | Uint8Array): Palette {
  const text = typeof input === 'string' ? input : new TextDecoder('latin1').decode(input);
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  if (lines[0] !== 'JASC-PAL') throw new Error('palette: missing JASC-PAL header');
  const count = Number(lines[2]);
  if (count !== PALETTE_COLOURS) throw new Error(`palette: expected 256 colours, got ${lines[2]}`);
  const out = new Uint8Array(PALETTE_COLOURS * 3);
  for (let i = 0; i < PALETTE_COLOURS; i++) {
    const parts = (lines[3 + i] ?? '').split(/\s+/).map(Number);
    if (parts.length !== 3 || parts.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) {
      throw new Error(`palette: bad colour on line ${4 + i}`);
    }
    out.set(parts, i * 3);
  }
  return out;
}

/** Accepts either a JASC-PAL text resource or 768 raw RGB bytes. */
export function parsePalette(bytes: Uint8Array): Palette {
  if (bytes.length === PALETTE_COLOURS * 3) return bytes.slice();
  return parseJascPalette(bytes);
}
