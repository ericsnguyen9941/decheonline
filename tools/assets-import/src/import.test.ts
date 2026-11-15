import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { importAssets } from './import';
import { slpImagePath, slpKey, soundPath, type PackManifest } from './manifest';
import { SYNTHETIC, WHOLE_TILE, writeSyntheticInstall } from './synthetic';

let root: string;
let install: string;
let pack: string;
let manifest: PackManifest;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'aoe-import-'));
  install = join(root, 'install');
  pack = join(root, 'pack');
  await writeSyntheticInstall(install);
  manifest = (await importAssets({ installDir: install, outDir: pack })).manifest;
});
afterAll(() => rm(root, { recursive: true, force: true }));

test('maps graphics, terrains and units by their dat ids', () => {
  const key = slpKey('graphics', SYNTHETIC.graphicSlp);
  expect(manifest.graphics[SYNTHETIC.standingGraphic]).toMatchObject({ slp: key, frameCount: 10, angleCount: 2 });
  expect(manifest.graphics[SYNTHETIC.missingGraphic]?.slp).toBeNull();
  expect(manifest.terrains[0]?.slp).toBe(slpKey('terrain', 15000));
  expect(manifest.terrains[0]).toMatchObject({ rows: 1, cols: 2 });
  expect(manifest.terrains[1]).toMatchObject({ rows: 1, cols: 1 });
  expect(manifest.units[SYNTHETIC.unitId]?.standingGraphic).toBe(SYNTHETIC.standingGraphic);
});

test('imports interface slps, a data2 Interfac.drs overriding the base one, and the unit icon, hit points, button and outline', () => {
  expect(manifest.slps[slpKey('interface', SYNTHETIC.interfaceSlp)]?.frames).toHaveLength(2);
  expect(manifest.slps[slpKey('interface', SYNTHETIC.overriddenInterfaceSlp)]?.frames).toHaveLength(1);
  const unit = manifest.units[SYNTHETIC.unitId]!;
  expect(unit).toMatchObject({ hitPoints: expect.any(Number), icon: expect.any(Number), button: expect.any(Number) });
  expect(unit.outline).toHaveLength(3);
  expect(unit).toMatchObject({ nameId: expect.any(Number), creationId: expect.any(Number), hotkeyId: expect.any(Number), level: expect.any(Number) });
  expect(unit.displayed).toHaveLength(4);
});

test("imports a screen's info file with its colours through the screen's own palette", () => {
  const { id, background } = SYNTHETIC.screen;
  expect(manifest.screens[id]).toEqual({
    backgrounds: [background, -1, -1],
    position: 0,
    shade: 54,
    background: 0xffffff,
    bevels: [0x9b9b9b, 0x9a9a9a, 0x999999, 0x989898, 0x979797, 0x969696],
    text: [0xd9d0b0, 0],
    focus: [0xcacf01, 0],
    state: [0xd9d0b0, 0],
  });
  expect(manifest.slps[slpKey('interface', background)]?.frames).toHaveLength(1);
  expect(Object.keys(manifest.screens)).toEqual([String(id)]);
});

test("imports map.bmp's lines, the tile edges, the minimap colours and each unit's minimap and doppelganger fields", () => {
  const shape = manifest.minimap!;
  expect(shape).toMatchObject({ width: 220, height: 114, startY: 1 });
  expect(shape.lines).toHaveLength(113);
  // The widest line is the middle row; each line is centred.
  expect(shape.lines[56]).toEqual([0, 220]);
  for (const [x, len] of shape.lines) expect(x * 2 + len).toBe(220);
  const edges = manifest.tileEdges!;
  expect(edges.normal).toHaveLength(47);
  expect(edges.normal[0]).toEqual(WHOLE_TILE);
  expect(edges.fog[3]).toEqual([]);
  expect(edges.black[1]).toEqual([SYNTHETIC.blackSpan]);
  expect(edges.black[0]).toEqual([]);
  expect(manifest.playerColours).toEqual([0, 16]);
  expect(manifest.terrains[0]?.minimap).toHaveLength(3);
  expect(manifest.units[SYNTHETIC.unitId]).toMatchObject({ minimap: [1, 0], doppelganger: expect.any(Number) });
});

