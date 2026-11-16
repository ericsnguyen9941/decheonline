import { expect, test, type Browser, type Page } from '@playwright/test';

// The population overlay is always on (docs/spec/hud.md "Clock and population, F11 and F5"): "pop: n/max" and the game
// clock show from game start without a key, follow a trained Villager and a built House, and F11 does not hide them.
const URL = '/?debug=net&map=test&speed=20&resources=1000';
const VILLAGER = 83;
const HOUSE = 70;
const TOWN_CENTER = 109;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

test('population and clock show at game start, follow a Villager and a House, and F11 does not hide them', async ({ browser }) => {
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
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game?.selection() != null && window.__game.turn() > 5);

  const shown = (page: Page) => page.evaluate(() => {
    const p = window.__game!.population();
    return `pop: ${p.count}/${Math.min(p.count + p.headroom, p.limit)}`;
  });
  const overlay = (page: Page) => page.getByTestId('population');

  // At the start, no key pressed: 3 Villagers, the Town Center's room, and the clock running.
  const start = await host.evaluate(() => window.__game!.population());
  for (const page of [host, guest]) {
    await expect(overlay(page)).toBeVisible();
    await expect(overlay(page)).toHaveText(await shown(page));
    await expect(page.getByTestId('game-clock')).toBeVisible();
    await expect(page.getByTestId('game-clock')).toHaveText(/^\d\d:\d\d:\d\d \(1\.0\)$/);
  }
  const before = (await overlay(host).textContent())!;
  expect(before).toBe(`pop: ${start.count}/${Math.min(start.count + start.headroom, start.limit)}`);

  // A Villager trained: the count goes up by one.
  const tc = await host.evaluate((type) => window.__game!.buildings().find((b) => b.owner === 1 && b.type === type)!.id, TOWN_CENTER);
  await host.evaluate((id) => window.__game!.issue({ type: 'queue', building: id, unit: 83, count: 1 }), tc);
  for (const page of [host, guest]) await page.waitForFunction((n) => window.__game!.population(1).count === n + 1, start.count);
  await expect(overlay(host)).toContainText(`pop: ${start.count + 1}/`);
  for (const page of [host, guest]) await expect(overlay(page)).toHaveText(await shown(page));

  // A House built: the room, so the max, grows by 4.
  const maxOf = (text: string) => Number(text.split('/')[1]);
  const room = maxOf((await overlay(host).textContent())!);
  const villagers = await host.evaluate((type) => window.__game!.units().filter((u) => u.owner === 1 && u.type === type), VILLAGER);
  await host.evaluate(([units, x, y]) => window.__game!.issue({ type: 'build', units, unitType: 70, x, y }), [villagers.map((u) => u.id), Math.round(villagers[0]!.x) + 3, Math.round(villagers[0]!.y)] as const);
  await expect.poll(async () => maxOf((await overlay(host).textContent())!)).toBe(room + 4);
  await expect(overlay(guest)).toHaveText(await shown(guest));
  expect(await host.evaluate((type) => window.__game!.buildings().filter((b) => b.owner === 1 && b.type === type).length, HOUSE)).toBe(1);

  // F11 does not hide either (it did, in the original): both still show and the clock still runs.
  for (const page of [host, guest]) {
    await page.keyboard.press('F11');
    await expect(overlay(page)).toBeVisible();
    await expect(page.getByTestId('game-clock')).toBeVisible();
    await expect(overlay(page)).toHaveText(await shown(page));
    const t = (await page.getByTestId('game-clock').textContent())!;
    await expect(page.getByTestId('game-clock')).not.toHaveText(t);
    await page.keyboard.press('F11');
    await expect(overlay(page)).toBeVisible();
    await expect(page.getByTestId('game-clock')).toBeVisible();
  }
});
