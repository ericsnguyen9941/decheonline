import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show the pack's strings and game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('/?debug=net&speed=2');
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(shots, name) });
  console.log(`screenshot: ${join(shots, name)}`);
}

/** The lobby's choices: the host's map size, map type and victory, each player's civ (labels from the pack). */
interface Choice {
  size: string;
  type: string;
  victory: string;
  civs: [string, string];
}

/** A 2-player invite-code game started with `choice`; returns both pages once each has drawn its start. */
async function playGame(browser: Browser, choice: Choice, lobbyShot?: string): Promise<[Page, Page]> {
  const host = await open(browser);
  const guest = await open(browser);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await expect(host.getByTestId('player-1')).toContainText('Bob');
  await host.getByTestId('map-size').selectOption({ label: choice.size });
  await host.getByTestId('map-type').selectOption({ label: choice.type });
  await host.getByTestId('victory').selectOption({ label: choice.victory });
  await host.getByTestId('civ-0').selectOption({ label: choice.civs[0] });
  await guest.getByTestId('civ-1').selectOption({ label: choice.civs[1] });
  // Both screens show the other's pick and the host's settings.
  await expect(guest.getByTestId('civ-0')).toHaveText(choice.civs[0]);
  await expect(host.getByTestId('civ-1')).toHaveText(choice.civs[1]);
  await expect(guest.getByTestId('settings-summary').locator('li')).toHaveText([
    'Scenario: Random Map',
    `Map Size: ${choice.size}`,
    `Map Type: ${choice.type}`,
    new RegExp(`^Victory: ${choice.victory}`),
    'Age: Default',
    'Resources: Default',
    'Fixed Positions: Yes',
    'Reveal Map: No',
    'Full Tech Tree: No',
    'Enable Cheating: No',
    'Path Finding: Default',
    'Population Limit: 50',
  ]);
  if (lobbyShot) {
    await shot(host, `${lobbyShot}-host.png`);
    await shot(guest, `${lobbyShot}-guest.png`);
  }
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__map?.source === 'pack' && window.__game?.minimapPoint(0, 0) != null);
    await page.waitForFunction(() => window.__game!.packSprites() > 0 && window.__game!.packSprites() === window.__game!.shownObjects() && window.__game!.turn() > 2);
  }
  return [host, guest];
}

const state = (page: Page) =>
  page.evaluate(() => ({ ...window.__game!.gameSetup(), map: window.__map!.mapHash, width: window.__map!.width }));

test.setTimeout(400_000);

test('two games with different lobby settings start on different maps and civs and stay in sync', async ({ browser }) => {
  mkdirSync(shots, { recursive: true });
  const choices: Choice[] = [
    { size: 'Small', type: 'Hill Country', victory: 'Conquest', civs: ['Shang', 'Yamato'] },
    { size: 'Medium', type: 'Continental', victory: 'Time Limit', civs: ['Roman', 'Random'] },
  ];
  const games: Awaited<ReturnType<typeof state>>[] = [];
  for (const [i, choice] of choices.entries()) {
    const [host, guest] = await playGame(browser, choice, `lobby-settings-${i + 1}`);
    const both = await Promise.all([host, guest].map(state));
    console.log(`game ${i + 1}: ${JSON.stringify(both)}`);
    expect(both[1]!.map).toBe(both[0]!.map);
    expect(both[1]!.civs).toEqual(both[0]!.civs);
    for (const page of [host, guest]) await page.waitForFunction(() => window.__game!.turn() > 40);
    const hashes = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game!.hash(40))));
    console.log(`game ${i + 1}: hash at turn 40 ${hashes.map((h) => h?.toString(16)).join(' / ')}`);
    expect(hashes[0]).toBeDefined();
    expect(hashes[0]).toBe(hashes[1]);
    await shot(host, `lobby-settings-${i + 1}-game-p1.png`);
    games.push(both[0]!);
    await host.context().close();
    await guest.context().close();
  }
  expect(games.map((g) => g.width)).toEqual([96, 120]);
  expect(games[0]!.civs).toEqual([0, 10, 11]);
  expect(games[1]!.civs[1]).toBe(13);
  expect(games[1]!.victory.type).toBe(2);
  expect(games[0]!.map).not.toBe(games[1]!.map);
});
