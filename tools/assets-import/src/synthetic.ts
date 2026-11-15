// A tiny fake install folder (DRS archives, palette, dat) for tests that must not need the
// Microsoft files. Everything here is invented, so it can live in git as code.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSyntheticDat, syntheticUnit, UnitType, writeDat } from '@aoe/data';
import { buildDrs, buildPe, buildSlp, syntheticPalette } from '@aoe/formats/fixtures';
import { buildBmp8, buildTileEdgeFile, EDGE_COUNT, MINIMAP_BMP_ID } from './map-art';
import type { TileSpan } from './manifest';

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
  /** The Villager's id in the real dat: the synthetic dat has a unit of it, with `hotKeyId` `villagerHotkeyId`. */
  villager: 83,
  villagerHotkeyId: 16132,
  /** `groupnum.shp` (the digits over a selected object of group 1-9): 11 frames of 4x4. */
  groupNumberSlp: 50403,
  /**
   * language.dll's strings; languagex.dll replaces `overriddenString`. 4151-4170 are the hotkeys (`STRING_ID_HOTKEY_*`,
   * the real letters), 16132 the Villager's, 9004/9005/3013 the end of the game's (`STRING_ID_VICTORY_MESSAGE` ...), 1217 a late turn's,
   * 3016/3026 the tribute and stance notifications, 9851/9856/9863 the Diplomacy dialog's title, fee and Market texts.
   */
  strings: {
    10231: 'Egyptian', 4119: 'Build', 5131: 'Man (old)', 4201: 'Stone Age', 4202: 'Tool Age',
    4151: 'B', 4152: 'S', 4153: 'G', 4154: 'U', 4155: 'X', 4157: 'D', 4158: 'T', 4159: 'H',
    4160: 'N', 4161: 'B', 4162: 'D', 4163: 'A', 4164: 'K', 4165: 'L', 4166: 'P', 4167: 'Y',
    4170: 'M', 4173: 'R', 16132: 'C', 3040: 'Click an area to move there.', 3052: 'Click the building or boat to repair.',
    9004: 'You are victorious!', 9005: 'You have been defeated!', 3013: '%s resigned.', 1217: 'Problem communicating with %s...',
    3016: '%s paid %d food in tribute to you.', 3026: '%s changed diplomatic stance with you to Ally.', 9851: 'Diplomacy',
    9856: 'Pay Tribute (cost %d%%)', 9863: 'You need a Market to pay tribute.',
    3028: 'All Artifacts have been captured. Hold them for 2000 years to win!',
    3029: 'All Artifacts have been captured. You will lose if they are held for 2000 years!', 3030: 'Control of the Artifacts was lost!',
    11302: 'Artifacts: %d Years',
  } as Record<number, string>,
  overriddenString: [5131, 'Villager'],
  /** map.bmp: a 220x114 diamond like the real one (the widest line is row 57). */
  minimap: { width: 220, height: 114 },
  /** Every edge draws the whole tile plain; edge 1 also leaves `blackSpan` black. */
  blackSpan: [16, 0, 3] as TileSpan,
  /** sounds.drs wavs: data's, data2's (which also replaces `overriddenWav`), and interfac.drs's button click, won and lost. */
  wavs: { data: [5000, 5001], data2: [5001, 5002], interface: [50301, 50320, 50321] },
  overriddenWav: 5001,
  /**
   * The won achievements screen's info file (`scr7`, bina 50057): background SLP 50131 at 640 wide, palette 50505 (index c
   * is grey 255 - c), bevel colours 100-105.
   */
  screen: { id: 50057, background: 50131, palette: 50505 },
} as const;

/** `scr7`'s info file, in the real one's form. */
function syntheticScreenInfo(): Uint8Array {
  const { background, palette } = SYNTHETIC.screen;
  return new TextEncoder().encode(
    [
      `background1_files     scr7a  none  ${background}  -1`,
      'background2_files     scr7b  none  -1  -1',
      'background3_files     scr7c  none  -1  -1',
      `palette_file          pal7  ${palette}`,
      'cursor_file           cursor7  51007',
      'shade_amount          percent  54',
      'button_file           btn7  50609',
      'popup_dialog_sin      dlg7  50010',
      'background_position   0',
      'background_color      0',
      'bevel_colors          100  101  102  103  104  105',
      'text_color1           217 208 176',
      'text_color2           0 0 0',
      'focus_color1          202  207  1',
      'focus_color2          0    0    0',
      'state_color1          217  208  176',
      'state_color2          0    0    0',
      '',
    ].join('\r\n'),
  );
}

/** A short 8-bit mono PCM wav at 11025 Hz: `samples` bytes of a square wave of period `period`. */
export function buildWav(samples = 64, period = 8): Uint8Array {
  const out = new Uint8Array(44 + samples);
  const view = new DataView(out.buffer);
  const text = (at: number, t: string) => [...t].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 11025, true);
  view.setUint32(28, 11025, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) out[44 + i] = (i % period) * 2 < period ? 0xa0 : 0x60;
  return out;
}

/** The whole flat tile: rows 0-32 of a 65x33 box, as TILEEDGE.DAT's edge 0 `normal_draw`. */
export const WHOLE_TILE: TileSpan[] = Array.from({ length: 33 }, (_, dy) => {
  const half = 2 * (16 - Math.abs(dy - 16));
  return [dy, 32 - half, 32 + half];
});

