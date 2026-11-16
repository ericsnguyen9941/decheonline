import { expect, test, type Browser, type Page } from '@playwright/test';

// The Game Settings dialog's start settings (docs/spec/lobby.md §2): the host picks Death Match or a Random Map, the
// Starting Age, the Resources, Reveal Map and Full Tech Tree; the guest sees them in its summary and both games start
// with them (tworld.cpp:796-855, rmm_tdbc.cpp:284-293, tribegam.cpp:3024-3033).
const URL = '/?debug=net&speed=20';
const VILLAGER = 83;
const TOWN_CENTER = 109;
/** Gaia's ruins and relics: a lone Villager next to one takes it before the objects are read (`artifactIdle`). */
const ARTIFACTS = [158, 159];
const [TOOL_AGE, BRONZE_AGE, IRON_AGE] = [101, 102, 103];

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

/** Both ready, the host starts; waits for both game screens. */
async function start(host: Page, guest: Page): Promise<void> {
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await expect(host.getByTestId('start')).toBeEnabled();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) await page.waitForFunction(() => window.__map !== undefined && window.__game?.minimapPoint(0, 0) != null);
}

const summary = (page: Page) => page.getByTestId('settings-summary').locator('li');
const setup = (page: Page) => page.evaluate(() => ({ ...window.__game!.gameSetup(), tiles: window.__map!.width * window.__map!.height, map: window.__map!.mapHash }));
const stockpiles = (page: Page) => page.evaluate(() => [1, 2].map((p) => window.__game!.resources(p)));

/** Both clients' hash of turn 20: the same game. */
async function sameGame(host: Page, guest: Page): Promise<void> {
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game!.turn() > 20);
  const hashes = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game!.hash(20))));
  expect(hashes[0]).toBeDefined();
  expect(hashes[0]).toBe(hashes[1]);
}

test('Death Match in the Bronze Age with Reveal Map and Full Tech Tree: the guest sees it, both games start with it', async ({ browser }) => {
  const [host, guest] = await pair(browser);
  // The dialog's lines and the multiplayer defaults (scr_set.cpp:148-165, 616-623; scr_mps.cpp:436-453).
  await expect(host.getByTestId('game').locator('option')).toHaveText(['Random Map', 'Death Match']);
  await expect(host.getByTestId('starting-age').locator('option')).toHaveText(['Default', 'Nomad', 'Stone Age', 'Tool Age', 'Bronze Age', 'Iron Age']);
  await expect(host.getByTestId('resources').locator('option')).toHaveText(['Default', 'Medium', 'High']);
  await expect(host.getByTestId('reveal-map')).not.toBeChecked();
  await expect(host.getByTestId('full-tech-tree')).not.toBeChecked();
  for (const id of ['game', 'starting-age', 'resources', 'reveal-map', 'full-tech-tree']) await expect(guest.getByTestId(id)).toHaveCount(0);

  await host.getByTestId('map-size').selectOption('72');
  await host.getByTestId('resources').selectOption({ label: 'High' });
  await host.getByTestId('victory').selectOption({ label: 'Conquest' });
  // Death Match: Resources inactive and stored Default (scr_set.cpp:746-750, 786-792), the victory line back to the first.
  await host.getByTestId('game').selectOption({ label: 'Death Match' });
  await expect(host.getByTestId('resources')).toBeDisabled();
  await expect(host.getByTestId('resources')).toHaveValue('0');
  await expect(host.getByTestId('victory')).toHaveValue('0');
  await host.getByTestId('starting-age').selectOption({ label: 'Bronze Age' });
  await host.getByTestId('reveal-map').check();
  await host.getByTestId('full-tech-tree').check();

  const lines = [
    'Scenario: Death Match',
    'Map Size: Tiny',
    'Map Type: Inland',
    'Victory: Standard',
    'Age: Bronze Age',
    'Resources: Default',
    'Fixed Positions: Yes',
    'Reveal Map: Yes',
    'Full Tech Tree: Yes',
    'Enable Cheating: No',
    'Path Finding: Default',
    'Population Limit: 50',
  ];
  await expect(summary(guest)).toHaveText(lines);
  await start(host, guest);

  const games = await Promise.all([host, guest].map(setup));
  for (const game of games) {
    expect(game.map).toBe(games[0]!.map);
    for (const p of [1, 2]) {
      // The Town Center and 3 Villagers; the Tool and Bronze Ages done, not the Iron; Full Tech Tree disables only 118.
      expect(game.objects[p]!.filter((t) => t === TOWN_CENTER || t === VILLAGER).sort((a, b) => a - b)).toEqual([VILLAGER, VILLAGER, VILLAGER, TOWN_CENTER]);
      expect(game.techsDone[p]).toEqual(expect.arrayContaining([TOOL_AGE, BRONZE_AGE]));
      expect(game.techsDone[p]).not.toContain(IRON_AGE);
      expect(game.explored[p]).toBe(game.tiles);
    }
  }
  // Death Match's stockpile (tworld.cpp:833-840), less what the players spent so far: nothing is spent by default.
  for (const page of [host, guest]) expect(await stockpiles(page)).toEqual([0, 0].map(() => ({ food: 20000, wood: 20000, gold: 10000, stone: 5000 })));
  await sameGame(host, guest);
});

test('Nomad with High resources: one Villager and no Town Center each, 1000 food and wood, 750 stone', async ({ browser }) => {
  const [host, guest] = await pair(browser);
  await host.getByTestId('map-size').selectOption('72');
  await host.getByTestId('starting-age').selectOption({ label: 'Nomad' });
  await host.getByTestId('resources').selectOption({ label: 'High' });
  await expect(summary(guest)).toHaveText([
    'Scenario: Random Map',
    'Map Size: Tiny',
    'Map Type: Inland',
    'Victory: Standard',
    'Age: Nomad',
    'Resources: High',
    'Fixed Positions: Yes',
    'Reveal Map: No',
    'Full Tech Tree: No',
    'Enable Cheating: No',
    'Path Finding: Default',
    'Population Limit: 50',
  ]);
  await start(host, guest);
  const games = await Promise.all([host, guest].map(setup));
  for (const game of games) {
    expect(game.map).toBe(games[0]!.map);
    expect(game.objects.slice(1).map((types) => types.filter((t) => !ARTIFACTS.includes(t)))).toEqual([[VILLAGER], [VILLAGER]]);
    expect(game.techsDone[1]).not.toContain(TOOL_AGE);
    expect(game.explored[1]).toBeLessThan(game.tiles / 10);
  }
  for (const page of [host, guest]) expect(await stockpiles(page)).toEqual([0, 0].map(() => ({ food: 1000, wood: 1000, gold: 0, stone: 750 })));
  await sameGame(host, guest);
});
