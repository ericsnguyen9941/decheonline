import { expect, test, type Browser, type Page } from '@playwright/test';

// speed=20 runs the lockstep clock 20x faster; 500 of each resource pays for Villagers.
const URL = '/?debug=net&map=test&speed=20&resources=500';

// Master ids (empires.dat): Villager, Town Center.
const VILLAGER = 83;
const TOWN_CENTER = 109;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

/** Host creates, guest joins by code, both ready, host starts; resolves once both have drawn the map. */
async function startGame(browser: Browser): Promise<[Page, Page]> {
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
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game?.selection() != null && window.__map !== undefined);
  return [host, guest];
}

const units = (page: Page) => page.evaluate(() => window.__game!.units());
const selection = (page: Page) => page.evaluate(() => [...window.__game!.selection()!].sort((a, b) => a - b));

async function canvasBox(page: Page) {
  return (await page.getByTestId('game-canvas').boundingBox())!;
}

/** Drag a box that holds the drawn middle of every unit in `ids` (box selection takes own units only). */
async function boxSelect(page: Page, ids: number[]): Promise<void> {
  const box = await canvasBox(page);
  const at = await Promise.all(ids.map((id) => page.evaluate((i) => window.__game!.unitScreenPos(i), id)));
  const xs = at.map((p) => p!.x);
  const ys = at.map((p) => p!.y);
  await page.mouse.move(box.x + Math.min(...xs) - 14, box.y + Math.min(...ys) - 14);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.max(...xs) + 14, box.y + Math.max(...ys) + 14, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => selection(page)).toEqual([...ids].sort((a, b) => a - b));
}


const slot = (page: Page, command: string, unit?: number) =>
  page.locator(`[data-testid=command-slot][data-command=${command}]${unit === undefined ? '' : `[data-unit="${unit}"]`}`);
const primary = (page: Page) => page.evaluate(() => window.__game!.primary());

test('the original hotkeys: Tab, Ctrl+N and H select, a grid key trains, M moves, U ungroups, groups show their number', async ({ browser }) => {
  const [host] = await startGame(browser);
  const all = await units(host);
  const villagers = all.filter((u) => u.owner === 1 && u.type === VILLAGER).map((u) => u.id);
  const [v1, v2, v3] = villagers as [number, number, number];
  const tc = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === TOWN_CENTER)!;

  // Tab steps the panel's object through the selection, Shift+Tab back: the last selected is first shown.
  await boxSelect(host, villagers);
  const first = (await primary(host))!;
  const order = [first];
  for (let i = 0; i < 2; i++) {
    await host.keyboard.press('Tab');
    await expect.poll(() => primary(host)).not.toBe(order[order.length - 1]);
    order.push((await primary(host))!);
  }
  expect(new Set(order).size).toBe(3);
  await host.keyboard.press('Tab');
  await expect.poll(() => primary(host)).toBe(order[0]);
  await host.keyboard.press('Shift+Tab');
  await expect.poll(() => primary(host)).toBe(order[2]);
  expect(await selection(host)).toEqual([v1, v2, v3]);

  // Ctrl+1 puts them in group 1: its number is drawn over each; U (the Ungroup key) takes them out, and the numbers go.
  await host.keyboard.press('Control+Digit1');
  await expect.poll(() => host.evaluate(() => window.__game!.groupNumbers().map((g) => [g.id, g.group]))).toEqual([[v1, 1], [v2, 1], [v3, 1]]);
  await host.keyboard.press('u');
  await expect.poll(() => host.evaluate(() => window.__game!.groupNumbers())).toEqual([]);

  // M arms the move: the message says so, and the next left click walks the selection there.
  const box = await canvasBox(host);
  await host.keyboard.press('m');
  await expect(host.getByTestId('hud-message')).toHaveText('Click an area to move there.');
  // Any mouse move takes the message line's text away (`handle_mouse_move`); the armed move stays.
  await host.mouse.move(box.x + 20, box.y + 20);
  await host.mouse.move(box.x + 30, box.y + 30);
  await expect(host.getByTestId('hud-message')).toBeHidden();
  const before = (await units(host)).find((u) => u.id === v1)!;
  const target = { col: Math.round(before.x) + 4, row: Math.round(before.y) + 4 };
  const spot = await host.evaluate(([c, r]) => window.__map!.tileScreenPos(c, r), [target.col, target.row] as const);
  await host.mouse.click(box.x + spot.x, box.y + spot.y);
  await expect
    .poll(async () => {
      const u = (await units(host)).find((x) => x.id === v1)!;
      return Math.hypot(u.x - target.col, u.y - target.row);
    })
    .toBeLessThan(2);

  // H views the Town Center: it is selected and the view scrolls to it, from where the camera was.
  await host.evaluate(() => window.__map!.centerOnTile(30, 30));
  const fromCentre = async () => {
    const at = await host.evaluate((id) => window.__game!.unitScreenPos(id), tc.id);
    return at ? Math.hypot(at.x - box.width / 2, at.y - box.height / 2) : null;
  };
  await expect.poll(async () => (await fromCentre()) ?? Infinity).toBeGreaterThan(400);
  await host.keyboard.press('h');
  await expect.poll(() => selection(host)).toEqual([tc.id]);
  await expect.poll(async () => (await fromCentre()) ?? Infinity).toBeLessThan(40);

  // A grid button's key: C trains a Villager at the selected Town Center, as a click on its button would.
  await expect(slot(host, 'train', VILLAGER)).toHaveCount(1);
  await host.keyboard.press('c');
  await expect.poll(() => host.evaluate((id) => window.__game!.queue(id)?.records, tc.id)).toEqual([{ unit: VILLAGER, count: 1 }]);
  await expect(slot(host, 'train', VILLAGER).locator('.hud-slot-count')).toHaveText('1');

  // Ctrl+N selects the next Town Center from a Villager (select_building_hotkey[0]); Ctrl+B finds no Barracks and changes nothing.
  await boxSelect(host, [v1]);
  await host.evaluate(() => window.__map!.centerOnTile(30, 30));
  await host.keyboard.press('Control+KeyB');
  expect(await selection(host)).toEqual([v1]);
  await host.keyboard.press('Control+KeyN');
  await expect.poll(() => selection(host)).toEqual([tc.id]);
});
