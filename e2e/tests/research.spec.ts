import { expect, test, type Browser, type Page } from '@playwright/test';

// speed=20 runs the lockstep clock 20x faster; resources=2000 starts every player with 2000 of each resource (both
// clients ask for it, so their games stay the same), enough for two buildings, the Tool Age and an Archery Range.
const URL = '/?debug=net&speed=20&resources=2000';

// Master ids (empires.dat): Villager, Builder, Town Center, Barracks, Granary, Archery Range, Bowman; tech 101 the Tool Age.
const VILLAGER = 83;
const BUILDER = 118;
const TOWN_CENTER = 109;
const BARRACKS = 12;
const GRANARY = 68;
const RANGE = 87;
const BOWMAN = 4;
const TOOL_AGE = 101;
const ACTIVE = 2;
/** Tech states: available, done. */
const AVAILABLE = 1;
const DONE = 3;

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

const slot = (page: Page, command: string, attr?: string) =>
  page.locator(`[data-testid=command-slot][data-command=${command}]${attr === undefined ? '' : attr}`);

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

const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/**
 * Selects one of player 1's villagers, opens its build menu, picks `unit` and clicks the first tile around the Town
 * Center where the ghost fits (away from the panels); resolves with the foundation's id once both clients have it.
 */
async function build(pages: Page[], unit: number): Promise<number> {
  const [page] = pages as [Page];
  const before = new Set((await page.evaluate(() => window.__game!.buildings())).map((b) => b.id));
  // A villager standing still (a walking one may have moved on by the time the click lands), idle ones first.
  const own = (await page.evaluate(() => window.__game!.units())).filter((u) => u.owner === 1 && !u.moving && (u.type === VILLAGER || u.type === BUILDER));
  const villager = own.find((u) => u.type === VILLAGER) ?? own[0]!;
  await select(page, villager.id, true);
  await slot(page, 'build').click();
  await slot(page, 'place', `[data-unit="${unit}"]`).click();
  const tc = (await page.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === TOWN_CENTER)!;
  const box = await canvasBox(page);
  let placed = false;
  for (let r = 3; r <= 7 && !placed; r++) {
    for (let d = -r; d <= r && !placed; d++) {
      for (const [dx, dy] of [[d, -r], [d, r], [-r, d], [r, d]] as const) {
        const spot = await page.evaluate(([c, w]) => window.__map!.tileScreenPos(c, w), [Math.floor(tc.x) + dx, Math.floor(tc.y) + dy] as const);
        if (spot.x < 40 || spot.x > box.width - 40 || spot.y < 80 || spot.y > box.height - 220) continue;
        await page.mouse.move(box.x + spot.x, box.y + spot.y);
        await frames(page);
        if (!(await page.evaluate(() => window.__game!.ghost()?.fits))) continue;
        await page.mouse.click(box.x + spot.x, box.y + spot.y);
        placed = true;
        break;
      }
    }
  }
  expect(placed).toBe(true);
  for (const p of pages) {
    await p.waitForFunction(
      ([type, seen]) => window.__game!.buildings().some((b) => b.owner === 1 && b.type === type && !seen.includes(b.id)),
      [unit, [...before]] as const,
      { timeout: 30_000 },
    );
  }
  return (await page.evaluate(() => window.__game!.buildings())).find((b) => b.type === unit && !before.has(b.id))!.id;
}

async function finished(pages: Page[], id: number): Promise<void> {
  for (const p of pages) {
    await p.waitForFunction(([b, active]) => window.__game!.buildings().find((x) => x.id === b)?.state === active, [id, ACTIVE] as const, {
      timeout: 60_000,
    });
  }
}

test.setTimeout(180_000);

