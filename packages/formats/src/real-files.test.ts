import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { DrsArchive } from './drs';
import { parsePalette } from './palette';
import { parseSlp, SlpPixelKind, slpFrameToRgba } from './slp';

// Local-only: needs an AoE1 install (AOE1_DIR); skipped in CI. Never commit what it reads.
const dir = process.env.AOE1_DIR;

function readDrs(name: string): DrsArchive {
  const data = join(dir as string, 'data');
  const file = readdirSync(data).find((f) => f.toLowerCase() === name.toLowerCase());
  if (!file) throw new Error(`${name} not found in ${data}`);
  return DrsArchive.parse(readFileSync(join(data, file)));
}

describe.skipIf(!dir)('real game files (AOE1_DIR)', () => {
  test('opens graphics.drs and decodes one SLP with the interface palette', () => {
    const graphics = readDrs('graphics.drs');
    const palette = parsePalette(readDrs('interfac.drs').read('bina', 50500) as Uint8Array);
    const slps = graphics.list('slp');
    expect(slps.length).toBeGreaterThan(100);

    const entry = slps[0] as (typeof slps)[number];
    const file = parseSlp(graphics.read('slp', entry.id) as Uint8Array);
    const frame = file.decodeFrame(0);
    const rgba = slpFrameToRgba(frame, palette, { owner: 2 });
    const opaque = frame.kinds.filter((k) => k !== SlpPixelKind.Transparent).length;
    console.log(
      `graphics.drs: ${slps.length} slp; slp ${entry.id}: ${file.frameCount} frames; ` +
        `frame 0 ${frame.width}x${frame.height} hotspot ${frame.hotspotX},${frame.hotspotY}, ${opaque} drawn pixels`,
    );
    expect(file.frameCount).toBeGreaterThan(0);
    expect(rgba.length).toBe(frame.width * frame.height * 4);
    expect(opaque).toBeGreaterThan(0);
  });

  test('every slp in every drs decodes with consistent rows', () => {
    let slps = 0;
    let frames = 0;
    for (const name of ['graphics.drs', 'interfac.drs', 'terrain.drs', 'border.drs']) {
      const drs = readDrs(name);
      for (const entry of drs.list('slp')) {
        const file = parseSlp(drs.read('slp', entry.id) as Uint8Array);
        for (let i = 0; i < file.frameCount; i++) file.decodeFrame(i);
        slps++;
        frames += file.frameCount;
      }
    }
    console.log(`decoded ${slps} slp files, ${frames} frames`);
    expect(slps).toBeGreaterThan(0);
  });
});
