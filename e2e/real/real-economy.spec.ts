import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

const MINE_GOLD = 66;
const MINER_GOLD = 251;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.goto('/?debug=net&speed=4');
  return page;
}

test('a base draws with the real Town Center, trees, forage, mines and animals; a miner works a mine', async ({ browser }) => {
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
  // Every object of both bases (6 villagers, 2 Town Centers, 40 - 8 of them Gaia's) drawn from the pack.
  // Every object the fog lets the player see is drawn from the pack.
  await host.waitForFunction(() => window.__game !== undefined && window.__game.shownObjects() > 0 && window.__game.packSprites() === window.__game.shownObjects());
  expect(await host.evaluate(() => window.__game!.objects().length)).toBe(40);
  expect(await host.evaluate(() => window.__map!.source)).toBe('pack');
  mkdirSync(shots, { recursive: true });
  const canvas = host.getByTestId('game-canvas');
  const box = (await canvas.boundingBox())!;
  await canvas.screenshot({ path: join(shots, 'economy-base.png') });

  // Send the first villager to the nearest gold mine and wait until it is mining.
  const villager = (await host.evaluate(() => window.__game!.objects())).find((o) => o.owner === 1 && o.type === 83)!;
  const at = (await host.evaluate((id) => window.__game!.unitScreenPos(id), villager.id))!;
  await host.mouse.click(box.x + at.x, box.y + at.y - 15);
  const mine = (await host.evaluate(() => window.__game!.objects())).find((o) => o.owner === 0 && o.type === MINE_GOLD)!;
  const p = (await host.evaluate((id) => window.__game!.objectScreenPos(id), mine.id))!;
  await host.mouse.click(box.x + p.x, box.y + p.y, { button: 'right' });
  await host.waitForFunction(
    ([id, type]) => window.__game!.objects().find((o) => o.id === id)!.type === type && window.__game!.objects().find((o) => o.id === id)!.heldAmount > 3,
    [villager.id, MINER_GOLD] as const,
  );
  await canvas.screenshot({ path: join(shots, 'economy-mining.png') });
  console.log(`screenshots: ${join(shots, 'economy-base.png')} ${join(shots, 'economy-mining.png')}`);
});
