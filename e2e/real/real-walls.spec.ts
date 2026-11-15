import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

const VILLAGER = 83;
const SMALL_WALL = 72;
const ACTIVE = 2;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('/?debug=net&map=test&speed=10&resources=1000');
  return page;
}

const slot = (page: Page, command: string, unit?: number) =>
  page.locator(`[data-testid=command-slot][data-command=${command}]${unit === undefined ? '' : `[data-unit="${unit}"]`}`);

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(shots, name) });
  console.log(`screenshot: ${join(shots, name)}`);
}

/** Build, then the Small Wall (on the build menu's second page when the first has no room), which starts the line mode. */
async function chooseWall(page: Page): Promise<void> {
  await slot(page, 'build').click();
  await expect(slot(page, 'cancel')).toHaveCount(1);
  if ((await slot(page, 'place', SMALL_WALL).count()) === 0) await slot(page, 'more').click();
  await slot(page, 'place', SMALL_WALL).click();
}

async function tilePoint(page: Page, col: number, row: number): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  const at = await page.evaluate(([c, r]) => window.__map!.tileScreenPos(c, r), [col, row] as const);
  return { x: box.x + at.x, y: box.y + at.y };
}

test('the wall line outline and the joined walls show the original art', async ({ browser }) => {
  const host = await open(browser);
  const guest = await open(browser);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await expect(host.getByTestId('player-1')).toContainText('Bob');
  // The Small Wall (tech 11, researched at the Granary in the Tool Age) comes with a Bronze Age start; Reveal Map explores the line's tiles (`check_vis`).
  await host.getByTestId('starting-age').selectOption({ label: 'Bronze Age' });
  await host.getByTestId('reveal-map').check();
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await expect(host.getByTestId('start')).toBeEnabled();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__game !== undefined && window.__game.shownObjects() > 0 && window.__game.packSprites() === window.__game.shownObjects());
    await page.getByTestId('net-debug').evaluate((el) => el.remove());
  }
  mkdirSync(shots, { recursive: true });
  const box = (await host.getByTestId('game-canvas').boundingBox())!;

  const villager = (await host.evaluate(() => window.__game!.units())).find((u) => u.owner === 1 && u.type === VILLAGER)!;
  const at = (await host.evaluate((id) => window.__game!.unitScreenPos(id), villager.id))!;
  await host.mouse.click(box.x + at.x, box.y + at.y - 15);
  await expect.poll(() => host.evaluate(() => window.__game!.selection())).toEqual([villager.id]);
  await chooseWall(host);

  // A line across the gold mines: the segments on them shaded red; right click drops it.
  const a = await tilePoint(host, 13, 10);
  const b = await tilePoint(host, 19, 10);
  await host.mouse.move(a.x, a.y);
  await host.mouse.down();
  await host.mouse.move(b.x, b.y, { steps: 6 });
  await expect.poll(async () => (await host.evaluate(() => window.__game!.ghost()))?.segments?.filter((s) => !s.fits).length).toBeGreaterThan(0);
  await shot(host, 'wall-ghost-blocked.png');
  await host.mouse.click(b.x, b.y, { button: 'right' });
  await host.mouse.up();
  expect(await host.evaluate(() => window.__game!.ghost())).toBeNull();

  // An L line from (12, 7) to (16, 4): the outline in its join facets, then the built walls.
  await chooseWall(host);
  const start = await tilePoint(host, 12, 7);
  const end = await tilePoint(host, 16, 4);
  await host.mouse.move(start.x, start.y);
  await host.mouse.down();
  await host.mouse.move(end.x, end.y, { steps: 8 });
  await expect.poll(async () => (await host.evaluate(() => window.__game!.ghost()))?.segments?.length).toBe(8);
  await shot(host, 'wall-ghost-line.png');
  await host.mouse.up();
  for (const page of [host, guest]) {
    await expect
      .poll(
        () => page.evaluate(([wall, active]) => window.__game!.buildings().filter((w) => w.type === wall && w.state === active).length, [SMALL_WALL, ACTIVE] as const),
        { timeout: 180_000 },
      )
      .toBe(8);
  }
  const facets = await host.evaluate((wall) => window.__game!.buildings().filter((w) => w.type === wall).map((w) => w.facet), SMALL_WALL);
  expect(facets.sort()).toEqual([0, 0, 0, 1, 1, 2, 2, 2]);
  await host.mouse.move(box.x + box.width / 2, box.y + 100);
  await shot(host, 'walls-joined.png');
});
