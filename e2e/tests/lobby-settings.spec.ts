import { expect, test, type Browser, type Page } from '@playwright/test';

// The multiplayer setup screen's settings (docs/spec/lobby.md): the host picks map size, map type and victory, each
// player its civ; both see them live and both games start with them.
const URL = '/?debug=net&speed=20';

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(URL);
  return page;
}

async function pair(browser: Browser): Promise<[Page, Page]> {
  const host = await open(browser);
  const guest = await open(browser);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await expect(host.getByTestId('player-1')).toContainText('Bob');
  return [host, guest];
}

/** The guest readies (the host already did) and the host starts; waits for both game screens. */
async function startAndWait(host: Page, guest: Page): Promise<void> {
  await guest.getByTestId('ready').click();
  await expect(host.getByTestId('start')).toBeEnabled();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) await page.waitForFunction(() => window.__map !== undefined && window.__game?.minimapPoint(0, 0) != null);
}

/** The setup screen's summary lines. */
const summary = (page: Page) => page.getByTestId('settings-summary').locator('li');

const setup = (page: Page) =>
  page.evaluate(() => ({ ...window.__game!.gameSetup(), width: window.__map!.width, height: window.__map!.height, map: window.__map!.mapHash }));

test("the host's map size, map type and victory and each player's civ show live on both screens and are what both games play", async ({ browser }) => {
  const [host, guest] = await pair(browser);
  // The original's multiplayer defaults (scr_mps.cpp init_vars); the e2e server starts every player Egyptian.
  await expect(summary(guest)).toHaveText(['Map Size: Large', 'Map Type: Inland', 'Victory: Standard', 'Population Limit: 50']);
  await expect(host.getByTestId('map-size')).toHaveValue('144');
  await expect(host.getByTestId('civ-0')).toHaveValue('1');
  await expect(guest.getByTestId('civ-0')).toHaveText('Egyptian');
  // The guest has no setting controls; only its own civ.
  await expect(guest.getByTestId('map-size')).toHaveCount(0);
  await expect(guest.getByTestId('civ-0')).not.toHaveJSProperty('tagName', 'SELECT');

  await host.getByTestId('map-size').selectOption('96');
  await host.getByTestId('map-type').selectOption({ label: 'Hill Country' });
  await host.getByTestId('victory').selectOption({ label: 'Time Limit' });
  // Picking Time Limit selects 9,000 years (scr_set.cpp action); the host picks 3,000.
  await expect(host.getByTestId('victory-amount')).toHaveValue('9000');
  await host.getByTestId('victory-amount').selectOption('3000');
  await host.getByTestId('civ-0').selectOption({ label: 'Shang' });
  await guest.getByTestId('civ-1').selectOption({ label: 'Yamato' });

  await expect(summary(guest)).toHaveText(['Map Size: Small', 'Map Type: Hill Country', 'Victory: Time Limit (3000)', 'Population Limit: 50']);
  await expect(guest.getByTestId('civ-0')).toHaveText('Shang');
  await expect(host.getByTestId('civ-1')).toHaveText('Yamato');

  // Ready locks a player's civ and the host's settings: the host sees its summary.
  await host.getByTestId('ready').click();
  await expect(summary(host)).toHaveText(['Map Size: Small', 'Map Type: Hill Country', 'Victory: Time Limit (3000)', 'Population Limit: 50']);
  await expect(host.getByTestId('civ-0')).toHaveText('Shang');

  await startAndWait(host, guest);
  const games = await Promise.all([host, guest].map(setup));
  for (const game of games) {
    expect(game).toMatchObject({ civs: [0, 10, 11], victory: { type: 2 }, width: 96, height: 96, map: games[0]!.map });
    // The 3,000-year clock started (it runs down 2 years a second, victory.md §9).
    expect(game.victory.countdown).toBeGreaterThan(2500);
    expect(game.victory.countdown).toBeLessThanOrEqual(3000);
  }

  for (const page of [host, guest]) await page.waitForFunction(() => window.__game!.turn() > 20);
  const hashes = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game!.hash(20))));
  expect(hashes[0]).toBeDefined();
  expect(hashes[0]).toBe(hashes[1]);
});

test('a Random civ becomes the same civ on both clients', async ({ browser }) => {
  const [host, guest] = await pair(browser);
  await host.getByTestId('map-size').selectOption('72');
  await guest.getByTestId('civ-1').selectOption({ label: 'Random' });
  await expect(host.getByTestId('civ-1')).toHaveText('Random');
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game !== undefined);
  const games = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game!.gameSetup().civs)));
  expect(games[0]![1]).toBe(1);
  expect(games[0]![2]).toBeGreaterThanOrEqual(1);
  expect(games[0]![2]).toBeLessThanOrEqual(16);
  expect(games[1]).toEqual(games[0]);
});
