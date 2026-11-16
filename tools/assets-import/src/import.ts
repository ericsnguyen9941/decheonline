import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDat, type DatFile } from '@aoe/data';
import { DrsArchive, mergeStrings, parsePalette, readPeStrings, parseSlp, slpFrameToRgba, SlpPixelKind, type Palette } from '@aoe/formats';
import { blit, packShelves } from './atlas';
import { MINIMAP_BMP_ID, parseMinimapShape, parseTileEdges } from './map-art';
import {
  PACK_VERSION,
  PLAYER_OWNERS,
  slpImagePath,
  slpKey,
  soundPath,
  tauntPath,
  type PackFrame,
  type PackManifest,
  type PackMinimap,
  type PackScreen,
  type PackSlp,
  type PackTileEdges,
  type SlpSource,
} from './manifest';
import { encodePng } from './png';
import { DECAL_SCREENS, packScreen, parseScreenInfo, SCREEN_IDS, type ScreenInfo } from './screens';

const PALETTE_ID = 50500;

export interface ImportOptions {
  /** AoE1 + Rise of Rome install folder; only read. */
  installDir: string;
  /** Pack folder; replaced entirely. */
  outDir: string;
  log?: (line: string) => void;
}

export interface ImportResult {
  manifest: PackManifest;
  slpCount: number;
  imageCount: number;
  wavCount: number;
}

