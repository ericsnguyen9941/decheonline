import { expect, test, type Browser, type Page } from '@playwright/test';

// speed=20 runs the lockstep clock 20x faster; resources=500 pays for the Farm; market=1 gives every player a built
// Market (its tech enables the Farm) without the Tool Age first. Both clients ask for the same, so their games agree.
const URL = '/?debug=net&map=test&speed=20&resources=500&market=1';

// Master ids (empires.dat): Villager, Builder, Farmer, Town Center, Farm, Dead_Farm; graphic 468 the Farmer at work.
const VILLAGER = 83;
const BUILDER = 118;
const FARMER = 259;
const TOWN_CENTER = 109;
const FARM = 50;
const DEAD_FARM = 244;
const MAN_FARM = 468;
const ACTIVE = 2;
/** `TRIBE_Game::sounds` index of farmdie.wav. */
const FARM_DIED = 16;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

/** Host creates, guest joins by code, both ready, host starts; resolves once both have drawn the map. */
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
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game?.selection() != null && window.__map !== undefined);
  return [host, guest];
}

const slot = (page: Page, command: string, attr?: string) =>
  page.locator(`[data-testid=command-slot][data-command=${command}]${attr === undefined ? '' : attr}`);
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function canvasBox(page: Page) {
  return (await page.getByTestId('game-canvas').boundingBox())!;
}

/** Left-click object `id` (a unit by its feet, else its centre) and check it is the selection. */
async function select(page: Page, id: number, unit = false): Promise<void> {
  const box = await canvasBox(page);
  const at = unit
    ? (await page.evaluate((i) => window.__game!.unitScreenPos(i), id))!
    : (await page.evaluate((i) => window.__game!.objectScreenPos(i), id))!;
  await page.mouse.click(box.x + at.x, box.y + at.y - (unit ? 15 : 0));
  await expect.poll(() => page.evaluate(() => window.__game!.selection())).toEqual([id]);
}

// A Farm holds 250 food and makes 0.4 a second: about 625 s of game time, 31 s at speed 20 on an idle machine. The
// lockstep paces steps to the clients' frame times (turn-timing.md §8.1), so a loaded machine is slower.
test.setTimeout(600_000);

test('a Villager builds a Farm from the build menu, farms it, the food goes up, and the used-up Farm dies with farmdie.wav', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  const both = [host, guest];
  expect(await host.evaluate(() => window.__game!.resources(1).food)).toBe(500);

  // The build menu offers the Farm (the Market enabled it); its button places a 3 × 3 ghost near the Town Center.
  const own = (await host.evaluate(() => window.__game!.units())).filter((u) => u.owner === 1 && u.type === VILLAGER && !u.moving);
  const villager = own[0]!;
  await select(host, villager.id, true);
  await slot(host, 'build').click();
  const farmButton = slot(host, 'place', `[data-unit="${FARM}"]`);
  await expect(farmButton).toHaveCount(1);
  await farmButton.click();
  const tc = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === TOWN_CENTER)!;
  const box = await canvasBox(host);
  let placed = false;
  // Below the Town Center first: the Market stands to its left.
  for (const [dx, dy] of [[0, 4], [1, 4], [0, 5], [3, 4], [-1, 5]] as const) {
    const spot = await host.evaluate(([c, r]) => window.__map!.tileScreenPos(c, r), [Math.floor(tc.x) + dx, Math.floor(tc.y) + dy] as const);
    if (spot.x < 40 || spot.x > box.width - 40 || spot.y < 80 || spot.y > box.height - 220) continue;
    await host.mouse.move(box.x + spot.x, box.y + spot.y);
    await frames(host);
    if (!(await host.evaluate(() => window.__game!.ghost()?.fits))) continue;
    await host.mouse.click(box.x + spot.x, box.y + spot.y);
    placed = true;
    break;
  }
  expect(placed).toBe(true);
  for (const p of both) await p.waitForFunction((f) => window.__game!.buildings().some((b) => b.owner === 1 && b.type === f), FARM);
  const farm = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === FARM)!;
  expect(await host.evaluate(() => window.__game!.resources(1).wood)).toBe(500 - 75);

  // The Villager builds it as a Builder, then, once the Farm grows food, becomes its Farmer and works it.
  await host.waitForFunction(([id, type]) => window.__game!.units().some((u) => u.id === id && u.type === type), [villager.id, BUILDER] as const);
  for (const p of both) await p.waitForFunction(([id, active]) => window.__game!.buildings().find((b) => b.id === id)?.state === active, [farm.id, ACTIVE] as const);
  for (const p of both) await p.waitForFunction(([id, type]) => window.__game!.units().some((u) => u.id === id && u.type === type), [villager.id, FARMER] as const);
  await host.waitForFunction(([id, g]) => window.__game!.objects().some((o) => o.id === id && o.graphic === g), [villager.id, MAN_FARM] as const);

  // Food goes up as the Farmer carries it to the Town Center; the Farm's panel shows the food it has left.
  await host.waitForFunction(() => window.__game!.resources(1).food > 500);
  await select(host, farm.id);
  await expect(host.getByTestId('object-item')).toHaveText(/^\d+$/);
  const left = Number(await host.getByTestId('object-item').textContent());
  expect(left).toBeGreaterThan(0);
  expect(left).toBeLessThan(250);

  // Used up, the Farm dies into a Dead_Farm; its owner hears farmdie.wav, the other player does not.
  for (const p of both) await p.waitForFunction((id) => !window.__game!.buildings().some((b) => b.id === id), farm.id);
  await host.waitForFunction((f) => window.__game!.objects().some((o) => o.type === f), DEAD_FARM);
  await expect.poll(() => host.evaluate((g) => window.__game!.sounds().filter((s) => s.event === 'farm-died' && s.game === g).length, FARM_DIED)).toBe(1);
  expect(await guest.evaluate(() => window.__game!.sounds().filter((s) => s.event === 'farm-died').length)).toBe(0);
  const food = await host.evaluate(() => window.__game!.resources(1).food);
  expect(food).toBeGreaterThanOrEqual(500 + 240);

  // Both clients agree on the hash of a turn both have run.
  const turns = await Promise.all(both.map((p) => p.evaluate(() => window.__game!.turn())));
  const turn = Math.max(...turns) + 2;
  for (const page of both) await page.waitForFunction((t) => window.__game!.turn() > t, turn);
  const [a, b] = await Promise.all(both.map((p) => p.evaluate((t) => window.__game!.hash(t), turn)));
  expect(a).toBeDefined();
  expect(a).toBe(b);
  console.log(`turn ${turn} hash ${a}: farm ${farm.id} built, farmed and used up; food ${food}`);
});