test("imports the Villager's hotkey string id and the hotkey strings", () => {
  expect(manifest.units[SYNTHETIC.villager]).toMatchObject({ hotkeyId: SYNTHETIC.villagerHotkeyId });
  expect(manifest.strings[SYNTHETIC.villagerHotkeyId]).toBe('C');
  expect(manifest.slps[slpKey('interface', SYNTHETIC.groupNumberSlp)]?.frames).toHaveLength(11);
});

test("imports each tech's name and research button ids, icon and button location", () => {
  expect(manifest.techs[0]).toEqual({ name: 'Tool Age', nameId: 7000, creationId: 8000, icon: 1, button: 1 });
  expect(Object.keys(manifest.techs)).toHaveLength(2);
});

test("imports language.dll's strings with languagex.dll's over them", () => {
  const [id, text] = SYNTHETIC.overriddenString;
  expect(manifest.strings).toEqual({ ...SYNTHETIC.strings, [id]: text });
});

test('stores frame rectangles, hotspots and one image per player owner', async () => {
  const slp = manifest.slps[slpKey('graphics', SYNTHETIC.graphicSlp)]!;
  expect(slp.playerColour).toBe(true);
  expect(slp.frames).toHaveLength(2);
  expect(slp.frames[0]).toMatchObject({ w: 8, h: 8, hotspotX: 4, hotspotY: 7 });
  const images = (await readdir(join(pack, 'sprites', 'graphics'))).sort();
  expect(images).toEqual(Array.from({ length: 8 }, (_, i) => `${slp.id}.o${i + 1}.png`));
});

test('terrain slps with no player colour get a single shared image', async () => {
  const slp = manifest.slps[slpKey('terrain', 15000)]!;
  expect(slp.playerColour).toBe(false);
  expect((await stat(join(pack, slpImagePath(slp)))).size).toBeGreaterThan(0);
});

test('writes valid PNGs, the palette and the dat copy', async () => {
  const slp = manifest.slps[slpKey('graphics', SYNTHETIC.graphicSlp)]!;
  const png = await readFile(join(pack, slpImagePath(slp, 2)));
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(png.readUInt32BE(16)).toBe(slp.atlasWidth);
  expect(png.readUInt32BE(20)).toBe(slp.atlasHeight);
  const palette = JSON.parse(await readFile(join(pack, 'palette.json'), 'utf8')) as { rgb: number[] };
  expect(palette.rgb).toHaveLength(768);
  expect((await stat(join(pack, 'empires.dat'))).size).toBeGreaterThan(0);
});

test('names a missing required file and leaves an existing pack alone', async () => {
  const broken = join(root, 'broken');
  await writeSyntheticInstall(broken);
  await rm(join(broken, 'data', 'Terrain.drs'));
  await expect(importAssets({ installDir: broken, outDir: pack })).rejects.toThrow('data/Terrain.drs not found');
  expect((await stat(join(pack, 'manifest.json'))).size).toBeGreaterThan(0);
});

test("imports sounds.drs's wavs (data2 overriding data) and interfac.drs's, the dat's sounds and each unit's and graphic's sound ids", async () => {
  const ids = [...new Set([...SYNTHETIC.wavs.data, ...SYNTHETIC.wavs.data2, ...SYNTHETIC.wavs.interface])].sort((a, b) => a - b);
  expect(manifest.wavs).toEqual(ids);
  for (const id of ids) expect((await readFile(join(pack, soundPath(id)))).subarray(0, 4).toString()).toBe('RIFF');
  expect((await stat(join(pack, soundPath(SYNTHETIC.overriddenWav)))).size).toBe(44 + 128);
  expect(manifest.sounds[0]).toEqual({ items: [[5000, 100]] });
  expect(manifest.unitSounds[SYNTHETIC.unitId]).toHaveLength(6);
  // Graphic 0 has a frame sound per facet (frame i, sound 0); graphic 2 none.
  expect(manifest.graphics[SYNTHETIC.standingGraphic]).toMatchObject({ sound: -1, frameSounds: [[[0, 0]], [[1, 0]]] });
  expect(manifest.graphics[SYNTHETIC.missingGraphic]?.frameSounds).toBeNull();
});
