import { DebugProvider } from './debug-provider';
import { loadPackProvider } from './pack-provider';
import type { AssetProvider } from './provider';

export type { AssetProvider, BorderLayout, FramePart, GraphicInfo, ImageFrame, MapArt, MusicTable, SoundTable, SpriteFrame, TerrainLayout, TerrainRules, UnitInfo } from './provider';

/** The pack from the server when it has one, otherwise debug shapes. */
export async function createAssetProvider(): Promise<AssetProvider> {
  return (await loadPackProvider()) ?? new DebugProvider();
}