/** Path lookup that ignores case, as on a Windows install; null when absent. */
async function find(root: string, rel: string): Promise<string | null> {
  let current = root;
  for (const part of rel.split('/')) {
    const names = await readdir(current).catch(() => [] as string[]);
    const hit = names.find((name) => name.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    current = join(current, hit);
  }
  return current;
}

async function require(root: string, rel: string): Promise<string> {
  const path = await find(root, rel);
  if (!path) throw new Error(`assets:import: ${rel} not found in ${root}`);
  return path;
}

async function openDrs(root: string, rel: string, required: boolean): Promise<DrsArchive | null> {
  const path = required ? await require(root, rel) : await find(root, rel);
  return path ? DrsArchive.parse(await readFile(path)) : null;
}

/** Reads the install and writes the pack. Throws on a missing required file, before touching outDir. */
export async function importAssets({ installDir, outDir, log = () => {} }: ImportOptions): Promise<ImportResult> {
  const datPath = await require(installDir, 'data2/empires.dat');
  const interfac = (await openDrs(installDir, 'data/Interfac.drs', true)) as DrsArchive;
  const sources: Record<SlpSource, DrsArchive[]> = {
    graphics: [
      (await openDrs(installDir, 'data/graphics.drs', true)) as DrsArchive,
      ...[await openDrs(installDir, 'data2/graphics.drs', false)].filter((d) => d !== null),
    ],
    terrain: [(await openDrs(installDir, 'data/Terrain.drs', true)) as DrsArchive],
    border: [...[await openDrs(installDir, 'data/Border.drs', false)].filter((d) => d !== null)],
    interface: [interfac, ...[await openDrs(installDir, 'data2/Interfac.drs', false)].filter((d) => d !== null)],
  };

  // The units' and sprites' wavs (sounds.drs, data2 overriding) and the game's own (interfac.drs); an install without
  // sounds.drs plays none.
  const wavSources = [
    ...[await openDrs(installDir, 'data/sounds.drs', false), await openDrs(installDir, 'data2/sounds.drs', false)].filter((d) => d !== null),
    ...sources.interface,
  ];

  const paletteBytes = interfac.read('bina', PALETTE_ID);
  if (!paletteBytes) throw new Error(`assets:import: palette ${PALETTE_ID} missing from Interfac.drs`);
  const palette = parsePalette(paletteBytes);
  const dat = parseDat(await readFile(datPath));
  // Rise of Rome's languagex.dll overrides language.dll; an install without them gets the dat's internal names.
  const languages = await Promise.all(['language.dll', 'languagex.dll'].map((name) => find(installDir, name)));
  const strings = mergeStrings(
    ...(await Promise.all(languages.filter((p) => p !== null).map(async (p) => readPeStrings(await readFile(p))))),
  );

  // The minimap's shape and the fog's tile edges; an install without them gets the client's plain diamond.
  const mapBmp = interfac.read('bina', MINIMAP_BMP_ID);
  const minimap = mapBmp ? parseMinimapShape(mapBmp) : null;
  const edgePaths = await Promise.all(['data2/TileEdge.dat', 'data2/BlkEdge.dat'].map((rel) => find(installDir, rel)));
  const [tileEdgePath, blackEdgePath] = edgePaths;
  const tileEdges = tileEdgePath && blackEdgePath ? parseTileEdges(await readFile(tileEdgePath), await readFile(blackEdgePath)) : null;

  // The screens' info files; their backgrounds (and the achievements screen's marks) go through their own palettes.
  const readBina = (id: number): Uint8Array | undefined => sources.interface.reduce<Uint8Array | undefined>((found, drs) => drs.read('bina', id) ?? found, undefined);
  const screenInfos = new Map<number, ScreenInfo>();
  for (const id of SCREEN_IDS) {
    const bytes = readBina(id);
    const info = bytes && parseScreenInfo(bytes);
    if (info) screenInfos.set(id, info);
  }
  const palettes = new Map<number, Palette>([[PALETTE_ID, palette]]);
  const paletteOf = (id: number): Palette | null => {
    if (!palettes.has(id)) {
      const bytes = readBina(id);
      if (!bytes) return null;
      palettes.set(id, parsePalette(bytes));
    }
    return palettes.get(id)!;
  };
  const slpPalettes = new Map<number, Palette>();
  const screens: Record<string, PackScreen> = {};
  for (const [id, info] of screenInfos) {
    const screenPalette = paletteOf(info.palette);
    if (!screenPalette) continue;
    screens[id] = packScreen(info, screenPalette);
    for (const slp of info.backgrounds) if (slp >= 0) slpPalettes.set(slp, screenPalette);
  }
  for (const [slp, screen] of Object.entries(DECAL_SCREENS)) {
    const info = screenInfos.get(screen);
    const screenPalette = info && paletteOf(info.palette);
    if (screenPalette) slpPalettes.set(Number(slp), screenPalette);
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, 'sprites'), { recursive: true });
  await copyFile(datPath, join(outDir, 'empires.dat'));
  await writeFile(join(outDir, 'palette.json'), JSON.stringify({ rgb: [...palette] }));

  const slps: Record<string, PackSlp> = {};
  let imageCount = 0;
  for (const source of Object.keys(sources) as SlpSource[]) {
    // Later archives (data2, Rise of Rome) override earlier ones.
    const bytesById = new Map<number, Uint8Array>();
    for (const drs of sources[source]) {
      for (const entry of drs.list('slp')) bytesById.set(entry.id, drs.read('slp', entry.id) as Uint8Array);
    }
    await mkdir(join(outDir, 'sprites', source), { recursive: true });
    for (const [id, bytes] of bytesById) {
      const result = await writeSlp(outDir, source, id, bytes, (source === 'interface' && slpPalettes.get(id)) || palette);
      slps[slpKey(source, id)] = result.slp;
      imageCount += result.images;
    }
    log(`${source}: ${bytesById.size} slp`);
  }

  const wavs = new Map<number, Uint8Array>();
  for (const drs of wavSources) for (const entry of drs.list('wav')) wavs.set(entry.id, drs.read('wav', entry.id) as Uint8Array);
  await mkdir(join(outDir, 'sounds'), { recursive: true });
  for (const [id, bytes] of wavs) await writeFile(join(outDir, soundPath(id)), bytes);
  log(`sounds: ${wavs.size} wav`);
  // The taunts are loose files, `sound/TauntNNN.wav` in any case (`TTaunt::PlayTauntNo`'s "%sTaunt%.3d.wav").
  const taunts: number[] = [];
  const soundDir = await find(installDir, 'sound');
  for (const name of soundDir ? await readdir(soundDir) : []) {
    const m = /^taunt(\d{3})\.wav$/i.exec(name);
    if (!m || Number(m[1]) === 0) continue;
    taunts.push(Number(m[1]));
    await copyFile(join(soundDir!, name), join(outDir, tauntPath(Number(m[1]))));
  }
  taunts.sort((a, b) => a - b);
  log(`taunts: ${taunts.length} wav`);

  const manifest = buildManifest(dat, slps, strings, minimap, tileEdges, [...wavs.keys()].sort((a, b) => a - b), screens, taunts);
  log(`strings: ${strings.size}`);
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest));
  return { manifest, slpCount: Object.keys(slps).length, imageCount, wavCount: wavs.size };
}

async function writeSlp(
  outDir: string,
  source: SlpSource,
  id: number,
  bytes: Uint8Array,
  palette: Palette,
): Promise<{ slp: PackSlp; images: number }> {
  const file = parseSlp(bytes);
  const decoded = Array.from({ length: file.frameCount }, (_, i) => file.decodeFrame(i));
  const layout = packShelves(decoded.map((f) => ({ w: f.width, h: f.height })));
  const frames: PackFrame[] = decoded.map((f, i) => ({
    ...(layout.placements[i] as { x: number; y: number }),
    w: f.width,
    h: f.height,
    hotspotX: f.hotspotX,
    hotspotY: f.hotspotY,
  }));
  const playerColour = decoded.some((f) => f.kinds.includes(SlpPixelKind.PlayerColour));
  const slp: PackSlp = { source, id, atlasWidth: layout.width, atlasHeight: layout.height, frames, playerColour };

  const owners = playerColour ? PLAYER_OWNERS : [1];
  for (const owner of owners) {
    const atlas = new Uint8Array(layout.width * layout.height * 4);
    decoded.forEach((frame, i) => blit(atlas, layout.width, frames[i] as PackFrame, slpFrameToRgba(frame, palette, { owner })));
    await writeFile(join(outDir, slpImagePath(slp, owner)), encodePng(layout.width, layout.height, atlas));
  }
  return { slp, images: owners.length };
}

