import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const root = join(import.meta.dirname, '..', '..', 'assets-local');
const shots = join(root, 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

// Every player has 1 of each resource, so a House cannot be paid for, and a Priest above its Villagers.
const URL = '/?debug=net&map=test&speed=4&units=125&resources=1';
const PRIEST = 125;
const VILLAGER = 83;
const BUILDER = 118;
const HOUSE = 70;
const TOWN_CENTER = 109;
/** `TMessagePanel::ErrorColor` (a can't-do message) and the 0x56 `command_building` shows its refusal in. */
const ERROR_COLOR = 0x55;
const REFUSAL_COLOR = 0x56;

const pack = { palette: JSON.parse(readFileSync(join(root, 'pack', 'palette.json'), 'utf8')).rgb as number[] };
const strings = () => JSON.parse(readFileSync(join(root, 'pack', 'manifest.json'), 'utf8')).strings as Record<string, string>;
/** The pack's palette entry as the CSS colour the browser reports. */
const css = (i: number) => `rgb(${pack.palette[i * 3]}, ${pack.palette[i * 3 + 1]}, ${pack.palette[i * 3 + 2]})`;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  const path = join(shots, name);
  await page.screenshot({ path });
  console.log(`screenshot: ${path}`);
}

const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const slot = (page: Page, command: string, attr = '') => page.locator(`[data-testid=command-slot][data-command=${command}]${attr}`);
const message = (page: Page) => page.getByTestId('hud-message');
const colour = (page: Page) => message(page).evaluate((e) => getComputedStyle(e).color);

/** Selects one of the player's idle Villagers (one behind a building cannot be clicked: the next is tried). */
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

test.setTimeout(600_000);

// The 8 s each stays is `command-panel.test.ts` (wall-clock waits here would race the screenshots on a loaded machine).
test('real pack: a can’t-do message and a refusal show the original text, in the original colours', async ({ browser }) => {
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
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  await host.waitForFunction(() => window.__game?.selection() != null && window.__map?.source === 'pack');
  const text = strings();

  // A can't-do: the host's Priest told to convert the guest's Town Center (STRING_ID 0xBEA).
  const priest = (await host.evaluate(() => window.__game!.units())).find((u) => u.owner === 1 && u.type === PRIEST)!;
  const tc = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 2 && b.type === TOWN_CENTER)!;
  await host.evaluate(([p, t, x, y]) => window.__game!.issueWork([p], t, x, y), [priest.id, tc.id, tc.x, tc.y] as const);
  await expect(message(host)).toHaveText(text[0xbea]!);
  expect(text[0xbea]).toBe('Town Centers cannot be converted.');
  expect(await colour(host)).toBe(css(ERROR_COLOR));
  await shot(host, 'refusal-messages-cantdo.png');

  // A refusal: a Villager's House with 1 wood (STRING_ID 3002, not enough wood), a BadMessage in 0x56.
  await selectVillager(host);
  await slot(host, 'build').click();
  await slot(host, 'place', `[data-unit="${HOUSE}"]`).click();
  await expect(message(host)).toHaveText(text[3002]!);
  expect(text[3002]).toBe('Not enough wood.');
  expect(await colour(host)).toBe(css(REFUSAL_COLOR));
  expect(css(REFUSAL_COLOR)).not.toBe('rgb(255, 255, 255)');
  await shot(host, 'refusal-messages-refusal.png');
});
