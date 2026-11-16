import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

// The synthetic naval.spec's game: a Tiny Small Islands map, seed 6, revealed; every player's Dock, Transport Boat and
// Trade Boat placed by naval=1.
const URL = '/?debug=net&speed=20&seed=6&naval=1';
const VILLAGER = 83;
const DOCK = 45;
const TRANSPORT_BOAT = 17;
const TRADE_BOAT = 15;
const ACTION_TRADE = 111;
/** btncmd.shp (Unload frame 5, Cancel 10) and btntech.shp (the trade buttons, frames 87, 86, 88). */
const BTNCMD = 50721;
const BTNTECH = 50729;
/** The beach of the guest's island where the transport unloads (seed 6). */
const SHORE = { col: 18, row: 51 };
const NEUTRAL = 1;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

async function shot(page: Page, name: string, clip?: string): Promise<void> {
  const path = join(shots, name);
  if (clip) await page.getByTestId(clip).screenshot({ path });
  else await page.screenshot({ path });
  console.log(`screenshot: ${path}`);
}

const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const slot = (page: Page, command: string) => page.locator(`[data-testid=command-slot][data-command=${command}]`);
const background = (page: Page, command: string, nth = 0) => slot(page, command).nth(nth).locator('.hud-slot-icon').evaluate((e) => getComputedStyle(e).backgroundImage);
const objectById = async (page: Page, id: number) => (await page.evaluate(() => window.__game!.objects())).find((o) => o.id === id)!;
const applied = (page: Page) => page.evaluate(() => window.__game!.applied().flat() as unknown as { type: string; [field: string]: unknown }[]);

/** Where object `id` is drawn, once the view centred on it has drawn it (a loaded machine can lag a frame or two). */
const screenPos = async (page: Page, id: number) =>
  (await (await page.waitForFunction((i) => window.__game!.objectScreenPos(i), id)).jsonValue()) as { x: number; y: number };

/** Centres the view on object `id` and left clicks it, a little higher each try. */
async function selectObject(page: Page, id: number): Promise<void> {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  for (const dy of [0, -10, 10, -20, 5]) {
    await page.keyboard.press('Escape');
    const o = await objectById(page, id);
    await page.evaluate(([x, y]) => window.__map!.centerOnTile(Math.floor(x), Math.floor(y)), [o.x, o.y] as const);
    await frames(page);
    const at = await screenPos(page, id);
    await page.mouse.click(box.x + at.x, box.y + at.y + dy);
    await frames(page);
    if (JSON.stringify(await page.evaluate(() => window.__game!.selection())) === JSON.stringify([id])) return;
  }
  await expect.poll(() => page.evaluate(() => window.__game!.selection())).toEqual([id]);
}

/** Hovers `target` until the cursor holds `cursor` (null: any), right clicks there until a work order on it goes out. */
async function rightClickOn(page: Page, target: number, cursor: string | null): Promise<string> {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  const sent = async () => (await applied(page)).some((c) => c.type === 'work' && c.target === target);
  const o = await objectById(page, target);
  await page.evaluate(([x, y]) => window.__map!.centerOnTile(Math.floor(x), Math.floor(y)), [o.x, o.y] as const);
  await frames(page);
  let seen = '';
  for (const dy of [0, -10, 10, -20, 5, -5]) {
    const at = await screenPos(page, target);
    await page.mouse.move(box.x + at.x, box.y + at.y + dy);
    await frames(page);
    seen = await page.evaluate(() => window.__game!.cursor());
    if (cursor !== null && !seen.includes(cursor)) continue;
    await page.mouse.click(box.x + at.x, box.y + at.y + dy, { button: 'right' });
    try {
      await expect.poll(sent, { timeout: 3000 }).toBe(true);
      return seen;
    } catch {
      // missed: try the next spot
    }
  }
  expect(await sent()).toBe(true);
  return seen;
}

test.setTimeout(600_000);

