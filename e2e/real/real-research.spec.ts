import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

const VILLAGER = 83;
const BUILDER = 118;
const HOUSE = 70;
const TOWN_CENTER = 109;
const BARRACKS = 12;
const GRANARY = 68;
const RANGE = 87;
const TOOL_AGE = 101;
const ACTIVE = 2;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('/?debug=net&map=test&speed=5&resources=2000');
  return page;
}

const slot = (page: Page, command: string, attr = '') => page.locator(`[data-testid=command-slot][data-command=${command}]${attr}`);
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(shots, name) });
  console.log(`screenshot: ${join(shots, name)}`);
}

async function select(page: Page, id: number, unit = false): Promise<void> {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  const at = unit ? (await page.evaluate((i) => window.__game!.unitScreenPos(i), id))! : (await page.evaluate((i) => window.__game!.objectScreenPos(i), id))!;
  await page.mouse.click(box.x + at.x, box.y + at.y - (unit ? 15 : 0));
  await expect.poll(() => page.evaluate(() => window.__game!.selection())).toEqual([id]);
}

/** Selects one of player 1's idle villagers (one standing behind a building cannot be clicked: the next is tried). */
async function selectVillager(page: Page): Promise<void> {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  const own = (await page.evaluate(() => window.__game!.units())).filter((u) => u.owner === 1 && !u.moving && (u.type === VILLAGER || u.type === BUILDER));
  for (const u of own) {
    const at = (await page.evaluate((i) => window.__game!.unitScreenPos(i), u.id))!;
    await page.mouse.click(box.x + at.x, box.y + at.y - 15);
    await frames(page);
    if (JSON.stringify(await page.evaluate(() => window.__game!.selection())) === JSON.stringify([u.id])) return;
  }
  throw new Error('no villager could be selected');
}

/** An idle villager builds `unit` on the first free tile around the Town Center; resolves with the finished building's id. */
async function build(page: Page, unit: number): Promise<number> {
  const before = new Set((await page.evaluate(() => window.__game!.buildings())).map((b) => b.id));
  await selectVillager(page);
  await slot(page, 'build').click();
  await slot(page, 'place', `[data-unit="${unit}"]`).click();
  const tc = (await page.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === TOWN_CENTER)!;
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
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
  await page.waitForFunction(([type, seen]) => window.__game!.buildings().some((b) => b.type === type && !seen.includes(b.id)), [unit, [...before]] as const);
  const id = (await page.evaluate(() => window.__game!.buildings())).find((b) => b.type === unit && !before.has(b.id))!.id;
  await page.waitForFunction(([b, active]) => window.__game!.buildings().find((x) => x.id === b)?.state === active, [id, ACTIVE] as const);
  return id;
}

test('a research button and its message, the age-up in progress and a Tool Age town show the original art', async ({ browser }) => {
  test.setTimeout(600_000);
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
  await host.getByTestId('net-debug').evaluate((el) => el.remove());

  // Two Stone Age buildings open the Tool Age; a House shows the age's sprite change later.
  await build(host, HOUSE);
  await build(host, BARRACKS);
  await build(host, GRANARY);
  const tc = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === TOWN_CENTER)!;
  await host.waitForFunction((t) => window.__game!.techState(t) === 1, TOOL_AGE);

  // The Town Center's Tool Age button: btntech (50729) in a research border, the message its text and cost.
  await select(host, tc.id);
  const toolAge = slot(host, 'research', `[data-tech="${TOOL_AGE}"]`);
  await expect(toolAge).toHaveCount(1);
  expect(await toolAge.locator('.hud-slot-icon').evaluate((e) => getComputedStyle(e).backgroundImage)).toContain('/assets/sprites/interface/50729.o1.png');
  await toolAge.hover();
  await expect(host.getByTestId('hud-message')).toHaveText('Advance to Tool Age: Requires 2 Stone Age buildings (Food: 500)');
  await shot(host, 'research-hover.png');

  // Researching: Stop alone in slot 0 and the progress in the panel.
  await toolAge.click();
  await host.waitForFunction((id) => (window.__game!.buildings().find((b) => b.id === id)?.research?.progress ?? 0) >= 20, tc.id);
  await expect(slot(host, 'stop')).toHaveCount(1);
  await expect(host.getByTestId('object-item')).toHaveText(/^\d+%$/);
  const box = (await host.getByTestId('game-canvas').boundingBox())!;
  await host.mouse.move(box.x + box.width / 2, box.y + 200);
  await shot(host, 'research-progress.png');

  // The Tool Age: Town Center facet 2, the House in House1's art, the age in the top strip; an Archery Range, and the
  // villager's build menu with the Tool Age buildings.
  await host.waitForFunction((t) => window.__game!.techState(t) === 3, TOOL_AGE);
  await expect(host.getByTestId('age')).toHaveText('Tool Age');
  await build(host, RANGE);
  await selectVillager(host);
  await slot(host, 'build').click();
  await expect(slot(host, 'place', `[data-unit="${RANGE}"]`)).toHaveCount(1);
  await host.mouse.move(box.x + box.width / 2, box.y + 200);
  await frames(host);
  await shot(host, 'tool-age-town.png');
});
