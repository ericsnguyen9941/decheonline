import { expect, test, type Browser, type Page } from '@playwright/test';

// The host's Population Limit (docs/spec/lobby.md §2, §6): picked in the lobby, shown in the guest's summary, and the
// cap both games train up to. 20 Bowmen and 3 Villagers make a population of 23; 6 built Houses give room past 25.
const URL = '/?debug=net&map=test&speed=20&resources=1000&bowmen=20&houses=6';

// Master ids (empires.dat): Villager, House, Town Center.
const VILLAGER = 83;
const HOUSE = 70;
const TOWN_CENTER = 109;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

/** The setup screen's summary lines. */
const summary = (page: Page) => page.getByTestId('settings-summary').locator('li');

test("the host's Population Limit shows on the guest's screen and caps training in both games", async ({ browser }) => {
  const host = await open(browser);
  const guest = await open(browser);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await expect(host.getByTestId('player-1')).toContainText('Bob');

  // The default, 50 (tribegam.cpp:198), and the drop-down's 25 .. 200 (scr_set.cpp:189-192).
  await expect(summary(guest).last()).toHaveText('Population Limit: 50');
  await expect(host.getByTestId('population-limit')).toHaveValue('50');
  await expect(host.getByTestId('population-limit').locator('option')).toHaveText(['25', '50', '75', '100', '125', '150', '175', '200']);
  await expect(guest.getByTestId('population-limit')).toHaveCount(0);
  await host.getByTestId('population-limit').selectOption('25');
  await expect(summary(guest).last()).toHaveText('Population Limit: 25');

  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game?.selection() != null && window.__map !== undefined);
  for (const page of [host, guest]) {
    expect(await page.evaluate(() => [window.__game!.population(1), window.__game!.population(2)])).toEqual([
      { count: 23, headroom: 5, limit: 25 },
      { count: 23, headroom: 5, limit: 25 },
    ]);
  }

  // The host queues 4 Villagers: 2 are trained, then the population is at the limit and the other 2 wait, with room left.
  const tc = await host.evaluate((type) => window.__game!.buildings().find((b) => b.owner === 1 && b.type === type)!.id, TOWN_CENTER);
  await host.evaluate((id) => window.__game!.issue({ type: 'queue', building: id, unit: 83, count: 4 }), tc);
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game!.population(1).count === 25);
  const [turn, time] = await host.evaluate(() => [window.__game!.turn(), window.__game!.gameTime()]);
  // A Villager trains in 20 s of game time: 40 s more would have trained the next two.
  for (const page of [host, guest]) await page.waitForFunction((t) => window.__game!.gameTime() > t + 40000, time!);
  for (const page of [host, guest]) {
    expect(await page.evaluate(() => window.__game!.population(1))).toEqual({ count: 25, headroom: 3, limit: 25 });
    // The queue's first unit shows 0%: queued, never started (`production_queue_status`).
    expect(await page.evaluate((id) => window.__game!.queue(id), tc)).toEqual({ records: [{ unit: VILLAGER, count: 2 }], training: { unit: VILLAGER, progress: 0 } });
  }

  // A House's panel row: population / min(population + headroom, limit) (tpnl_obj.cpp:463-470).
  const house = await host.evaluate((type) => window.__game!.buildings().find((b) => b.owner === 1 && b.type === type)!.id, HOUSE);
  const box = (await host.getByTestId('game-canvas').boundingBox())!;
  const at = (await host.evaluate((id) => window.__game!.objectScreenPos(id), house))!;
  await host.mouse.click(box.x + at.x, box.y + at.y);
  await expect.poll(() => host.evaluate(() => window.__game!.selection())).toEqual([house]);
  await expect(host.getByTestId('object-panel')).toContainText('25/25');

  const hashes = await Promise.all([host, guest].map((p) => p.evaluate((t) => window.__game!.hash(t), turn!)));
  expect(hashes[0]).toBeDefined();
  expect(hashes[0]).toBe(hashes[1]);
});
