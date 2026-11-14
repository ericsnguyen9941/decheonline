import { Assets, Rectangle, Texture } from 'pixi.js';
import { slpImagePath, PACK_VERSION, type PackManifest } from '@aoe/assets-import/manifest';
import type { AssetProvider, SpriteFrame } from './provider';

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

  async graphicFrames(graphicId: number, owner = 1): Promise<SpriteFrame[]> {
    return this.slpFrames(this.manifest.graphics[graphicId]?.slp ?? null, owner);
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
