import { expect, test, type Browser, type Page } from '@playwright/test';

// speed=20 runs the lockstep clock 20x faster; resources=3000 pays for the techs and units; houses=2 gives population
// room; buildings= starts every player with a built Barracks, Archery Range, Stable and Academy (both clients ask for
// the same, so their games stay the same).
const URL = '/?debug=net&map=test&speed=20&resources=3000&houses=2&buildings=12,87,101,0';

// Master ids (empires.dat): Barracks, Archery Range, Stable, Academy; Short Swordsman, Improved Bowman, Camel Rider,
// Hoplite. Techs: Short Sword (enables 75), Broad Sword (copies Broad Swordsman 76 into 75), Improved Bow (enables 5).
const BARRACKS = 12;
const RANGE = 87;
const STABLE = 101;
const ACADEMY = 0;
const SHORT_SWORDSMAN = 75;
const IMPROVED_BOWMAN = 5;
const CAMEL_RIDER = 338;
const HOPLITE = 93;
const SHORT_SWORD = 64;
const BROAD_SWORD = 65;
const IMPROVED_BOW = 56;
/** Civ ids (empires.dat). */
const CIV_PHOENICIAN = 7;
/** Tech state done. */
const DONE = 3;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

/**
 * Host creates a Bronze Age game (the Academy's age) and plays Phoenician (which has Broad Sword and the Academy;
 * Egyptians and Greeks have no Broad Sword), guest joins by code and plays Egyptian, both ready, host starts.
 */
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
  await host.getByTestId('civ-0').selectOption(String(CIV_PHOENICIAN));
  await host.getByTestId('starting-age').selectOption({ label: 'Bronze Age' });
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await expect(host.getByTestId('start')).toBeEnabled();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game?.selection() != null && window.__map !== undefined);
  return [host, guest];
}

const slot = (page: Page, command: string, attr: string) => page.locator(`[data-testid=command-slot][data-command=${command}]${attr}`);

/**
 * Centres the view on this player's building of `type` and left clicks it; resolves with its id once it is the selection.
 * Esc first: every building is clicked at the view's centre, and a second click on the same spot with something
 * selected picks past it (`clickAt`).
 */
async function selectBuilding(page: Page, type: number): Promise<number> {
  const player = await page.evaluate(() => window.__game!.player());
  const b = (await page.evaluate(() => window.__game!.buildings())).find((x) => x.owner === player && x.type === type)!;
  await page.evaluate(([x, y]) => window.__map!.centerOnTile(Math.floor(x), Math.floor(y)), [b.x, b.y] as const);
  await page.waitForFunction((id) => window.__game!.objectScreenPos(id) !== null, b.id);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__game!.selection())).toEqual([]);
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  const at = (await page.evaluate((id) => window.__game!.objectScreenPos(id), b.id))!;
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await expect.poll(() => page.evaluate(() => window.__game!.selection())).toEqual([b.id]);
  return b.id;
}

/** Clicks the research button of `tech` on the selected building and waits until both clients have it done. */
async function research(page: Page, pages: Page[], tech: number): Promise<void> {
  const player = await page.evaluate(() => window.__game!.player());
  await slot(page, 'research', `[data-tech="${tech}"]`).click();
  for (const p of pages) await p.waitForFunction(([t, pl, done]) => window.__game!.techState(t, pl) === done, [tech, player, DONE] as const);
}

/**
 * Clicks the train button of `unit` on the selected building (or, given `building`, sends its `queue` command) and waits
 * until both clients have one for this player.
 */
async function train(page: Page, pages: Page[], unit: number, building?: number): Promise<number> {
  const player = await page.evaluate(() => window.__game!.player());
  if (building === undefined) await slot(page, 'train', `[data-unit="${unit}"]`).click();
  else await page.evaluate(([b, u]) => window.__game!.issue({ type: 'queue', building: b, unit: u, count: 1 }), [building, unit] as const);
  for (const p of pages) await p.waitForFunction(([u, pl]) => window.__game!.units().some((x) => x.owner === pl && x.type === u), [unit, player] as const);
  return (await page.evaluate(() => window.__game!.units())).find((x) => x.owner === player && x.type === unit)!.id;
}

// The lockstep paces steps to the clients' frame times (turn-timing.md §8.1): the waits are on state.
test.setTimeout(600_000);

test('two players train at the Barracks, Range, Stable and Academy and research Broad Sword; both clients show it', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  const both = [host, guest];

  // Host: the Barracks researches Short Sword and trains a Short Swordsman, the Academy trains a Hoplite. The synthetic
  // pack's unit 0 is not the Academy but a record a click cannot select (`select_level` below 2), so the Hoplite is
  // queued by command; the real suite (e2e/real/real-land-units.spec.ts) clicks the Academy's button.
  await selectBuilding(host, BARRACKS);
  await research(host, both, SHORT_SWORD);
  const swordsman = await train(host, both, SHORT_SWORDSMAN);
  const academy = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === ACADEMY)!;
  await train(host, both, HOPLITE, academy.id);

  // Guest: the Range researches Improved Bow and trains an Improved Bowman, the Stable trains a Camel Rider.
  await selectBuilding(guest, RANGE);
  await research(guest, both, IMPROVED_BOW);
  await train(guest, both, IMPROVED_BOWMAN);
  await selectBuilding(guest, STABLE);
  await train(guest, both, CAMEL_RIDER);

  // The upgrade: Broad Sword at the host's Barracks copies the Broad Swordsman into unit 75, so the Short Swordsman
  // already trained takes its name (the original's internal name with the synthetic pack, which has no strings).
  const before = await host.evaluate((id) => window.__game!.objectName(id), swordsman);
  await selectBuilding(host, BARRACKS);
  await research(host, both, BROAD_SWORD);
  for (const p of both) await expect.poll(() => p.evaluate((id) => window.__game!.objectName(id), swordsman)).not.toBe(before);
  const names = await Promise.all(both.map((p) => p.evaluate((id) => window.__game!.objectName(id), swordsman)));
  expect(names[1]).toBe(names[0]);

  // Both clients see the same four units, and their games agree on the hash of a turn both have run.
  const trained = (p: Page) =>
    p.evaluate(
      (types) =>
        window
          .__game!.units()
          .filter((u) => types.includes(u.type))
          .map((u) => `${u.owner}:${u.type}`)
          .sort(),
      [SHORT_SWORDSMAN, IMPROVED_BOWMAN, CAMEL_RIDER, HOPLITE],
    );
  const expected = [`1:${SHORT_SWORDSMAN}`, `1:${HOPLITE}`, `2:${IMPROVED_BOWMAN}`, `2:${CAMEL_RIDER}`].sort();
  for (const p of both) expect(await trained(p)).toEqual(expected);
  const turns = await Promise.all(both.map((p) => p.evaluate(() => window.__game!.turn())));
  const turn = Math.max(...turns) + 2;
  for (const p of both) await p.waitForFunction((t) => window.__game!.turn() > t, turn);
  const [a, b] = await Promise.all(both.map((p) => p.evaluate((t) => window.__game!.hash(t), turn)));
  expect(a).toBeDefined();
  expect(a).toBe(b);
  console.log(`turn ${turn} hash ${a}: ${expected.join(' ')} on both clients; unit ${swordsman} "${before}" -> "${names[0]}" on both`);
});
