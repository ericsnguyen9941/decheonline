import { expect, test, type Page } from '@playwright/test';
import { SYNTHETIC } from '@aoe/assets-import';

// The synthetic palette (see @aoe/formats fixtures): colour i = (i, 255 - i, i ^ 0x55).
const colour = (i: number) => [i, 255 - i, i ^ 0x55, 255];

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function report(page: Page) {
  await page.waitForFunction(() => window.__assetsDebug !== undefined);
  return page.evaluate(() => {
    const view = window.__assetsDebug!;
    return { source: view.source, terrainFrames: view.terrainFrames, terrainRects: view.terrainRects, unitRect: view.unitRect };
  });
}

const sample = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => window.__assetsDebug!.pixel(px!, py!), [Math.round(x), Math.round(y)]);

test('debug view renders the sprites imported from a synthetic install', async ({ page }) => {
  await page.goto(`/?debug=assets&unit=${SYNTHETIC.unitId}&owner=2`);
  const view = await report(page);
  expect(view.source).toBe('pack');
  expect(view.terrainFrames).toBe(2);

  // Terrain 0, frames 0 and 1: solid palette indices 60 and 61.
  const [first, second] = view.terrainRects as Rect[];
  expect(first).toMatchObject({ width: SYNTHETIC.terrainFrame[0], height: SYNTHETIC.terrainFrame[1] });
  expect(await sample(page, first!.x + first!.width / 2, first!.y + first!.height / 2)).toEqual(colour(SYNTHETIC.terrains[0].index));
  expect(await sample(page, second!.x + second!.width / 2, second!.y + second!.height / 2)).toEqual(colour(SYNTHETIC.terrains[0].index + 1));

  // The unit: left half palette index 100; right half player colour value 2 of owner 2 = index 34.
  const unit = view.unitRect as Rect;
  expect(unit.width).toBe(SYNTHETIC.frameSize * 3);
  const mid = unit.y + unit.height / 2;
  expect(await sample(page, unit.x + unit.width / 4, mid)).toEqual(colour(SYNTHETIC.normalIndex));
  expect(await sample(page, unit.x + (unit.width * 3) / 4, mid)).toEqual(colour(SYNTHETIC.playerValue + 2 * 16));
});

test('debug view falls back to debug shapes when the server has no pack', async ({ page }) => {
  await page.route('**/assets/manifest.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto(`/?debug=assets&unit=${SYNTHETIC.unitId}`);
  const view = await report(page);
  expect(view.source).toBe('debug');
  // One debug diamond per tile type (flat and the 16 slopes, docs/spec/hud.md "Elevation").
  expect(view.terrainFrames).toBe(17);
  expect(view.unitRect).not.toBeNull();
});
