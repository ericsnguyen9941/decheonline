import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { walkOntoHill } from '../hills';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

const TOWN_CENTER = 109;
// A fixed random-map seed whose plateau a Villager reaches on foot (the server's seed is random, and some maps have none).
const HILL_SEED = 1;

async function open(browser: Browser, query = ''): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(`/?debug=net&speed=2${query}`);
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(shots, name) });
  console.log(`screenshot: ${join(shots, name)}`);
}

/** A 2-player invite-code game on the random map its seed makes; returns both pages once each has drawn its start. */
async function playGame(browser: Browser, query = ''): Promise<[Page, Page]> {
  const host = await open(browser, query);
  const guest = await open(browser, query);
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
  const [host, guest] = await playGame(browser, `&seed=${HILL_SEED}`);
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

test('hills: the minimap\'s view frame is centred on the view\'s centre tile, also on a raised-top tile', async ({ browser }) => {
  test.setTimeout(480_000);
  const [host, guest] = await playGame(browser, `&seed=${HILL_SEED}`);
  // The view's centre point is the tile `lookAt` centred on, whose raised top (types 2, 6, 8, 10, 14-16) moves the picture 16 px
  // up: read back as a flat pixel (what the frame did) it lands on the tile one row on.
  const frames = await host.evaluate(() => {
    const m = window.__map!;
    const g = window.__game!;
    const found: Record<number, { col: number; row: number }> = {};
    for (let row = 4; row < m.height - 4; row++) {
      for (let col = 4; col < m.width - 4; col++) {
        const type = m.tileInfo(col, row).type;
        if ([2, 6, 8, 10, 14, 15, 16].includes(type) && !found[type]) found[type] = { col, row };
      }
    }
    const tiles = Object.entries(found).map(([type, t]) => ({ type: Number(type), ...t }));
    return tiles.map((t) => {
      m.centerOnTile(t.col, t.row);
      return { ...t, frame: g.minimapFrame(), point: g.minimapPoint(t.col, t.row) };
    });
  });
  console.log(`frames: ${JSON.stringify(frames)}`);
  expect(frames.length).toBeGreaterThanOrEqual(3);
  for (const f of frames) {
    expect(f.frame, `type ${f.type}`).not.toBeNull();
    expect([f.frame!.col, f.frame!.row]).toEqual([f.col, f.row]);
    // The frame is drawn round the centre tile's minimap point (src/diam_map.cpp:826).
    expect(f.frame!.left).toBeLessThan(f.point!.x);
    expect(f.frame!.right).toBeGreaterThan(f.point!.x);
  }
  await host.context().close();
  await guest.context().close();
});

test('terrain art: beach, shallows and forest drawn with their terrain_to_draw art, borders between terrains', async ({ browser }) => {
  mkdirSync(shots, { recursive: true });
  // Seed 6's map has a coast with grass, water, beach, shallows and forest round tile (40, 84).
  const [host, guest] = await playGame(browser, '&seed=6');
  const coast = await host.evaluate(() => {
    const m = window.__map!;
    const terrains: Record<number, number> = {};
    const borders: Record<number, number> = {};
    let bordered: { col: number; row: number } | null = null;
    for (let row = 80; row <= 88; row++) {
      for (let col = 36; col <= 44; col++) {
        const t = m.tileInfo(col, row);
        terrains[t.terrain] = (terrains[t.terrain] ?? 0) + 1;
        if (t.border) borders[t.border] = (borders[t.border] ?? 0) + 1;
        if (t.border && t.borderShape && !bordered) bordered = { col, row };
      }
    }
    return { debug: m.debugTerrains(), terrains, borders, bordered };
  });
  console.log(`coast: ${JSON.stringify(coast)}`);
  expect(coast.debug).toEqual([]);
  for (const t of [1, 2, 4, 10]) expect(coast.terrains[t] ?? 0).toBeGreaterThan(0);
  // Desert/water (2) on the beach by the water and shallows, grass/desert2 (6) edges on the grass and forest by the beach.
  expect(coast.borders[2] ?? 0).toBeGreaterThan(0);
  expect(coast.borders[6] ?? 0).toBeGreaterThan(0);
  await host.evaluate(() => {
    window.__map!.showAll();
    window.__map!.centerOnTile(40, 84);
  });
  // A click on a bordered tile picks that tile.
  const b = coast.bordered!;
  const picked = await host.evaluate(([c, r]) => {
    const p = window.__map!.tileScreenPos(c!, r!);
    return window.__map!.tileAt(p.x, p.y);
  }, [b.col, b.row] as const);
  expect(picked).toEqual(b);
  await shot(host, 'terrain-coast.png');
  await host.context().close();
  await guest.context().close();
});