test('real pack: Dock ghost, the ring over a transport, Unload, cargo and the trade buttons are the original art', async ({ browser }) => {
  mkdirSync(shots, { recursive: true });
  const host = await open(browser);
  const guest = await open(browser);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await expect(host.getByTestId('player-1')).toContainText('Bob');
  await host.getByTestId('map-size').selectOption('72');
  await host.getByTestId('map-type').selectOption('0');
  await host.getByTestId('reveal-map').check();
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  const pages = [host, guest];
  for (const page of pages) await page.waitForFunction(() => window.__game?.selection() != null && window.__map?.source === 'pack');
  for (const [i, page] of pages.entries()) await page.evaluate(([p, r]) => window.__game!.issue({ type: 'relation', player: p, relation: r }), [2 - i, NEUTRAL] as const);
  for (const page of pages) await page.waitForFunction((r) => window.__game!.relation(1, 2) === r && window.__game!.relation(2, 1) === r, NEUTRAL);
  const all = await host.evaluate(() => window.__game!.objects());
  const of = (owner: number, type: number) => all.filter((o) => o.owner === owner && o.type === type);
  const [dock, guestDock] = [of(1, DOCK)[0]!, of(2, DOCK)[0]!];
  const boat = of(1, TRANSPORT_BOAT)[0]!;
  const trader = of(1, TRADE_BOAT)[0]!;
  const villagers = of(1, VILLAGER).slice(0, 2);
  const box = (await host.getByTestId('game-canvas').boundingBox())!;

  // The Dock's ghost over a shore tile (valid) and over the land beside it (shaded red).
  await selectObject(host, villagers[0]!.id);
  await slot(host, 'build').click();
  await host.locator(`[data-testid=command-slot][data-command=place][data-unit="${DOCK}"]`).click();
  await host.evaluate(([x, y]) => window.__map!.centerOnTile(Math.floor(x), Math.floor(y)), [dock.x, dock.y] as const);
  await frames(host);
  let valid: { col: number; row: number } | null = null;
  for (let row = Math.floor(dock.y) - 3; row <= Math.floor(dock.y) + 7 && !valid; row++) {
    for (let col = Math.floor(dock.x) - 7; col <= Math.floor(dock.x) + 7 && !valid; col++) {
      if (col < 0 || row < 0) continue;
      const at = await host.evaluate(([c, r]) => window.__map!.tileScreenPos(c, r), [col, row] as const);
      await host.mouse.move(box.x + at.x, box.y + at.y);
      await frames(host);
      if ((await host.evaluate(() => window.__game!.ghost()))!.fits) valid = { col, row };
    }
  }
  expect(valid).not.toBeNull();
  await shot(host, 'naval-dock-ghost-shore.png');
  const land = await host.evaluate(([x, y]) => window.__map!.tileScreenPos(x, y), [Math.floor(villagers[0]!.x), Math.floor(villagers[0]!.y)] as const);
  await host.mouse.move(box.x + land.x, box.y + land.y);
  await frames(host);
  expect((await host.evaluate(() => window.__game!.ghost()))!.fits).toBe(false);
  await shot(host, 'naval-dock-ghost-land.png');
  await host.keyboard.press('Escape');
  await host.keyboard.press('Escape');

  // The ring (mcursors facet 5) over the own transport for a selected Villager; its right click boards.
  const ring = await host.evaluate(() => document.getElementById('game')!.style.getPropertyValue('--cursor-target'));
  expect(ring).toContain('url(data:image/png');
  const ringPng = /data:image\/png;base64,([^)"]+)/.exec(ring)![1]!;
  for (const v of villagers) {
    await selectObject(host, v.id);
    expect(await rightClickOn(host, boat.id, ringPng)).toContain(ringPng);
  }
  await host.waitForFunction(([ids, b]) => ids.every((id) => window.__game!.objects().find((o) => o.id === id)!.inside === b), [villagers.map((v) => v.id), boat.id] as const);

  // The transport's panel and grid: cargo 2/5, Unload in slot 0 from btncmd.
  await selectObject(host, boat.id);
  await expect(host.getByTestId('object-cargo')).toHaveText('2/5');
  expect(await background(host, 'unload')).toContain(`/assets/sprites/interface/${BTNCMD}`);
  await shot(host, 'naval-transport-panel.png', 'hud-bottom');
  await slot(host, 'unload').click();
  expect(await host.evaluate(() => window.__game!.commandMode())).toBe('unload');
  expect(await background(host, 'cancel')).toContain(`/assets/sprites/interface/${BTNCMD}`);
  await host.evaluate(([c, r]) => window.__map!.centerOnTile(c, r), [SHORE.col, SHORE.row] as const);
  await frames(host);
  const shore = await host.evaluate(([c, r]) => window.__map!.tileScreenPos(c, r), [SHORE.col, SHORE.row] as const);
  await host.mouse.click(box.x + shore.x, box.y + shore.y);
  await host.waitForFunction((ids) => ids.every((id) => window.__game!.objects().find((o) => o.id === id)!.inside === null), villagers.map((v) => v.id));
  await host.evaluate(([c, r]) => window.__map!.centerOnTile(c, r), [SHORE.col, SHORE.row] as const);
  await frames(host);
  await shot(host, 'naval-unloaded.png');

  // The trade boat's grid: the three trade buttons from btntech; food, then a right click on the guest's Dock.
  await selectObject(host, trader.id);
  for (const i of [0, 1, 2]) expect(await background(host, 'trade', i)).toContain(`/assets/sprites/interface/${BTNTECH}`);
  await slot(host, 'trade').nth(0).click();
  await host.waitForFunction((id) => window.__game!.objects().find((o) => o.id === id)!.heldType === 0, trader.id);
  await shot(host, 'naval-trade-panel.png', 'hud-bottom');
  await host.evaluate(([id, x, y]) => window.__game!.issueMove([id], x, y), [villagers[0]!.id, guestDock.x - 2.5, guestDock.y] as const);
  await host.waitForFunction(([x, y]) => window.__game!.tileVisibility(Math.floor(x), Math.floor(y)) === 0x0f, [guestDock.x, guestDock.y] as const);
  await selectObject(host, trader.id);
  expect(await rightClickOn(host, guestDock.id, null)).not.toContain(ringPng);
  await host.waitForFunction(([id, a]) => window.__game!.objects().find((o) => o.id === id)!.work === a, [trader.id, ACTION_TRADE] as const);
  console.log(`ghost valid at (${valid!.col}, ${valid!.row}); unload from SLP ${BTNCMD} frame 5; trade from SLP ${BTNTECH} frames 87, 86, 88`);
});
