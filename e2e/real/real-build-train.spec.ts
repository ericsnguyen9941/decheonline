import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

const VILLAGER = 83;
const HOUSE = 70;
const TOWN_CENTER = 109;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('/?debug=net&speed=2');
  return page;
}

const slot = (page: Page, command: string, unit?: number) =>
  page.locator(`[data-testid=command-slot][data-command=${command}]${unit === undefined ? '' : `[data-unit="${unit}"]`}`);
/** Background of a button's icon, or with `border` of the slot itself (its border). */
const background = (page: Page, command: string, unit?: number, border = false) => {
  const el = border ? slot(page, command, unit) : slot(page, command, unit).locator('.hud-slot-icon');
  return el.evaluate((e) => getComputedStyle(e).backgroundImage);
};

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(shots, name) });
  console.log(`screenshot: ${join(shots, name)}`);
}

test('the build menu, the placement ghost, a foundation and the train queue show the original art', async ({ browser }) => {
  const host = await open(browser);
  const guest = await open(browser);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  // Every object the fog lets the player see is drawn from the pack.
  await host.waitForFunction(() => window.__game !== undefined && window.__game.shownObjects() > 0 && window.__game.packSprites() === window.__game.shownObjects());
  mkdirSync(shots, { recursive: true });
  // The debug strip of `?debug=net` covers the corner of the object panel.
  await host.getByTestId('net-debug').evaluate((el) => el.remove());
  const box = (await host.getByTestId('game-canvas').boundingBox())!;

  // A villager: Build (btncmd frame 2) opens the build menu, each building's icon from btnbldg_0 in the player's colour.
  const villager = (await host.evaluate(() => window.__game!.units())).find((u) => u.owner === 1 && u.type === VILLAGER)!;
  const at = (await host.evaluate((id) => window.__game!.unitScreenPos(id), villager.id))!;
  await host.mouse.click(box.x + at.x, box.y + at.y - 15);
  await expect(slot(host, 'build')).toHaveCount(1);
  expect(await background(host, 'build')).toContain('/assets/sprites/interface/50721.o1.png');
  expect(await background(host, 'build', undefined, true)).toContain('/assets/sprites/interface/50713.png');
  await slot(host, 'build').click();
  await expect(slot(host, 'place', HOUSE)).toHaveCount(1);
  expect(await background(host, 'place', HOUSE)).toContain('/assets/sprites/interface/50704.o1.png');
  expect(await background(host, 'cancel')).toContain('/assets/sprites/interface/50721.o1.png');
  await host.mouse.move(box.x + box.width / 2, box.y + 200);
  await shot(host, 'build-menu.png');

  // Placing the House: its ghost over open ground, then (shaded red) over the Town Center.
  await slot(host, 'place', HOUSE).click();
  const spot = await host.evaluate(() => window.__map!.tileScreenPos(14, 8));
  await host.mouse.move(box.x + spot.x, box.y + spot.y);
  await expect.poll(() => host.evaluate(() => window.__game!.ghost())).toMatchObject({ unit: HOUSE, fits: true });
  await shot(host, 'build-ghost.png');
  const tc = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === TOWN_CENTER)!;
  const tcAt = (await host.evaluate((id) => window.__game!.objectScreenPos(id), tc.id))!;
  await host.mouse.move(box.x + tcAt.x, box.y + tcAt.y);
  await expect.poll(() => host.evaluate(() => window.__game!.ghost())).toMatchObject({ unit: HOUSE, fits: false });
  await shot(host, 'build-ghost-blocked.png');

  // The foundation: the construction sprite, selected, with its progress and Cancel Construction.
  await host.mouse.move(box.x + spot.x, box.y + spot.y);
  await expect.poll(() => host.evaluate(() => window.__game!.ghost())).toMatchObject({ fits: true });
  await host.mouse.click(box.x + spot.x, box.y + spot.y);
  await host.waitForFunction((house) => window.__game!.buildings().some((b) => b.type === house), HOUSE);
  const house = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.type === HOUSE)!;
  await host.waitForFunction((id) => window.__game!.objectScreenPos(id) !== null, house.id);
  const houseAt = (await host.evaluate((id) => window.__game!.objectScreenPos(id), house.id))!;
  await host.mouse.click(box.x + houseAt.x, box.y + houseAt.y);
  await expect.poll(() => host.evaluate(() => window.__game!.selection())).toEqual([house.id]);
  await expect(slot(host, 'cancel-construction')).toHaveCount(1);
  await expect(host.getByTestId('object-item')).toHaveText(/^\d+%$/);
  expect(await host.getByTestId('object-item-icon').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('/assets/sprites/interface/50731.png');
  await host.mouse.move(box.x + box.width / 2, box.y + 200);
  await shot(host, 'foundation.png');

  // The Town Center: two Villagers queued; the button (btnunit) counts them and the panel shows the training progress.
  await host.mouse.click(box.x + tcAt.x, box.y + tcAt.y);
  await expect.poll(() => host.evaluate(() => window.__game!.selection())).toEqual([tc.id]);
  expect(await background(host, 'train', VILLAGER)).toContain('/assets/sprites/interface/50730.o1.png');
  await slot(host, 'train', VILLAGER).click();
  await slot(host, 'train', VILLAGER).click();
  await expect(slot(host, 'train', VILLAGER).locator('.hud-slot-count')).toHaveText('2');
  await host.waitForFunction((id) => (window.__game!.queue(id)?.training?.progress ?? 0) > 0, tc.id);
  await host.mouse.move(box.x + box.width / 2, box.y + 200);
  await shot(host, 'train-queue.png');
});
