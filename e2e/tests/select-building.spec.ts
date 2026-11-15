import { expect, test, type Browser, type Page } from '@playwright/test';

// speed=20 runs the lockstep clock 20x faster; 500 of each resource pays for a House and a Barracks.
const URL = '/?debug=net&speed=20&resources=500';

// Master ids (empires.dat): Villager, House, Barracks, Town Center.
const VILLAGER = 83;
const HOUSE = 70;
const BARRACKS = 12;
const TOWN_CENTER = 109;
/** `object_state` of a finished building. */
const ACTIVE = 2;
/** Screen pixels a Villager must stand from a building's anchor so its own pick (frame box + 15 px) cannot win. */
const CLEAR = 60;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

async function startGame(browser: Browser): Promise<Page> {
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
  await host.waitForFunction(() => window.__game?.selection() != null && window.__map !== undefined);
  return host;
}

const slot = (page: Page, command: string, unit?: number) =>
  page.locator(`[data-testid=command-slot][data-command=${command}]${unit === undefined ? '' : `[data-unit="${unit}"]`}`);

/** Places building `unit` with the selected Villager on the first of `tiles` where its ghost fits; returns its id. */
async function place(page: Page, unit: number, tiles: [number, number][]): Promise<number> {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  await slot(page, 'build').click();
  await slot(page, 'place', unit).click();
  for (const [col, row] of tiles) {
    const spot = await page.evaluate(([c, r]) => window.__map!.tileScreenPos(c, r), [col, row] as const);
    await page.mouse.move(box.x + spot.x, box.y + spot.y);
    await expect.poll(() => page.evaluate(() => window.__game!.ghost()?.x)).not.toBeUndefined();
    const ghost = (await page.evaluate(() => window.__game!.ghost()))!;
    if (!ghost.fits) continue;
    await page.mouse.click(box.x + spot.x, box.y + spot.y);
    const at = { x: ghost.x, y: ghost.y };
    await page.waitForFunction(([u, p]) => window.__game!.buildings().some((b) => b.type === u && b.x === p.x && b.y === p.y), [unit, at] as const);
    return (await page.evaluate(() => window.__game!.buildings())).find((b) => b.type === unit && b.x === at.x && b.y === at.y)!.id;
  }
  throw new Error(`no tile fits building ${unit}`);
}

test('a left click on a building at its map anchor selects it: the Town Center, a House and a Barracks', async ({ browser }) => {
  const host = await startGame(browser);
  const box = (await host.getByTestId('game-canvas').boundingBox())!;
  const villagers = (await host.evaluate(() => window.__game!.units())).filter((u) => u.owner === 1 && u.type === VILLAGER);
  const at = (await host.evaluate((id) => window.__game!.unitScreenPos(id), villagers[0]!.id))!;
  await host.mouse.click(box.x + at.x, box.y + at.y - 15);
  await expect.poll(() => host.evaluate(() => window.__game!.selection())).toEqual([villagers[0]!.id]);

  const tc = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === TOWN_CENTER)!;
  const house = await place(host, HOUSE, [[14, 8]]);
  await host.waitForFunction(([id, active]) => window.__game!.buildings().find((b) => b.id === id)?.state === active, [house, ACTIVE] as const);
  const near: [number, number][] = [];
  for (let d = 3; d <= 8; d++) near.push([tc.x + d, tc.y - 3], [tc.x - d, tc.y + 3], [tc.x + 3, tc.y + d], [tc.x - 3, tc.y - d]);
  const barracks = await place(host, BARRACKS, near);
  await host.waitForFunction(([id, active]) => window.__game!.buildings().find((b) => b.id === id)?.state === active, [barracks, ACTIVE] as const);

  // The Villagers walk off, so only the buildings are under the pointer.
  const targets = [tc.id, house, barracks];
  const buildings = (await host.evaluate(() => window.__game!.buildings())).filter((b) => targets.includes(b.id));
  const far = {
    x: Math.max(1, Math.min(...buildings.map((b) => b.x)) - 6),
    y: Math.max(...buildings.map((b) => b.y)) + 6,
  };
  await host.evaluate(([ids, p]) => window.__game!.issueMove(ids, p.x, p.y), [villagers.map((v) => v.id), far] as const);
  await host.waitForFunction(
    ([ids, t, clear]) =>
      t.every((b) => {
        const p = window.__game!.unitScreenPos(b)!;
        return ids.every((v) => {
          const q = window.__game!.unitScreenPos(v)!;
          return Math.hypot(p.x - q.x, p.y - q.y) > clear;
        });
      }),
    [villagers.map((v) => v.id), targets, CLEAR] as const,
  );

  // Each building, centred in the view, clicked at the point that stands on its map position (its anchor), not at a
  // drawn pixel.
  for (const id of targets) {
    await host.evaluate((i) => {
      const p = window.__game!.unitScreenPos(i)!;
      const camera = window.__map!.camera();
      window.__map!.setCamera(camera.x + p.x - innerWidth / 2, camera.y + p.y - innerHeight / 2);
    }, id);
    await host.evaluate(() => new Promise(requestAnimationFrame));
    const p = (await host.evaluate((i) => window.__game!.unitScreenPos(i), id))!;
    await host.mouse.click(box.x + p.x, box.y + p.y);
    await expect.poll(() => host.evaluate(() => window.__game!.selection())).toEqual([id]);
  }
});
