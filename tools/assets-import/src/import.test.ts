import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { importAssets } from './import';
import { slpImagePath, slpKey, type PackManifest } from './manifest';
import { SYNTHETIC, writeSyntheticInstall } from './synthetic';

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
  expect(unit).toMatchObject({ nameId: expect.any(Number), creationId: expect.any(Number), level: expect.any(Number) });
  expect(unit.displayed).toHaveLength(4);
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
