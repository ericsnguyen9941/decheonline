// A tiny fake install folder (DRS archives, palette, dat) for tests that must not need the
// Microsoft files. Everything here is invented, so it can live in git as code.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSyntheticDat, writeDat } from '@aoe/data';
import { buildDrs, buildPe, buildSlp, syntheticPalette } from '@aoe/formats/fixtures';

/** What the synthetic install contains, for assertions on the imported pack. */
export const SYNTHETIC = {
  /** Unit with a stand graphic in the synthetic dat (the real game's villager is unit 83). */
  unitId: 4,
  standingGraphic: 0,
  /** Graphic 0: 2 frames of 8x8, left half palette index 100, right half player colour value 2. */
  graphicSlp: 1000,
  frameSize: 8,
  hotspot: [4, 7],
  normalIndex: 100,
  playerValue: 2,
  /** Graphic 2 has no SLP in the install. */
  missingGraphic: 2,
  /** Terrain 0 and 1: 2 diamond frames of 64x32 (the real tile size), one palette index each. Terrain 0 is a 1x2 variant grid. */
  terrains: [
    { slp: 15000, index: 60 },
    { slp: 15001, index: 90 },
  ],
  terrainFrame: [64, 32],
  /** An interface SLP (the real one with this id is btnunit): 2 frames of 4x4 in the shared palette index 100. */
  interfaceSlp: 50730,
  /** Overridden by data2/Interfac.drs with a single frame. */
  overriddenInterfaceSlp: 50741,
  /** language.dll's strings; languagex.dll replaces `overriddenString`. */
  strings: { 10231: 'Egyptian', 4119: 'Build', 5131: 'Man (old)', 4201: 'Stone Age', 4202: 'Tool Age' },
  overriddenString: [5131, 'Villager'],
} as const;

const fillRow = (...commands: number[]) => ({ left: 0, right: 0, commands: [...commands, 0x0f] });

export async function writeSyntheticInstall(dir: string): Promise<void> {
  const eight = (...commands: number[]) => Array.from({ length: 8 }, () => fillRow(...commands));
  const graphics = buildDrs([
    {
      type: 'slp',
      id: SYNTHETIC.graphicSlp,
      data: buildSlp([
        { width: 8, hotspotX: 4, hotspotY: 7, rows: eight(0x47, SYNTHETIC.normalIndex, 0x4a, SYNTHETIC.playerValue) },
        { width: 8, rows: eight(0x07, 8, 200) },
      ]),
    },
  ]);
  const [tileW, tileH] = SYNTHETIC.terrainFrame;
  const terrainRows = (index: number) =>
    Array.from({ length: tileH }, (_, y) => {
      const w = 4 * (y < tileH / 2 ? y + 1 : tileH - y);
      const edge = (tileW - w) / 2;
      return { left: edge, right: edge, commands: [0x07, w, index, 0x0f] };
    });
  const terrain = buildDrs(
    SYNTHETIC.terrains.map(({ slp, index }) => ({
      type: 'slp',
      id: slp,
      data: buildSlp([{ width: tileW, rows: terrainRows(index) }, { width: tileW, rows: terrainRows(index + 1) }]),
    })),
  );
  const four = (...commands: number[]) => Array.from({ length: 4 }, () => fillRow(...commands));
  const interfac = buildDrs([
    { type: 'bina', id: 50500, data: syntheticPalette() },
    { type: 'slp', id: SYNTHETIC.interfaceSlp, data: buildSlp([{ width: 4, rows: four(0x47, SYNTHETIC.normalIndex) }, { width: 4, rows: four(0x47, SYNTHETIC.normalIndex) }]) },
    { type: 'slp', id: SYNTHETIC.overriddenInterfaceSlp, data: buildSlp([{ width: 4, rows: four(0x47, SYNTHETIC.normalIndex) }, { width: 4, rows: four(0x47, SYNTHETIC.normalIndex) }]) },
  ]);
  const interfac2 = buildDrs([{ type: 'slp', id: SYNTHETIC.overriddenInterfaceSlp, data: buildSlp([{ width: 4, rows: four(0x47, SYNTHETIC.normalIndex) }]) }]);

  await mkdir(join(dir, 'data'), { recursive: true });
  await mkdir(join(dir, 'data2'), { recursive: true });
  await writeFile(join(dir, 'data', 'graphics.drs'), graphics);
  await writeFile(join(dir, 'data', 'Terrain.drs'), terrain);
  await writeFile(join(dir, 'data', 'Interfac.drs'), interfac);
  await writeFile(join(dir, 'data2', 'Interfac.drs'), interfac2);
  await writeFile(join(dir, 'language.dll'), buildPe(SYNTHETIC.strings));
  await writeFile(join(dir, 'languagex.dll'), buildPe({ [SYNTHETIC.overriddenString[0]]: SYNTHETIC.overriddenString[1] }));
  const dat = buildSyntheticDat();
  dat.terrainBlock.terrains[0]!.terrainDimensions = [1, 2];
  await writeFile(join(dir, 'data2', 'empires.dat'), writeDat(dat));
}
