import { expect, test, type Browser, type Page } from '@playwright/test';

// A Tiny Small Islands map (lobby map type 0), random-map seed 6 on both clients, the map revealed. naval=1 gives every
// player a built Dock on its shore and a Transport Boat and a Trade Boat on the water by it (`placeNavalStart`). On seed
// 6 the host's boats reach the guest's island and Dock (checked in a Node run of the same world).
const URL = '/?debug=net&speed=20&seed=6&naval=1';

/** Master ids (empires.dat): Villager, Dock, Transport Boat, Trade Boat. */
const VILLAGER = 83;
const DOCK = 45;
const TRANSPORT_BOAT = 17;
const TRADE_BOAT = 15;
/** Action type of the Trade action. */
const ACTION_TRADE = 111;
/** Terrains: water, beach. */
const WATER = 1;
const BEACH = 2;
/** A beach tile of the guest's island facing the host's side (seed 6): where the transport unloads. */
const SHORE = { col: 18, row: 51 };
/** `relation` stance: neutral (trade needs a Dock that is not an enemy's; nobody fights unless ordered). */
const NEUTRAL = 1;
/** Trade goods: food (the trade buttons are food, wood, stone in slots 1-3; a new trade boat carries wood). */
const FOOD = 0;

async function open(browser: Browser, errors: string[]): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  return page;
}

/** Host creates the room on the water map, guest joins by code, both ready, host starts; both then take a neutral stance. */
async function startGame(browser: Browser, errors: string[]): Promise<[Page, Page]> {
  const host = await open(browser, errors);
  const guest = await open(browser, errors);
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
  await expect(host.getByTestId('start')).toBeEnabled();
  await host.getByTestId('start').click();
  const pages = [host, guest];
  for (const page of pages) await page.waitForFunction(() => window.__game?.selection() != null && window.__map !== undefined);
  for (const [i, page] of pages.entries()) await page.evaluate(([p, r]) => window.__game!.issue({ type: 'relation', player: p, relation: r }), [2 - i, NEUTRAL] as const);
  for (const page of pages) await page.waitForFunction((r) => window.__game!.relation(1, 2) === r && window.__game!.relation(2, 1) === r, NEUTRAL);
  return [host, guest];
}

const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const slot = (page: Page, command: string) => page.locator(`[data-testid=command-slot][data-command=${command}]`);
const objects = (page: Page) => page.evaluate(() => window.__game!.objects());
const objectById = async (page: Page, id: number) => (await objects(page)).find((o) => o.id === id)!;
const applied = (page: Page) => page.evaluate(() => window.__game!.applied().flat() as unknown as { type: string; [field: string]: unknown }[]);
/** The ring cursor (mcursors facet 5): the pack's art, or the browser's crosshair without it. */
const ringCursor = (page: Page) => page.evaluate(() => document.getElementById('game')!.style.getPropertyValue('--cursor-target') || 'crosshair');

/** Where object `id` is drawn, once the view centred on it has drawn it (a loaded machine can lag a frame or two). */
const screenPos = async (page: Page, id: number) =>
  (await (await page.waitForFunction((i) => window.__game!.objectScreenPos(i), id)).jsonValue()) as { x: number; y: number };

