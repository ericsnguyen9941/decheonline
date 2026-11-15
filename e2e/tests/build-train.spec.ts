import { expect, test, type Browser, type Page } from '@playwright/test';

// speed=20 runs the lockstep clock 20x faster, so building a House and training a Villager take seconds.
const URL = '/?debug=net&map=test&speed=20';

// Master ids (empires.dat): Villager, the Builder it turns into while building, House, Town Center.
const VILLAGER = 83;
const BUILDER = 118;
const HOUSE = 70;
const TOWN_CENTER = 109;
/** `object_state`: a foundation, then active. */
const UNBUILT = 0;
const ACTIVE = 2;

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

const slot = (page: Page, command: string, unit?: number) =>
  page.locator(`[data-testid=command-slot][data-command=${command}]${unit === undefined ? '' : `[data-unit="${unit}"]`}`);

async function canvasBox(page: Page) {
  return (await page.getByTestId('game-canvas').boundingBox())!;
}

/** Left click own object `id` in the middle of its drawn sprite, and check it is the selection. */
async function select(page: Page, id: number, unit = false): Promise<void> {
  const box = await canvasBox(page);
  const at = unit
    ? (await page.evaluate((i) => window.__game!.unitScreenPos(i), id))!
    : (await page.evaluate((i) => window.__game!.objectScreenPos(i), id))!;
  await page.mouse.click(box.x + at.x, box.y + at.y - (unit ? 15 : 0));
  await expect.poll(() => page.evaluate(() => window.__game!.selection())).toEqual([id]);
}