/** Interfac.drs bina 50401: palette index 0xFF inside a diamond, 0 elsewhere. */
function syntheticMapBmp(): Uint8Array {
  const { width, height } = SYNTHETIC.minimap;
  return buildBmp8(width, height, (x, y) => {
    const half = Math.round((width / 2) * (1 - Math.abs(y - 57) / 57));
    return y > 0 && Math.abs(x + 0.5 - width / 2) < half ? 0xff : 0;
  });
}

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
    { type: 'bina', id: MINIMAP_BMP_ID, data: syntheticMapBmp() },
    { type: 'bina', id: SYNTHETIC.screen.id, data: syntheticScreenInfo() },
    { type: 'bina', id: SYNTHETIC.screen.palette, data: Uint8Array.from({ length: 768 }, (_, i) => 255 - Math.floor(i / 3)) },
    { type: 'slp', id: SYNTHETIC.screen.background, data: buildSlp([{ width: 4, rows: four(0x47, SYNTHETIC.normalIndex) }]) },
    { type: 'slp', id: SYNTHETIC.interfaceSlp, data: buildSlp([{ width: 4, rows: four(0x47, SYNTHETIC.normalIndex) }, { width: 4, rows: four(0x47, SYNTHETIC.normalIndex) }]) },
    { type: 'slp', id: SYNTHETIC.overriddenInterfaceSlp, data: buildSlp([{ width: 4, rows: four(0x47, SYNTHETIC.normalIndex) }, { width: 4, rows: four(0x47, SYNTHETIC.normalIndex) }]) },
    { type: 'slp', id: SYNTHETIC.groupNumberSlp, data: buildSlp(Array.from({ length: 11 }, () => ({ width: 4, rows: four(0x47, SYNTHETIC.normalIndex) }))) },
    ...SYNTHETIC.wavs.interface.map((id) => ({ type: 'wav', id, data: buildWav() })),
  ]);
  // data2's copy of the overridden wav is longer, so the pack shows which one it kept.
  const sounds = buildDrs(SYNTHETIC.wavs.data.map((id) => ({ type: 'wav', id, data: buildWav() })));
  const sounds2 = buildDrs(SYNTHETIC.wavs.data2.map((id) => ({ type: 'wav', id, data: buildWav(id === SYNTHETIC.overriddenWav ? 128 : 64) })));
  const interfac2 = buildDrs([{ type: 'slp', id: SYNTHETIC.overriddenInterfaceSlp, data: buildSlp([{ width: 4, rows: four(0x47, SYNTHETIC.normalIndex) }]) }]);

  await mkdir(join(dir, 'data'), { recursive: true });
  await mkdir(join(dir, 'data2'), { recursive: true });
  await writeFile(join(dir, 'data', 'graphics.drs'), graphics);
  await writeFile(join(dir, 'data', 'Terrain.drs'), terrain);
  await writeFile(join(dir, 'data', 'Interfac.drs'), interfac);
  await writeFile(join(dir, 'data2', 'Interfac.drs'), interfac2);
  await writeFile(join(dir, 'data', 'sounds.drs'), sounds);
  await writeFile(join(dir, 'data2', 'sounds.drs'), sounds2);
  const none = Array.from({ length: EDGE_COUNT }, (): TileSpan[] => []);
  await writeFile(join(dir, 'data2', 'TileEdge.Dat'), buildTileEdgeFile([none.map(() => WHOLE_TILE), none]));
  await writeFile(join(dir, 'data2', 'BlkEdge.Dat'), buildTileEdgeFile([none.map((_, e) => (e === 1 ? [SYNTHETIC.blackSpan] : []))]));
  await writeFile(join(dir, 'language.dll'), buildPe(SYNTHETIC.strings));
  await writeFile(join(dir, 'languagex.dll'), buildPe({ [SYNTHETIC.overriddenString[0]]: SYNTHETIC.overriddenString[1] }));
  const dat = buildSyntheticDat();
  dat.terrainBlock.terrains[0]!.terrainDimensions = [1, 2];
  // Terrain 1 names itself as terrain_to_draw (the e2e's water looks the same), and terrain 0 draws border 3 against
  // it (not loaded: there is no Border.drs).
  dat.terrainBlock.terrains[1]!.terrainToDraw = 1;
  dat.terrainBlock.terrains[0]!.borders[1] = 3;
  dat.terrainBlock.borders[3]!.borderStyle = 1;
  for (const civ of dat.civs) {
    // The trailing null stays last; the Villager sits at its real id.
    const villager = Object.assign(syntheticUnit(UnitType.Creatable, SYNTHETIC.villager, 'Man'), {
      // The rest is what the client assumes for a Villager without a record, so the pack changes nothing but its hotkey.
      hotKeyId: SYNTHETIC.villagerHotkeyId,
      iconId: -1,
      interactionMode: 4,
      interfaceKind: 3,
      minimapMode: 2,
      outlineSize: [Math.fround(0.2), Math.fround(0.2), Math.fround(1.7)],
    });
    civ.units = [...Array.from({ length: SYNTHETIC.villager }, (_, i) => civ.units[i] ?? null), villager, null];
    civ.unitPointers = civ.units.map((u, i) => (u ? 0x1000 + i : 0));
  }
  await writeFile(join(dir, 'data2', 'empires.dat'), writeDat(dat));
}
