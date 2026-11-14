import { Assets, Rectangle, Texture } from 'pixi.js';
import { slpImagePath, slpKey, PACK_VERSION, type PackManifest } from '@aoe/assets-import/manifest';
import type { AssetProvider, GraphicInfo, ImageFrame, SpriteFrame, TechInfo, UnitInfo } from './provider';

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
  return new PackProvider(baseUrl, manifest);
}

class PackProvider implements AssetProvider {
  readonly kind = 'pack';

  constructor(
    private readonly baseUrl: string,
    private readonly manifest: PackManifest,
  ) {}

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
      ? { icon: u.icon, hitPoints: u.hitPoints, button: u.button, outline: u.outline, nameId: u.nameId, creationId: u.creationId, level: u.level, displayed: u.displayed, selectLevel: u.selectLevel }
      : null;
  }

  techInfo(techId: number): TechInfo | null {
    const t = this.manifest.techs[techId];
    return t ? { name: t.name, nameId: t.nameId, creationId: t.creationId, icon: t.icon, button: t.button } : null;
  }

  string(id: number): string | null {
    return this.manifest.strings[id] ?? null;
  }

  terrainLayout(terrainId: number): { rows: number; cols: number } {
    const t = this.manifest.terrains[terrainId];
    return { rows: t?.rows ?? 1, cols: t?.cols ?? 1 };
  }

  async terrainFrames(terrainId: number): Promise<SpriteFrame[]> {
    return this.slpFrames(this.manifest.terrains[terrainId]?.slp ?? null, 1);
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
