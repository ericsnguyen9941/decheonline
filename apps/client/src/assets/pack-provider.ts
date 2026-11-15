import { Assets, Rectangle, Texture } from 'pixi.js';
import { slpImagePath, slpKey, soundPath, PACK_VERSION, type PackManifest, type PackScreen } from '@aoe/assets-import/manifest';
import type { AssetProvider, BorderLayout, GraphicInfo, ImageFrame, MapArt, SoundTable, SpriteFrame, TechInfo, TerrainLayout, TerrainRules, UnitInfo } from './provider';

export const DEFAULT_PACK_URL = '/assets';

/** Reads `<baseUrl>/manifest.json`; null when the server has no pack (404) or it is unusable. */
export async function loadPackProvider(baseUrl = DEFAULT_PACK_URL): Promise<AssetProvider | null> {
  let manifest: PackManifest;
  try {
    const res = await fetch(`${baseUrl}/manifest.json`);
    if (!res.ok) return null;
    manifest = (await res.json()) as PackManifest;
  } catch {
    return null;
  }
  if (manifest.version !== PACK_VERSION) return null;
  let palette: number[] = [];
  try {
    const res = await fetch(`${baseUrl}/${manifest.palette}`);
    if (res.ok) palette = ((await res.json()) as { rgb: number[] }).rgb;
  } catch {
    // Without the palette the minimap draws in black.
  }
  return new PackProvider(baseUrl, manifest, palette);
}

class PackProvider implements AssetProvider {
  readonly kind = 'pack';

  constructor(
    private readonly baseUrl: string,
    private readonly manifest: PackManifest,
    private readonly palette: number[],
  ) {}

  private art: MapArt | null = null;
  private sounds: SoundTable | null = null;

  unitStandingGraphic(unitId: number): number | null {
    return this.manifest.units[unitId]?.standingGraphic ?? null;
  }

  graphicInfo(graphicId: number): GraphicInfo | null {
    const g = this.manifest.graphics[graphicId];
    if (!g || (!g.slp && g.deltas.length === 0)) return null;
    return {
      frameCount: g.frameCount,
      angleCount: g.angleCount,
      mirroringMode: g.mirroringMode,
      frameDuration: g.frameDuration,
      layer: g.layer,
      deltas: g.deltas.map(([graphic, offsetX, offsetY, angle]) => ({ graphic, offsetX, offsetY, angle })),
    };
  }

  async graphicFrames(graphicId: number, owner = 1): Promise<SpriteFrame[]> {
    const g = this.manifest.graphics[graphicId];
    // A dat graphic with no SLP and no parts (the Flare's "Blank", 787) shows nothing: one empty frame.
    if (g && !g.slp && g.deltas.length === 0) return [{ texture: Texture.EMPTY, hotspotX: 0, hotspotY: 0 }];
    return this.slpFrames(g?.slp ?? null, owner);
  }

  interfaceFrame(slp: number, frame: number, owner = 1): ImageFrame | null {
    const pack = this.manifest.slps[slpKey('interface', slp)];
    const f = pack?.frames[frame];
    if (!pack || !f) return null;
    return { url: `${this.baseUrl}/${slpImagePath(pack, owner)}`, x: f.x, y: f.y, w: f.w, h: f.h, hotspotX: f.hotspotX, hotspotY: f.hotspotY };
  }

  unitInfo(unitId: number): UnitInfo | null {
    const u = this.manifest.units[unitId];
    return u
      ? { icon: u.icon, hitPoints: u.hitPoints, button: u.button, outline: u.outline, nameId: u.nameId, creationId: u.creationId, hotkeyId: u.hotkeyId, level: u.level, displayed: u.displayed, selectLevel: u.selectLevel }
      : null;
  }

  techInfo(techId: number): TechInfo | null {
    const t = this.manifest.techs[techId];
    return t ? { name: t.name, nameId: t.nameId, creationId: t.creationId, icon: t.icon, button: t.button } : null;
  }

  string(id: number): string | null {
    return this.manifest.strings[id] ?? null;
  }

  screen(id: number): PackScreen | null {
    return this.manifest.screens[id] ?? null;
  }

  mapArt(): MapArt {
    const { manifest, palette } = this;
    return (this.art ??= {
      rgb: (i) => ((palette[i * 3] ?? 0) << 16) | ((palette[i * 3 + 1] ?? 0) << 8) | (palette[i * 3 + 2] ?? 0),
      terrainColours: (id) => manifest.terrains[id]?.minimap ?? null,
      unitMinimap: (id) => manifest.units[id]?.minimap ?? null,
      doppelganger: (id) => manifest.units[id]?.doppelganger ?? 0,
      playerColour: (player) => manifest.playerColours[player - 1] ?? null,
      minimap: manifest.minimap,
      tileEdges: manifest.tileEdges,
    });
  }

  soundTable(): SoundTable {
    const { manifest, baseUrl } = this;
    const wavs = new Set(manifest.wavs);
    return (this.sounds ??= {
      sound: (id) => manifest.sounds[id]?.items ?? null,
      unitSounds: (id) => manifest.unitSounds[id] ?? null,
      graphicSounds: (id) => {
        const g = manifest.graphics[id];
        return g ? { sound: g.sound, frameSounds: g.frameSounds } : null;
      },
      wavUrl: (id) => (wavs.has(id) ? `${baseUrl}/${soundPath(id)}` : null),
    });
  }

  terrainLayout(terrainId: number): TerrainLayout {
    const t = this.manifest.terrains[terrainId];
    return { rows: t?.rows ?? 1, cols: t?.cols ?? 1, tiles: t?.tiles ?? [] };
  }

  async terrainFrames(terrainId: number): Promise<SpriteFrame[]> {
    return this.slpFrames(this.manifest.terrains[terrainId]?.slp ?? null, 1);
  }

  terrainRules(terrainId: number): TerrainRules | null {
    const t = this.manifest.terrains[terrainId];
    return t ? { draw: t.draw, borders: t.borders } : null;
  }

  border(borderId: number): BorderLayout | null {
    const b = this.manifest.borders[borderId];
    return b?.slp ? { style: b.style, drawTile: b.drawTile, pictures: b.frames } : null;
  }

  async borderFrames(borderId: number): Promise<SpriteFrame[]> {
    return this.slpFrames(this.manifest.borders[borderId]?.slp ?? null, 1);
  }

  private async slpFrames(key: string | null, owner: number): Promise<SpriteFrame[]> {
    const slp = key === null ? undefined : this.manifest.slps[key];
    if (!slp) return [];
    const atlas = await Assets.load<Texture>(`${this.baseUrl}/${slpImagePath(slp, owner)}`);
    return slp.frames.map((f) => ({
      texture:
        f.w > 0 && f.h > 0
          ? new Texture({ source: atlas.source, frame: new Rectangle(f.x, f.y, f.w, f.h) })
          : Texture.EMPTY,
      hotspotX: f.hotspotX,
      hotspotY: f.hotspotY,
    }));
  }
}
