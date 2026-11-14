import { expect, test } from 'vitest';
import type { AssetProvider, GraphicInfo } from '../assets';
import { splitsShadow } from './composite';

// Layers of the dat graphics (npm run dat:dump -- graphic <id>): the catapult stone 96 (30) and its shadow 841 (10);
// the arrow 0 (30) has no draw list part on the ground.
const graphic = (layer: number, deltas: number[]): GraphicInfo => ({
  frameCount: 1,
  angleCount: 1,
  mirroringMode: 0,
  frameDuration: 0,
  layer,
  deltas: deltas.map((g) => ({ graphic: g, offsetX: 0, offsetY: 0, angle: -1 })),
});
const GRAPHICS: Record<number, GraphicInfo> = { 96: graphic(30, [-1, 841]), 841: graphic(10, []), 0: graphic(30, [-1]) };
const provider = { graphicInfo: (id: number) => GRAPHICS[id] ?? null } as AssetProvider;

test('a missile whose draw list has a part at draw level 10 or less splits off a shadow; the arrow does not', () => {
  expect(splitsShadow(provider, GRAPHICS[96]!)).toBe(true);
  expect(splitsShadow(provider, GRAPHICS[0]!)).toBe(false);
});
