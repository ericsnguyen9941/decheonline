import { expect, test, type Browser, type Page } from '@playwright/test';
import { walkOntoHill } from '../hills';

// A game without `map=test`: the random map the seed makes (docs/spec/random-maps.md), at the multiplayer defaults.
const URL = '/?debug=net&speed=20';
const TOWN_CENTER = 109;

async function startGame(browser: Browser): Promise<[Page, Page]> {
  const open = async () => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(URL);
    return page;
  };
  const host = await open();
  const guest = await open();
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
  for (const page of [host, guest]) await page.waitForFunction(() => window.__map !== undefined && window.__game?.minimapPoint(0, 0) != null);
  return [host, guest];
}

/** The page's own Town Center. */
const ownCentre = (page: Page) =>
  page.evaluate((tc) => {
    const me = window.__game!.player();
    return window.__game!.buildings().find((b) => b.owner === me && b.type === tc)!;
  }, TOWN_CENTER);

test('both players build the same 144-tile random map, start on their own Town Center and stay in sync', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  const maps = await Promise.all([host, guest].map((p) => p.evaluate(() => ({ width: window.__map!.width, height: window.__map!.height, hash: window.__map!.mapHash }))));
  expect(maps[0]).toEqual({ width: 144, height: 144, hash: maps[0]!.hash });
  expect(maps[1]).toEqual(maps[0]);

  const centres = await Promise.all([host, guest].map(ownCentre));
  expect(centres.map((c) => c.owner)).toEqual([1, 2]);
  expect([centres[0]!.x, centres[0]!.y]).not.toEqual([centres[1]!.x, centres[1]!.y]);
  // The camera starts on the player's own Town Center: it is on screen, and so is its spot on the minimap.
  for (const [page, centre] of [[host, centres[0]!], [guest, centres[1]!]] as const) {
    const box = (await page.getByTestId('game-canvas').boundingBox())!;
    const at = (await page.evaluate((id) => window.__game!.objectScreenPos(id), centre.id))!;
    expect(at.x).toBeGreaterThan(0);
    expect(at.x).toBeLessThan(box.width);
    expect(at.y).toBeGreaterThan(0);
    expect(at.y).toBeLessThan(box.height);
    expect(await page.evaluate(([x, y]) => window.__game!.minimapPoint(Math.floor(x!), Math.floor(y!)), [centre.x, centre.y])).not.toBeNull();
  }

  for (const page of [host, guest]) await page.waitForFunction(() => window.__game!.turn() > 30);
  const hashes = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game!.hash(30))));
  expect(hashes[0]).toBeDefined();
  expect(hashes[0]).toBe(hashes[1]);
});

test('a right click on a raised tile walks a Villager up the hill, drawn at its height, and a click on it there selects it', async ({ browser }) => {
  const [host] = await startGame(browser);
  const walk = await walkOntoHill(host);
  console.log(`hill walk: ${JSON.stringify(walk)}`);
  // On a plateau tile the ground is the tile's height: 16 px per level.
  expect(walk.lift).toBeCloseTo(16 * walk.hill.height, 0);
});