test('one player researches the Tool Age, builds an Archery Range and trains a Bowman; both clients agree on hashes', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  const both = [host, guest];
  for (const page of both) await expect(page.getByTestId('age')).toHaveText('Stone Age');
  expect(await host.evaluate(() => window.__game!.resources(1).food)).toBe(2000);

  // Stone Age: the Town Center shows the Tool Age, disabled (dithered, deaf to the mouse) until two Stone Age buildings stand.
  const tc = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === TOWN_CENTER)!;
  await select(host, tc.id);
  const toolAge = slot(host, 'research', `[data-tech="${TOOL_AGE}"]`);
  await expect(toolAge).toHaveCount(1);
  await expect(toolAge).toHaveClass(/disabled/);
  await toolAge.click();
  await frames(host);
  expect(await host.evaluate((t) => window.__game!.techState(t), TOOL_AGE)).not.toBe(2);

  const barracks = await build(both, BARRACKS);
  const granary = await build(both, GRANARY);
  await finished(both, barracks);
  await finished(both, granary);
  for (const page of both) await page.waitForFunction(([t, s]) => window.__game!.techState(t, 1) === s, [TOOL_AGE, AVAILABLE] as const);

  // The button is live now; its message is the research text and the cost. A click starts the research: the grid is
  // Stop in slot 0 and Unselect, and the panel shows the progress.
  await select(host, tc.id);
  await expect(toolAge).not.toHaveClass(/disabled/);
  await toolAge.hover();
  await expect(host.getByTestId('hud-message')).toHaveText(/\(Food: 500\)$/);
  await toolAge.click();
  for (const page of both) await page.waitForFunction((id) => window.__game!.buildings().find((b) => b.id === id)?.research != null, tc.id);
  expect(await host.evaluate(() => window.__game!.resources(1).food)).toBe(1500);
  await expect(slot(host, 'stop')).toHaveCount(1);
  expect(await host.locator('[data-testid=command-slot]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.command))).toEqual([
    'stop', '', '', '', '', '', '', '', '', '', '', 'unselect',
  ]);
  await expect(host.getByTestId('object-item')).toHaveText(/^\d+%$/);

  // The Tool Age: the host's top bar says so, the guest's (still Stone Age) does not.
  for (const page of both) await page.waitForFunction(([t, s]) => window.__game!.techState(t, 1) === s, [TOOL_AGE, DONE] as const, { timeout: 60_000 });
  await expect(host.getByTestId('age')).toHaveText('Tool Age');
  await expect(guest.getByTestId('age')).toHaveText('Stone Age');
  expect(await guest.evaluate(() => [window.__game!.age(1), window.__game!.age(2)])).toEqual([2, 1]);
  await expect(slot(host, 'stop')).toHaveCount(0);

  // The villager's build menu now holds the Archery Range; the finished Range trains a Bowman.
  const range = await build(both, RANGE);
  await finished(both, range);
  await select(host, range);
  const bowman = slot(host, 'train', `[data-unit="${BOWMAN}"]`);
  await expect(bowman).toHaveCount(1);
  await bowman.click();
  await expect(slot(host, 'stop')).toHaveCount(1);
  for (const page of both) {
    await page.waitForFunction((b) => window.__game!.units().some((u) => u.owner === 1 && u.type === b), BOWMAN, { timeout: 60_000 });
  }

  // Both clients end with the same buildings, ages and stockpiles, and agree on the hash of a turn both have run.
  const state = (page: Page) =>
    page.evaluate(() => ({ buildings: window.__game!.buildings(), ages: [window.__game!.age(1), window.__game!.age(2)], one: window.__game!.resources(1) }));
  await expect.poll(async () => JSON.stringify(await state(host)) === JSON.stringify(await state(guest)), { timeout: 30_000 }).toBe(true);
  const turns = await Promise.all(both.map((p) => p.evaluate(() => window.__game!.turn())));
  const turn = Math.max(...turns) + 2;
  for (const page of both) await page.waitForFunction((t) => window.__game!.turn() > t, turn);
  const [a, b] = await Promise.all(both.map((p) => p.evaluate((t) => window.__game!.hash(t), turn)));
  expect(a).toBeDefined();
  expect(a).toBe(b);
  const final = await state(host);
  console.log(`turn ${turn} hash ${a}: ages ${final.ages}, ${final.buildings.length} buildings, stock ${JSON.stringify(final.one)}`);
});
