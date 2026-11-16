import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

// Master id (empires.dat): the Villager.
const VILLAGER = 83;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('/?debug=net&map=test&speed=4');
  return page;
}

const selection = (page: Page) => page.evaluate(() => [...window.__game!.selection()!].sort((a, b) => a - b));

test('Ctrl+1 draws a 1 over the group and Ctrl+9 a 9 (groupnum.shp frames 0-8); a digit then Space centres the view on it', async ({ browser }) => {
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
  await host.waitForFunction(() => window.__game !== undefined && window.__game.shownObjects() > 0 && window.__game.packSprites() === window.__game.shownObjects());
  // The debug strip of `?debug=net` covers the corner of the object panel.
  await host.getByTestId('net-debug').evaluate((el) => el.remove());
  const box = (await host.getByTestId('game-canvas').boundingBox())!;
  mkdirSync(shots, { recursive: true });

  // A box round the three Villagers selects them.
  const ids = (await host.evaluate(() => window.__game!.objects())).filter((o) => o.owner === 1 && o.type === VILLAGER).map((o) => o.id);
  const at = await Promise.all(ids.map((id) => host.evaluate((i) => window.__game!.unitScreenPos(i), id)));
  const xs = at.map((p) => p!.x);
  const ys = at.map((p) => p!.y);
  await host.mouse.move(box.x + Math.min(...xs) - 30, box.y + Math.min(...ys) - 60);
  await host.mouse.down();
  await host.mouse.move(box.x + Math.max(...xs) + 30, box.y + Math.max(...ys) + 20, { steps: 4 });
  await host.mouse.up();
  await expect.poll(() => selection(host)).toEqual([...ids].sort((a, b) => a - b));

  // Ctrl+1: each Villager draws group 1's number, digit 1 (frame 0); the screenshot shows the digit.
  await host.keyboard.press('Control+Digit1');
  await expect.poll(() => host.evaluate(() => window.__game!.groupNumbers().sort((a, b) => a.id - b.id))).toEqual([...ids].sort((a, b) => a - b).map((id) => ({ id, group: 1 })));
  await host.mouse.move(box.x + box.width / 2, box.y + 40);
  const clip = { x: box.x + Math.min(...xs) - 40, y: box.y + Math.min(...ys) - 70, width: Math.max(...xs) - Math.min(...xs) + 80, height: Math.max(...ys) - Math.min(...ys) + 100 };
  await host.screenshot({ path: join(shots, 'real-group-ctrl1.png'), clip });

  // Ctrl+9 on one Villager draws a number: digit 9 is the last frame (8), there is no frame 9.
  const first = ids[0]!;
  const p = (await host.evaluate((i) => window.__game!.unitScreenPos(i), first))!;
  await host.mouse.click(box.x + p.x, box.y + p.y - 15);
  await expect.poll(() => selection(host)).toEqual([first]);
  await host.keyboard.press('Control+Digit9');
  await expect.poll(() => host.evaluate(() => window.__game!.groupNumbers())).toEqual([{ id: first, group: 9 }]);
  await host.mouse.move(box.x + box.width / 2, box.y + 40);
  await host.screenshot({ path: join(shots, 'real-group-ctrl9.png'), clip });

  // 2 then Space: the view, moved far off, scrolls back to the group.
  await host.keyboard.press('Control+Digit2');
  const fromCentre = async () => {
    const q = await host.evaluate((i) => window.__game!.unitScreenPos(i), first);
    return q ? Math.hypot(q.x - box.width / 2, q.y - box.height / 2) : Infinity;
  };
  await host.evaluate(() => window.__map!.centerOnTile(30, 30));
  await expect.poll(fromCentre).toBeGreaterThan(400);
  await host.keyboard.press('Digit2');
  expect(await selection(host)).toEqual([first]);
  await host.keyboard.press('Space');
  await expect.poll(fromCentre).toBeLessThan(40);
});