function buildManifest(
  dat: DatFile,
  slps: Record<string, PackSlp>,
  strings: Map<number, string>,
  minimap: PackMinimap | null,
  tileEdges: PackTileEdges[] | null,
  wavs: number[],
  screens: Record<string, PackScreen>,
  taunts: number[],
): PackManifest {
  const graphicSlp = (slp: number): string | null => {
    const key = slpKey('graphics', slp);
    return slp >= 0 && slps[key] ? key : null;
  };
  const manifest: PackManifest = {
    version: PACK_VERSION,
    palette: 'palette.json',
    dat: 'empires.dat',
    slps,
    graphics: {},
    terrains: {},
    borders: {},
    units: {},
    techs: {},
    cultures: dat.civs.map((c) => c.iconSet),
    playerColours: dat.playerColours.map((c) => c.minimapColour),
    minimap,
    tileEdges,
    strings: Object.fromEntries(strings),
    sounds: {},
    unitSounds: {},
    wavs,
    screens,
    taunts,
  };
  dat.sounds.forEach((s, id) => {
    manifest.sounds[id] = { items: s.items.map((i) => [i.resourceId, i.probability]) };
  });
  dat.graphics.forEach((g, id) => {
    if (!g) return;
    manifest.graphics[id] = {
      name: g.name,
      slp: graphicSlp(g.slp),
      frameCount: g.frameCount,
      angleCount: g.angleCount,
      mirroringMode: g.mirroringMode,
      frameDuration: g.frameDuration,
      layer: g.layer,
      deltas: g.deltas.map((d) => [d.graphicId, d.offsetX, d.offsetY, d.displayAngle]),
      sound: g.soundId,
      // `play_sound` stops at a facet's first unused slot (frame -1).
      frameSounds: g.angleSounds?.map((a) => {
        const slots: [number, number][] = [[a.frame1, a.sound1], [a.frame2, a.sound2], [a.frame3, a.sound3]];
        const end = slots.findIndex(([frame]) => frame < 0);
        return end === -1 ? slots : slots.slice(0, end);
      }) ?? null,
    };
  });
  dat.terrainBlock.terrains.slice(0, dat.terrainsUsed).forEach((t, id) => {
    const key = slpKey('terrain', t.slp);
    const [rows = 1, cols = 1] = t.terrainDimensions;
    manifest.terrains[id] = {
      name: t.name,
      slp: t.slp >= 0 && slps[key] ? key : null,
      rows: Math.max(rows, 1),
      cols: Math.max(cols, 1),
      tiles: t.elevationGraphics.map((g) => [g.frameCount, g.angleCount, g.shapeId]),
      draw: t.terrainToDraw,
      borders: [...t.borders],
      minimap: [t.colours[0] ?? 0, t.colours[1] ?? 0, t.colours[2] ?? 0],
    };
  });
  // `load_border_types` (src/map.cpp:1460): a border is loaded when the dat enables it and its SLP opens.
  dat.terrainBlock.borders.forEach((b, id) => {
    if (!b.enabled) return;
    const key = slpKey('border', b.slp);
    manifest.borders[id] = {
      name: b.name,
      slp: b.slp >= 0 && slps[key] ? key : null,
      style: b.borderStyle,
      drawTile: b.drawTerrain,
      frames: b.frames.map((row) => row.map((f) => [f.frameCount, f.angleCount, f.shapeId])),
    };
  });
  // Trees, mines, forage and animals exist only in Gaia's table (civ 0).
  [dat.civs[1], dat.civs[0]].forEach((civ) => civ?.units.forEach((u, id) => {
    if (u && !manifest.units[id]) {
      const [x = 0, y = 0, z = 0] = u.outlineSize;
      manifest.units[id] = {
        name: u.name,
        standingGraphic: u.standingGraphic,
        icon: u.iconId,
        hitPoints: u.hitPoints,
        button: u.creatable?.buttonId ?? 0,
        outline: [x, y, z],
        nameId: u.languageDllName,
        creationId: u.languageDllCreation,
        hotkeyId: u.hotKeyId,
        level: u.interfaceKind,
        displayed: u.combat
          ? [u.combat.displayedAttack, u.combat.displayedMeleeArmour, u.creatable?.displayedPierceArmour ?? 0, u.combat.displayedRange]
          : [0, 0, 0, 0],
        selectLevel: u.interactionMode,
        minimap: [u.minimapMode, u.minimapColour],
        doppelganger: u.createDoppelgangerOnDeath,
      };
      manifest.unitSounds[id] = [
        u.selectionSound,
        u.trainSound,
        u.dyingSound,
        u.action?.attackSound ?? -1,
        u.action?.moveSound ?? -1,
        u.building?.constructionSound ?? -1,
      ];
    }
  }));
  dat.techs.forEach((t, id) => {
    manifest.techs[id] = { name: t.name, nameId: t.languageDllName, creationId: t.languageDllDescription, icon: t.iconId, button: t.buttonId };
  });
  return manifest;
}