test('one player builds a House and trains a Villager; both clients show the same buildings, population and hashes', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  const startPop = await host.evaluate(() => window.__game!.population(1));
  expect(await guest.evaluate(() => window.__game!.population(1))).toEqual(startPop);

  // The host's villager: the grid shows Build; Build opens the build menu with the House.
  const villager = (await host.evaluate(() => window.__game!.units())).find((u) => u.owner === 1 && u.type === VILLAGER)!;
  await select(host, villager.id, true);
  await expect(slot(host, 'build')).toHaveCount(1);
  await expect(slot(host, 'unselect')).toHaveCount(1);
  await slot(host, 'build').click();
  await expect(slot(host, 'place', HOUSE)).toHaveCount(1);
  await expect(slot(host, 'cancel')).toHaveCount(1);
  await slot(host, 'place', HOUSE).click();
  await expect(slot(host, 'place')).toHaveCount(0);

  // The ghost follows the pointer: over the Town Center it does not fit, over open ground two tiles east of the villagers it does.
  const box = await canvasBox(host);
  const tc = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === TOWN_CENTER)!;
  const tcAt = (await host.evaluate((id) => window.__game!.objectScreenPos(id), tc.id))!;
  await host.mouse.move(box.x + tcAt.x, box.y + tcAt.y);
  await expect.poll(() => host.evaluate(() => window.__game!.ghost())).toMatchObject({ unit: HOUSE, fits: false });
  // Esc stops placing, and the grid is back to the villager's.
  await host.keyboard.press('Escape');
  expect(await host.evaluate(() => window.__game!.ghost())).toBeNull();
  await expect(slot(host, 'build')).toHaveCount(1);
  await slot(host, 'build').click();
  await slot(host, 'place', HOUSE).click();
  const spot = await host.evaluate(() => window.__map!.tileScreenPos(14, 8));
  await host.mouse.move(box.x + spot.x, box.y + spot.y);
  await expect.poll(() => host.evaluate(() => window.__game!.ghost())).toEqual({ unit: HOUSE, x: 14, y: 8, fits: true });
  await host.mouse.click(box.x + spot.x, box.y + spot.y);
  expect(await host.evaluate(() => window.__game!.ghost())).toBeNull();

  // Both clients get the foundation (the construction sprite), the villager builds it as a Builder, and it completes.
  for (const page of [host, guest]) {
    await page.waitForFunction(
      (house) => window.__game!.buildings().some((b) => b.owner === 1 && b.type === house),
      HOUSE,
    );
  }
  const foundation = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.type === HOUSE)!;
  expect(foundation).toMatchObject({ x: 14, y: 8 });
  await host.waitForFunction(([id, builder]) => window.__game!.objects().find((o) => o.id === id)?.type === builder, [villager.id, BUILDER] as const);
  for (const page of [host, guest]) {
    await page.waitForFunction(([id, active]) => window.__game!.buildings().find((b) => b.id === id)?.state === active, [foundation.id, ACTIVE] as const);
  }
  const built = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.id === foundation.id)!;
  expect(built.progress).toBe(100);
  expect(built.graphic).not.toBe(foundation.graphic);
  expect(foundation.state).toBe(UNBUILT);

  // The host's Town Center: one Villager queued; the button counts it and the panel shows the training progress.
  await select(host, tc.id);
  await expect(slot(host, 'train', VILLAGER)).toHaveCount(1);
  const food = (await host.evaluate(() => window.__game!.resources(1))).food;
  await slot(host, 'train', VILLAGER).click();
  await expect.poll(() => host.evaluate((id) => window.__game!.queue(id)?.records, tc.id)).toEqual([{ unit: VILLAGER, count: 1 }]);
  await expect(slot(host, 'train', VILLAGER).locator('.hud-slot-count')).toHaveText('1');
  await expect(host.getByTestId('object-item')).toHaveText(/^\d+%$/);
  expect((await host.evaluate(() => window.__game!.resources(1))).food).toBe(food - 50);

  // The guest's Town Center: five clicks, but 200 food pays for four; a right click takes one off and refunds it.
  const guestTc = (await guest.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 2 && b.type === TOWN_CENTER)!;
  await select(guest, guestTc.id);
  const guestPop = (await guest.evaluate(() => window.__game!.population(2))).count;
  for (let i = 0; i < 5; i++) await slot(guest, 'train', VILLAGER).click();
  // Queued plus already trained: the first may finish while the clicks go in.
  await expect
    .poll(() =>
      guest.evaluate(
        ([id, pop]) => (window.__game!.queue(id)?.records[0]?.count ?? 0) + window.__game!.population(2).count - pop!,
        [guestTc.id, guestPop] as const,
      ),
    )
    .toBe(4);
  expect((await guest.evaluate(() => window.__game!.resources(2))).food).toBe(0);
  // (The first of them may finish meanwhile: the refund, not the count, tells the right click worked.)
  await slot(guest, 'train', VILLAGER).click({ button: 'right' });
  await expect.poll(() => guest.evaluate(() => window.__game!.resources(2).food)).toBe(50);
  // The button's number is the queue's count. A Villager may finish between two reads, so both are read in one evaluate.
  await expect
    .poll(() =>
      guest.evaluate((id) => {
        const shown = document.querySelector('[data-testid=command-slot][data-command=train][data-unit="83"] .hud-slot-count')?.textContent;
        const queued = window.__game!.queue(id)!.records[0]!.count;
        return shown === String(queued) && queued <= 3;
      }, guestTc.id),
    )
    .toBe(true);
  // The host's new villager appears on both clients and the population goes up by one.
  for (const page of [host, guest]) {
    await page.waitForFunction((n) => window.__game!.population(1).count === n, startPop.count + 1);
    await page.waitForFunction((n) => window.__game!.units().filter((u) => u.owner === 1).length === n, startPop.count + 1);
  }

  // Both clients end with the same buildings and populations, and agree on the hash of a turn both have run.
  const state = (page: Page) =>
    page.evaluate(() => ({ buildings: window.__game!.buildings(), one: window.__game!.population(1), two: window.__game!.population(2) }));
  await expect.poll(async () => JSON.stringify(await state(host)) === JSON.stringify(await state(guest))).toBe(true);
  const final = await state(host);
  expect(final.buildings.filter((b) => b.type === HOUSE)).toHaveLength(1);
  expect(final.one.count).toBe(startPop.count + 1);
  const turns = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game!.turn())));
  const turn = Math.max(...turns) + 2;
  for (const page of [host, guest]) await page.waitForFunction((t) => window.__game!.turn() > t, turn);
  const [a, b] = await Promise.all([host, guest].map((p) => p.evaluate((t) => window.__game!.hash(t), turn)));
  expect(a).toBeDefined();
  expect(a).toBe(b);
  console.log(`turn ${turn} hash ${a}: population ${JSON.stringify(final.one)} / ${JSON.stringify(final.two)}, ${final.buildings.length} buildings`);
});
