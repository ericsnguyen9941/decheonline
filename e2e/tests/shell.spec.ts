import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Lobby screenshots go to assets-local/ (gitignored) for review.
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');
mkdirSync(shots, { recursive: true });

async function openMap(page: Page): Promise<void> {
  await page.goto('/?debug=map&col=26&row=30');
  await page.waitForFunction(() => window.__map !== undefined && window.__map.drawnTiles() > 0);
}

const canvasSize = (page: Page) =>
  page.getByTestId('game-canvas').evaluate((c: HTMLCanvasElement) => {
    const box = c.getBoundingClientRect();
    return { x: box.x, y: box.y, w: box.width, h: box.height, backing: c.width, scrollbars: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight };
  });

/** RGB of the canvas pixel (x, y), read from a 1x1 screenshot. */
async function pixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  const idat: Buffer[] = [];
  let colour = 2;
  for (let at = 8; at < png.length; ) {
    const len = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    if (type === 'IHDR') colour = png[at + 8 + 9]!;
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  expect([2, 6]).toContain(colour); // RGB or RGBA
  const row = inflateSync(Buffer.concat(idat)); // filter byte, then the pixel; one pixel makes every filter the identity
  return [row[1]!, row[2]!, row[3]!];
}

for (const [width, height] of [
  [1280, 800],
  [1920, 1080],
] as const) {
  test(`the canvas fills a ${width}x${height} window`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openMap(page);
    const size = await canvasSize(page);
    console.log(`canvas at ${width}x${height}:`, JSON.stringify(size));
    expect(size).toMatchObject({ x: 0, y: 0, w: width, h: height, scrollbars: false });
  });
}

test('the canvas and the camera follow a window resize', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMap(page);
  await page.setViewportSize({ width: 900, height: 600 });
  await expect.poll(() => canvasSize(page)).toMatchObject({ w: 900, h: 600 });
  // The view centre stays on tile (26, 30), now at the middle of the smaller canvas.
  await expect.poll(() => page.evaluate(() => window.__map!.tileScreenPos(26, 30))).toEqual({ x: 450, y: 300 });
});

test('outside the map is black', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMap(page);
  // Pushed past the top corner of the map: the upper part of the canvas is off the map, the lower middle is over it.
  await page.evaluate(() => window.__map!.setCamera(-9999, -9999));
  // Two animation frames: the second starts after the renderer drew the first with the new camera.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const corners = [await pixel(page, 2, 2), await pixel(page, 1277, 2), await pixel(page, 640, 2), await pixel(page, 300, 200)];
  console.log('corner pixels:', JSON.stringify(corners));
  for (const c of corners) expect(c).toEqual([0, 0, 0]);
  const middle = await pixel(page, 640, 500);
  console.log('middle pixel:', JSON.stringify(middle));
  expect(middle).not.toEqual([0, 0, 0]);
});

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('/?debug=net&speed=20');
  return page;
}

test('the lobby is styled and hides the canvas until the game starts', async ({ browser }) => {
  const host = await open(browser);
  const guest = await open(browser);
  await expect(host.getByTestId('lobby')).toBeVisible();
  await expect(host.getByTestId('game-canvas')).toBeHidden();
  await host.screenshot({ path: join(shots, 'lobby-entry.png') });

  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await expect(host.getByTestId('player-1')).toContainText('Bob');
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await expect(host.getByTestId('start')).toBeEnabled();
  await expect(host.getByTestId('game-canvas')).toBeHidden();
  await host.screenshot({ path: join(shots, 'lobby-room-host.png') });
  await guest.screenshot({ path: join(shots, 'lobby-room-guest.png') });

  await host.getByTestId('start').click();
  await expect(host.getByTestId('game-canvas')).toBeVisible();
  await expect(host.getByTestId('lobby')).toBeHidden();
  await host.waitForFunction(() => window.__map !== undefined && window.__map.drawnTiles() > 0);
  expect(await canvasSize(host)).toMatchObject({ w: 1280, h: 800 });
  await host.screenshot({ path: join(shots, 'game-started.png') });
});
