import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/?debug=net');
  return page;
}

test('villagers render with their real sprites, standing and walking', async ({ browser }) => {
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
  // Every object the fog lets the host see (its own Villagers and Town Center, Gaia's near them) drawn from the pack.
  await host.waitForFunction(() => window.__game !== undefined && window.__game.shownObjects() > 0 && window.__game.packSprites() === window.__game.shownObjects());
  expect(await host.evaluate(() => window.__map!.source)).toBe('pack');
  mkdirSync(shots, { recursive: true });
  const canvas = host.getByTestId('game-canvas');
  const box = (await canvas.boundingBox())!;

  // Box-select the host's villagers: the selection highlight shows round them.
  const ids = await host.evaluate(() => window.__game!.units().filter((u) => u.owner === 1).map((u) => u.id));
  const points = await Promise.all(ids.map((id) => host.evaluate((i) => window.__game!.unitScreenPos(i)!, id)));
  await host.mouse.move(box.x + Math.min(...points.map((p) => p.x)) - 30, box.y + Math.min(...points.map((p) => p.y)) - 60);
  await host.mouse.down();
  await host.mouse.move(box.x + Math.max(...points.map((p) => p.x)) + 30, box.y + Math.max(...points.map((p) => p.y)) + 10, { steps: 5 });
  await host.mouse.up();
  expect((await host.evaluate(() => window.__game!.selection()))!.length).toBe(3);
  await canvas.screenshot({ path: join(shots, 'units.png') });

  // Right click a few tiles east of them (open ground) and catch them walking.
  const target = await host.evaluate(() => window.__map!.tileScreenPos(14, 9));
  await host.mouse.click(box.x + target.x, box.y + target.y, { button: 'right' });
  await host.waitForFunction(() => window.__game!.units().some((u) => u.owner === 1 && u.moving && u.x > 11));
  await canvas.screenshot({ path: join(shots, 'units-walking.png') });
  console.log(`screenshots: ${join(shots, 'units.png')} ${join(shots, 'units-walking.png')}`);
});
