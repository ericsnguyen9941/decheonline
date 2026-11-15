import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

// Master ids (empires.dat): the Villager and the Town Center.
const VILLAGER = 83;
const TOWN_CENTER = 109;
/** Screen pixels a Villager must stand from the Town Center's anchor so its own pick (frame box + 15 px) cannot win. */
const CLEAR = 80;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('/?debug=net&map=test&speed=4');
  return page;
}

/** Centres the view on object `id`. */
async function centre(page: Page, id: number): Promise<void> {
  await page.evaluate((i) => {
    const p = window.__game!.unitScreenPos(i)!;
    const camera = window.__map!.camera();
    window.__map!.setCamera(camera.x + p.x - innerWidth / 2, camera.y + p.y - innerHeight / 2);
  }, id);
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

test("the Stone Age Town Center is selected by a click on a see-through gap inside its drawn rows; a Villager's diamond lies under it", async ({
  browser,
}) => {
  const host = await open(browser);
  const guest = await open(browser);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  // Every object the fog lets the player see is drawn from the pack.
  await host.waitForFunction(() => window.__game !== undefined && window.__game.shownObjects() > 0 && window.__game.packSprites() === window.__game.shownObjects());
  await host.getByTestId('net-debug').evaluate((el) => el.remove());
  const box = (await host.getByTestId('game-canvas').boundingBox())!;
  mkdirSync(shots, { recursive: true });

  // The Villagers walk off two tiles east of the Town Center, so only it is under the pointer.
  const tc = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === TOWN_CENTER)!;
  const villagers = (await host.evaluate(() => window.__game!.units())).filter((u) => u.owner === 1 && u.type === VILLAGER).map((u) => u.id);
  await host.evaluate(([ids, x, y]) => window.__game!.issueMove(ids, x, y), [villagers, tc.x + 4, tc.y] as const);
  await host.waitForFunction(
    ([ids, t, clear]) => {
      const p = window.__game!.unitScreenPos(t)!;
      return ids.every((v) => {
        const q = window.__game!.unitScreenPos(v)!;
        return Math.hypot(p.x - q.x, p.y - q.y) > clear;
      });
    },
    [villagers, tc.id, CLEAR] as const,
  );

  // Its anchor and points round it: the camp's art is mostly grass between tents, so several of these are see-through.
  await centre(host, tc.id);
  const anchor = (await host.evaluate((id) => window.__game!.unitScreenPos(id), tc.id))!;
  const missed: string[] = [];
  for (const [dx, dy] of [
    [0, 0],
    [0, -20],
    [0, -40],
    [-30, -20],
    [30, -20],
    [0, 20],
  ] as const) {
    await host.mouse.click(box.x + anchor.x + 300, box.y + anchor.y + 150);
    await expect.poll(() => host.evaluate(() => window.__game!.selection())).not.toEqual([tc.id]);
    await host.mouse.click(box.x + anchor.x + dx, box.y + anchor.y + dy);
    if (JSON.stringify(await host.evaluate(() => window.__game!.selection())) !== JSON.stringify([tc.id])) missed.push(`${dx},${dy}`);
  }
  expect(missed).toEqual([]);
  await host.mouse.move(box.x + anchor.x + 300, box.y + anchor.y + 150);
  await host.screenshot({ path: join(shots, 'select-town-center.png'), clip: { x: box.x + anchor.x - 160, y: box.y + anchor.y - 160, width: 320, height: 260 } });

  // A Villager selected: its white diamond on the ground is drawn under its sprite, its hit point bar over it.
  const villager = villagers[0]!;
  await centre(host, villager);
  const at = (await host.evaluate((id) => window.__game!.unitScreenPos(id), villager))!;
  await host.mouse.click(box.x + at.x, box.y + at.y - 15);
  await expect.poll(() => host.evaluate(() => window.__game!.selection())).toEqual([villager]);
  await host.mouse.move(box.x + at.x + 300, box.y + at.y + 150);
  await host.screenshot({ path: join(shots, 'select-villager.png'), clip: { x: box.x + at.x - 40, y: box.y + at.y - 70, width: 80, height: 90 } });
  console.log(`screenshots: ${['select-town-center', 'select-villager'].map((n) => join(shots, `${n}.png`)).join(' ')}`);
});
