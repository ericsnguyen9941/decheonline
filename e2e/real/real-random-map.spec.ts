import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { walkOntoHill } from '../hills';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

const TOWN_CENTER = 109;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('/?debug=net&speed=2');
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(shots, name) });
  console.log(`screenshot: ${join(shots, name)}`);
}

/** A 2-player invite-code game on the random map its seed makes; returns both pages once each has drawn its start. */
async function playGame(browser: Browser): Promise<[Page, Page]> {
  const host = await open(browser);
  const guest = await open(browser);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await expect(host.getByTestId('player-1')).toContainText('Bob');
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__map?.source === 'pack' && window.__game?.minimapPoint(0, 0) != null);
    await page.waitForFunction(() => window.__game!.packSprites() > 0 && window.__game!.packSprites() === window.__game!.shownObjects() && window.__game!.turn() > 2);
  }
  return [host, guest];
}

const start = (page: Page) =>
  page.evaluate((tc) => {
    const me = window.__game!.player();
    const centre = window.__game!.buildings().find((b) => b.owner === me && b.type === tc)!;
    return { player: me, x: centre.x, y: centre.y, map: window.__map!.mapHash, width: window.__map!.width };
  }, TOWN_CENTER);

test.setTimeout(300_000);

test('two random map games: each player starts on its own Town Center, different maps for different seeds', async ({ browser }) => {
  mkdirSync(shots, { recursive: true });
  const games: Awaited<ReturnType<typeof start>>[][] = [];
  for (const game of [1, 2]) {
    const [host, guest] = await playGame(browser);
    const starts = await Promise.all([host, guest].map(start));
    console.log(`game ${game}: ${JSON.stringify(starts)}`);
    expect(starts[0]!.map).toBe(starts[1]!.map);
    expect(starts[0]!.width).toBe(144);
    await shot(host, `random-map-${game}-p1.png`);
    await shot(guest, `random-map-${game}-p2.png`);
    if (game === 1) {
      await host.getByTestId('minimap-canvas').screenshot({ path: join(shots, 'random-map-minimap.png') });
      console.log(`screenshot: ${join(shots, 'random-map-minimap.png')}`);
    }
    games.push(starts);
    await host.context().close();
    await guest.context().close();
  }
  expect(games[0]![0]!.map).not.toBe(games[1]![0]!.map);
});

test('hills: slopes and heights drawn from the terrain art, a Villager walked up one by a right click and selected there', async ({ browser }) => {
  test.setTimeout(480_000);
  mkdirSync(shots, { recursive: true });
  const [host, guest] = await playGame(browser);
  const walk = await walkOntoHill(host);
  console.log(`hill walk: ${JSON.stringify(walk)}`);
  expect(walk.lift).toBeCloseTo(16 * walk.hill.height, 0);
  await host.evaluate(([c, r]) => window.__map!.centerOnTile(c!, r!), [walk.hill.col, walk.hill.row] as const);
  await shot(host, 'elevation-hill.png');
  // The map's highest ground (the one nearest the Villager), the fog off (debug only), to show tall hills.
  const peak = await host.evaluate(([c0, r0]) => {
    const m = window.__map!;
    let best = { col: c0!, row: r0!, height: -1, d: 0 };
    for (let row = 0; row < m.height; row++) {
      for (let col = 0; col < m.width; col++) {
        const h = m.tileInfo(col, row).height;
        const d = Math.hypot(col - c0!, row - r0!);
        if (h > best.height || (h === best.height && d < best.d)) best = { col, row, height: h, d };
      }
    }
    return best;
  }, [walk.hill.col, walk.hill.row] as const);
  console.log(`peak: ${JSON.stringify(peak)}`);
  await host.evaluate(([c, r]) => {
    window.__map!.showAll();
    window.__map!.centerOnTile(c!, r!);
  }, [peak.col, peak.row] as const);
  await shot(host, 'elevation-peak.png');
  await host.context().close();
  await guest.context().close();
});