/** Centres the view on object `id` and left clicks it (a little higher each try: its sprite stands above its foot point). */
async function selectObject(page: Page, id: number): Promise<void> {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  for (const dy of [0, -10, 10, -20, 5]) {
    // Esc first: a second click on the same spot with something selected picks past it (`clickAt`).
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

/**
 * Hovers object `target` (the view on it) until the cursor is `cursor` (null: the cursor the hover gives must not matter),
 * then right clicks there, until a `work` order on it goes out; returns the cursor seen at the click.
 */
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

// The lockstep paces steps to the clients' frame times (turn-timing.md §8.1): the waits are on state.
test.setTimeout(600_000);

test('Dock ghost on shore, boarding, Unload on the far shore and trading, on two clients of a water map', async ({ browser }) => {
  const errors: string[] = [];
  const [host, guest] = await startGame(browser, errors);
  const both = [host, guest];
  const all = await objects(host);
  const of = (owner: number, type: number) => all.filter((o) => o.owner === owner && o.type === type);
  const [dock, guestDock] = [of(1, DOCK)[0]!, of(2, DOCK)[0]!];
  const boat = of(1, TRANSPORT_BOAT)[0]!;
  const trader = of(1, TRADE_BOAT)[0]!;
  const villagers = of(1, VILLAGER).slice(0, 2);
  expect(villagers).toHaveLength(2);

  // The Dock's ghost: a Villager's build menu, the Dock button, then the pointer over every tile round the host's Dock.
  // Where it shows valid, the tile under its centre is water with a beach beside it (the sim's shore rule).
  await selectObject(host, villagers[0]!.id);
  await slot(host, 'build').click();
  await host.locator(`[data-testid=command-slot][data-command=place][data-unit="${DOCK}"]`).click();
  await host.evaluate(([x, y]) => window.__map!.centerOnTile(Math.floor(x), Math.floor(y)), [dock.x, dock.y] as const);
  await frames(host);
  const box = (await host.getByTestId('game-canvas').boundingBox())!;
  const ghosts: { x: number; y: number; fits: boolean; shore: boolean }[] = [];
  for (let row = Math.floor(dock.y) - 5; row <= Math.floor(dock.y) + 7; row++) {
    for (let col = Math.floor(dock.x) - 7; col <= Math.floor(dock.x) + 7; col++) {
      if (col < 0 || row < 0) continue;
      const at = await host.evaluate(([c, r]) => window.__map!.tileScreenPos(c, r), [col, row] as const);
      if (at.y < 60 || at.y > box.height - 140) continue;
      await host.mouse.move(box.x + at.x, box.y + at.y);
      await frames(host);
      const ghost = (await host.evaluate(() => window.__game!.ghost()))!;
      const shore = await host.evaluate(
        ([x, y, water, beach]) => {
          const t = (c: number, r: number) => (c < 0 || r < 0 || c >= window.__map!.width || r >= window.__map!.height ? -1 : window.__map!.tileInfo(c, r).terrain);
          const [c, r] = [Math.floor(x), Math.floor(y)];
          return t(c, r) === water && [t(c, r - 1), t(c + 1, r), t(c, r + 1), t(c - 1, r)].includes(beach);
        },
        [ghost.x, ghost.y, WATER, BEACH] as const,
      );
      ghosts.push({ x: ghost.x, y: ghost.y, fits: ghost.fits, shore });
    }
  }
  const valid = ghosts.filter((g) => g.fits);
  expect(valid.length).toBeGreaterThan(0);
  expect(ghosts.filter((g) => !g.fits && !g.shore).length).toBeGreaterThan(0);
  expect(valid.filter((g) => !g.shore)).toEqual([]);
  await host.keyboard.press('Escape');
  await host.keyboard.press('Escape');
  expect(await host.evaluate(() => window.__game!.ghost())).toBeNull();

  // Boarding: each Villager, selected, shows the ring over the own transport and right clicks it (a work order, Enter).
  const ring = await ringCursor(host);
  for (const v of villagers) {
    await selectObject(host, v.id);
    expect(await rightClickOn(host, boat.id, ring)).toContain(ring);
  }
  // Aboard on both clients: `inside` is the boat, the boat's cargo lists them, and neither is drawn.
  for (const p of both) {
    await p.waitForFunction(([ids, b]) => ids.every((id) => window.__game!.objects().find((o) => o.id === id)!.inside === b), [villagers.map((v) => v.id), boat.id] as const);
    expect([...(await objectById(p, boat.id)).cargo].sort()).toEqual(villagers.map((v) => v.id).sort());
    for (const v of villagers) expect(await p.evaluate((id) => window.__game!.objectScreenPos(id), v.id)).toBeNull();
  }

  // The transport's panel counts its cargo against its room; Unload is in slot 0.
  await selectObject(host, boat.id);
  await expect(host.getByTestId('object-cargo')).toHaveText('2/5');
  await expect(slot(host, 'unload')).toBeVisible();
  await expect(host.locator('[data-testid=command-slot]').first()).toHaveAttribute('data-command', 'unload');

  // Unload: the button (a click mode: only Cancel left), then a click on the guest's shore; the boat sails there and drops
  // them, on both clients, at the same spots.
  await slot(host, 'unload').click();
  expect(await host.evaluate(() => window.__game!.commandMode())).toBe('unload');
  await expect(host.locator('[data-testid=command-slot]:not([data-command=""])')).toHaveCount(1);
  await host.evaluate(([c, r]) => window.__map!.centerOnTile(c, r), [SHORE.col, SHORE.row] as const);
  await frames(host);
  const shore = await host.evaluate(([c, r]) => window.__map!.tileScreenPos(c, r), [SHORE.col, SHORE.row] as const);
  await host.mouse.click(box.x + shore.x, box.y + shore.y);
  expect(await host.evaluate(() => window.__game!.commandMode())).toBeNull();
  await expect.poll(async () => (await applied(host)).find((c) => c.type === 'unload')).toBeTruthy();
  const unload = (await applied(host)).find((c) => c.type === 'unload')!;
  expect(unload.units).toEqual([boat.id]);
  expect(Math.abs((unload.x as number) - SHORE.col - 0.5)).toBeLessThanOrEqual(1);
  expect(Math.abs((unload.y as number) - SHORE.row - 0.5)).toBeLessThanOrEqual(1);
  for (const p of both) await p.waitForFunction((ids) => ids.every((id) => window.__game!.objects().find((o) => o.id === id)!.inside === null), villagers.map((v) => v.id));
  const landed = await Promise.all(both.map(async (p) => Promise.all(villagers.map((v) => objectById(p, v.id)))));
  for (const v of landed[0]!) expect(Math.hypot(v.x - SHORE.col - 0.5, v.y - SHORE.row - 0.5)).toBeLessThan(6);
  for (const [i, v] of landed[1]!.entries()) expect([v.x, v.y]).toEqual([landed[0]![i]!.x, landed[0]![i]!.y]);
  for (const v of villagers) await expect.poll(() => host.evaluate((id) => window.__game!.objectScreenPos(id), v.id)).not.toBeNull();
  await expect(host.getByTestId('object-cargo')).toHaveText('0/5');
  await expect(slot(host, 'unload')).toHaveCount(0);

  // Trading: the trade boat's three trade buttons (food, wood, stone in slots 1-3); food sets the good on both clients.
  await selectObject(host, trader.id);
  await expect(slot(host, 'trade')).toHaveCount(3);
  expect((await objectById(host, trader.id)).heldType).not.toBe(FOOD);
  await slot(host, 'trade').nth(FOOD).click();
  for (const p of both) await p.waitForFunction(([id, w]) => window.__game!.objects().find((o) => o.id === id)!.heldType === w, [trader.id, FOOD] as const);
  await expect(host.getByTestId('object-held-icon')).toHaveCount(1);
  // The guest's Dock is only explored (Reveal Map), drawn as its fog copy: a landed Villager walks up to it so the host
  // sees it.
  await host.evaluate(([id, x, y]) => window.__game!.issueMove([id], x, y), [villagers[0]!.id, guestDock.x - 2.5, guestDock.y] as const);
  await host.waitForFunction(([x, y]) => window.__game!.tileVisibility(Math.floor(x), Math.floor(y)) === 0x0f, [guestDock.x, guestDock.y] as const);
  // A right click on the guest's Dock, which keeps the normal cursor (a trade boat's selection has no cursor of its own),
  // starts the Trade action; the boat loads food there and brings the host gold, on both clients.
  await selectObject(host, trader.id);
  const cursor = await rightClickOn(host, guestDock.id, null);
  expect(cursor).not.toContain(ring);
  for (const p of both) await p.waitForFunction(([id, a]) => window.__game!.objects().find((o) => o.id === id)!.work === a, [trader.id, ACTION_TRADE] as const);
  const gold = (await host.evaluate(() => window.__game!.resources(1))).gold;
  for (const p of both) await p.waitForFunction((g) => window.__game!.resources(1).gold > g, gold);

  // Both games agree on the hash of a turn both have run, and no page threw.
  const turn = Math.max(...(await Promise.all(both.map((p) => p.evaluate(() => window.__game!.turn()))))) + 2;
  for (const p of both) await p.waitForFunction((t) => window.__game!.turn() > t, turn);
  const [a, b] = await Promise.all(both.map((p) => p.evaluate((t) => window.__game!.hash(t), turn)));
  expect(a).toBe(b);
  expect(errors).toEqual([]);
  console.log(`ghost valid on ${valid.length} of ${ghosts.length} tiles; unloaded at (${unload.x}, ${unload.y}); trade boat ${trader.id} trading; turn ${turn} hash ${a}`);
});
