import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

const HOUSE = 70;
const BOWMAN = 4;
/** The House's damage sprites (empires.dat unit 70): "Damage 1x1 A/B/C", past 25, 50 and 75% damage (sprites.md §6). */
const FLAMES = [
  { graphic: 805, below: 0.75 },
  { graphic: 806, below: 0.5 },
  { graphic: 807, below: 0.25 },
];

async function open(browser: Browser, url: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(url);
  return page;
}

test('a House burns with the original flames past 25, 50 and 75% damage', async ({ browser }) => {
  test.setTimeout(600_000);
  mkdirSync(shots, { recursive: true });
  // Each player has a built House right of its Town Center and Bowmen above its Villagers.
  const url = '/?debug=net&map=test&speed=4&buildings=70&bowmen=4';
  const host = await open(browser, url);
  const guest = await open(browser, url);
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
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__game !== undefined && window.__game.shownObjects() > 0 && window.__game.packSprites() === window.__game.shownObjects());
    await page.getByTestId('net-debug').evaluate((el) => el.remove());
  }
  const objects = await host.evaluate(() => window.__game!.objects());
  const house = objects.find((o) => o.owner === 1 && o.type === HOUSE)!;
  const bowmen = objects.filter((o) => o.owner === 2 && o.type === BOWMAN).map((o) => o.id);
  expect(bowmen.length).toBeGreaterThan(0);
  const maxHp = house.hp;

  for (const [i, { graphic, below }] of FLAMES.entries()) {
    // Bob's Bowmen shoot Alice's House until it is past the next threshold, then stop.
    await guest.evaluate(([units, target]) => window.__game!.issue({ type: 'attack', units, target }), [bowmen, house.id] as const);
    await host.waitForFunction(([id, hp]) => window.__game!.objects().find((o) => o.id === id)!.hp < hp, [house.id, maxHp * below - 0.5] as const, { polling: 100 });
    await guest.evaluate((objects) => window.__game!.issue({ type: 'stop', objects }), bowmen);
    // The sim's sprite list holds the flame, and the host draws it over the House from the pack.
    await host.waitForFunction(([id, g]) => JSON.stringify(window.__game!.objects().find((o) => o.id === id)!.overlays) === JSON.stringify([g]), [house.id, graphic] as const);
    await host.evaluate(([col, row]) => window.__map!.centerOnTile(col, row), [Math.floor(house.x), Math.floor(house.y)] as const);
    await host.waitForFunction(([id, g]) => JSON.stringify(window.__game!.drawnOverlays(id)) === JSON.stringify([g]), [house.id, graphic] as const);
    const hp = await host.evaluate((id) => window.__game!.objects().find((o) => o.id === id)!.hp, house.id);
    const p = (await host.evaluate((id) => window.__game!.objectScreenPos(id), house.id))!;
    const name = `burning-${i + 1}.png`;
    await host.screenshot({ path: join(shots, name), clip: { x: p.x - 160, y: p.y - 170, width: 320, height: 260 } });
    console.log(`screenshot: ${join(shots, name)}; House at ${Math.round((100 * hp) / maxHp)}% hp draws flame ${graphic}`);
  }
});
