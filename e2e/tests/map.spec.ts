import { expect, test, type Page } from '@playwright/test';

// Tile (26, 30) in the middle of the view: lake, grass and the desert strip are all on screen.
const URL = '/?debug=map&col=26&row=30';

async function open(page: Page, url = URL): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => window.__map !== undefined && window.__map.drawnTiles() > 0);
}

const camera = (page: Page) => page.evaluate(() => window.__map!.camera());

test('the fixed test map renders to the baseline screenshot', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => window.__map!.source)).toBe('pack');
  await expect(page.getByTestId('game-canvas')).toHaveScreenshot('test-map.png');
});

test('without a pack the map falls back to debug shapes', async ({ page }) => {
  await page.route('**/assets/manifest.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await open(page);
  expect(await page.evaluate(() => window.__map!.source)).toBe('debug');
});

test('only tiles near the viewport have sprites', async ({ page }) => {
  await open(page);
  const { drawn, total } = await page.evaluate(() => ({ drawn: window.__map!.drawnTiles(), total: window.__map!.width * window.__map!.height }));
  expect(drawn).toBeGreaterThan(100);
  expect(drawn).toBeLessThan(total / 3);
  // Tile lookups agree with where the tile is drawn.
  const hit = await page.evaluate(() => {
    const p = window.__map!.tileScreenPos(26, 30);
    return { p, tile: window.__map!.tileAt(p.x, p.y) };
  });
  expect(hit.tile).toEqual({ col: 26, row: 30 });
  expect(hit.p).toEqual({ x: 400, y: 225 });
});

test('the camera scrolls by dragging, by keys and at the screen edge, and stays over the map', async ({ page }) => {
  await open(page);
  const canvas = page.getByTestId('game-canvas');
  const box = (await canvas.boundingBox())!;
  const start = await camera(page);

  // Drag the map left and up: the camera moves right and down by the same distance.
  await page.mouse.move(box.x + 400, box.y + 225);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 175, { steps: 5 });
  await page.mouse.up();
  expect(await camera(page)).toEqual({ x: start.x + 100, y: start.y + 50 });

  // Keys.
  const beforeKeys = await camera(page);
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowLeft');
  expect((await camera(page)).x).toBeLessThan(beforeKeys.x - 50);

  // Pointer at the right edge.
  const beforeEdge = await camera(page);
  await page.mouse.move(box.x + box.width - 3, box.y + 225);
  await page.waitForTimeout(300);
  expect((await camera(page)).x).toBeGreaterThan(beforeEdge.x + 50);
  await page.mouse.move(box.x + 400, box.y + 225);

  // Pushed past the top corner of the map, the view centre stops on its corner tile, and the sprites follow the camera.
  await page.evaluate(() => window.__map!.setCamera(-9999, -9999));
  const corner = await page.evaluate(() => ({ centre: window.__map!.tileAt(400, 225), drawn: window.__map!.drawnTiles() }));
  expect(corner.centre).toEqual({ col: 47, row: 0 });
  expect(corner.drawn).toBeGreaterThan(0);
});
