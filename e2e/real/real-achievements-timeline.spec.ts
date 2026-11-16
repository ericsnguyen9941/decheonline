import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');
test.setTimeout(600_000);

// A built Barracks (12) and Granary (68) and 2000 of each resource: player 1 trains Villagers (83) and reaches the
// Tool Age (101), so the timeline has a changing share and an age line.
const URL = '/?debug=net&map=test&speed=20&resources=2000&buildings=12,68';
const TOWN_CENTER = 109;
const VILLAGER = 83;
const TOOL_AGE = 101;
const DONE = 3;
/** Entries before the game ends: 15 game seconds each. */
const ENTRIES = 16;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

async function menuConfirm(page: Page, item: 'menu-resign' | 'menu-quit'): Promise<void> {
  await page.getByTestId('menu-menu').click();
  await page.getByTestId(item).click();
  await page.getByTestId('popup-yes').click();
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(shots, name) });
  console.log(`screenshot: ${join(shots, name)}`);
}

test('the achievements timeline and the close X in the original art', async ({ browser }) => {
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
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game !== undefined && window.__game.turn() > 5);
  // The debug strip of `?debug=net` covers the screen's top right corner, where the X is.
  for (const page of [host, guest]) await page.getByTestId('net-debug').evaluate((el) => el.remove());
  mkdirSync(shots, { recursive: true });

  const tc = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === TOWN_CENTER)!;
  await host.evaluate(([building, unit]) => window.__game!.issue({ type: 'queue', building, unit, count: 4 }), [tc.id, VILLAGER]);
  await host.waitForFunction((n) => window.__game!.history(1).population.length >= n, 4);
  await host.evaluate(([building, tech]) => window.__game!.issue({ type: 'research', building, tech }), [tc.id, TOOL_AGE]);
  await host.waitForFunction(([t, s]) => window.__game!.techState(t, 1) === s, [TOOL_AGE, DONE] as const);
  await host.waitForFunction((n) => window.__game!.history(1).population.length >= n, ENTRIES);
  console.log('history', JSON.stringify(await host.evaluate(() => [window.__game!.history(1), window.__game!.history(2)])));

  await menuConfirm(guest, 'menu-resign');
  await host.waitForFunction(() => window.__game!.gameResult() !== null);
  await menuConfirm(host, 'menu-quit');
  await expect(host.getByTestId('achievements')).toBeVisible();
  await host.getByTestId('achievements-timeline').click();
  await expect(host.getByTestId('timeline-age')).toHaveText(['Tool Age']);
  await expect(host.getByTestId('timeline-name')).toHaveText(['Alice - Egyptian', 'Bob - Egyptian']);
  await shoot(host, 'achievements-timeline.png');

  await host.getByTestId('achievements-x').click();
  await expect(host.getByTestId('popup-text')).toHaveText('Are you sure you want to quit this game?');
  await shoot(host, 'achievements-x-popup.png');
  await host.getByTestId('popup-yes').click();
  await host.waitForFunction(() => window.__game === undefined);
});
