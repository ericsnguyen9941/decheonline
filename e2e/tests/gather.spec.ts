import { expect, test, type Browser, type Page } from '@playwright/test';

// speed=20 runs the lockstep clock 20x faster, so a walk and a load of wood take seconds.
const URL = '/?debug=net&speed=20';

// Master ids (empires.dat): villager types, forage bush, Tree01/Tree08/Tree10.
const VILLAGER = 83;
const LUMBERJACK = 123;
const FORAGER = 120;
const FORAGE = 59;
const TREES = [134, 141, 143];

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
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

type Obj = Awaited<ReturnType<NonNullable<Window['__game']>['objects']>>[number];

const objects = (page: Page): Promise<Obj[]> => page.evaluate(() => window.__game!.objects());

/** Left click the villager, then right click the middle of the nearest object of one of `types` owned by Gaia. */
async function sendToWork(page: Page, villager: Obj, types: number[]): Promise<number> {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  const at = (await page.evaluate((id) => window.__game!.unitScreenPos(id), villager.id))!;
  await page.mouse.click(box.x + at.x, box.y + at.y - 15);
  expect(await page.evaluate(() => window.__game!.selection())).toEqual([villager.id]);
  const target = (await objects(page))
    .filter((o) => o.owner === 0 && types.includes(o.type))
    .sort((a, b) => Math.hypot(a.x - villager.x, a.y - villager.y) - Math.hypot(b.x - villager.x, b.y - villager.y))[0]!;
  const p = (await page.evaluate((id) => window.__game!.objectScreenPos(id), target.id))!;
  expect(p.x > 0 && p.y > 0 && p.x < box.width && p.y < box.height).toBe(true);
  await page.mouse.click(box.x + p.x, box.y + p.y, { button: 'right' });
  return target.id;
}

test('villagers of both players gather and deposit; both clients show equal totals and hashes', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  const start = await host.evaluate(() => window.__game!.resources(1));
  expect(start).toEqual({ food: 200, wood: 200, gold: 0, stone: 150 });
  await expect(host.getByTestId('res-wood').locator('b')).toHaveText('200');
  await expect(guest.getByTestId('res-stone').locator('b')).toHaveText('150');

  // Both bases draw: 3 villagers and a Town Center per player, plus Gaia's trees, bushes, mines and animals.
  expect((await objects(host)).length).toBe(2 * (3 + 1 + 8 + 3 + 3 + 2));

  // Host: first villager chops the nearest tree. Guest: first villager forages the nearest bush.
  const hostVillager = (await objects(host)).find((o) => o.owner === 1 && o.type === VILLAGER)!;
  const guestVillager = (await objects(guest)).find((o) => o.owner === 2 && o.type === VILLAGER)!;
  const tree = await sendToWork(host, hostVillager, TREES);
  const bush = await sendToWork(guest, guestVillager, [FORAGE]);
  expect(tree).not.toBe(bush);

  // The orders reach both clients, the villagers take up their trades (a new unit type, so new sprites)...
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game!.applied().flat().length === 2);
  expect(await host.evaluate(() => window.__game!.applied().map((c) => c.map((x) => x.type)))).toEqual([['work'], ['work']]);
  for (const page of [host, guest]) {
    await page.waitForFunction(
      ([h, g, hostType, guestType]) => {
        const o = window.__game!.objects();
        return o.find((x) => x.id === h)!.type === hostType && o.find((x) => x.id === g)!.type === guestType;
      },
      [hostVillager.id, guestVillager.id, LUMBERJACK, FORAGER] as const,
    );
  }

  // ...and carry wood and food back to their Town Centers.
  await host.waitForFunction(
    (s) => window.__game!.resources(1).wood > s.wood && window.__game!.resources(2).food > s.food,
    start,
  );
  await guest.waitForFunction(
    (s) => window.__game!.resources(1).wood > s.wood && window.__game!.resources(2).food > s.food,
    start,
  );

  // A turn both clients have run, and what each logged for it.
  const turns = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game!.turn())));
  const turn = Math.max(...turns) + 2;
  for (const page of [host, guest]) await page.waitForFunction((t) => window.__game!.turn() > t, turn);
  const [a, b] = await Promise.all(
    [host, guest].map((p) =>
      p.evaluate((t) => ({ hash: window.__game!.hash(t), one: window.__game!.resourcesAt(t, 1), two: window.__game!.resourcesAt(t, 2) }), turn),
    ),
  );
  expect(a!.hash).toBeDefined();
  expect(a).toEqual(b);
  expect(a!.one!.wood).toBeGreaterThan(start.wood);
  expect(a!.two!.food).toBeGreaterThan(start.food);
  console.log(`turn ${turn} hash ${a!.hash}: host ${JSON.stringify(a!.one)}, guest ${JSON.stringify(a!.two)}`);

  // The resource bar of each client shows its own player's wood or food.
  await expect(host.getByTestId('res-wood').locator('b')).not.toHaveText('200');
  await expect(guest.getByTestId('res-food').locator('b')).not.toHaveText('200');
});
