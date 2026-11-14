import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

// Master ids (empires.dat): Villager, Bowman, the Flare.
const VILLAGER = 83;
const BOWMAN = 4;
const FLARE = 112;
const VISIBLE = 0x0f;
const FOGGED = 0x80;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('/?debug=net&speed=5&bowmen=1');
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(shots, name) });
  console.log(`screenshot: ${join(shots, name)}`);
}

const units = (page: Page) => page.evaluate(() => window.__game!.units());
const visibility = (page: Page, col: number, row: number): Promise<number> =>
  page.evaluate(([c, r]) => window.__game!.tileVisibility(c!, r!), [col, row]);

test.setTimeout(240_000);

test('fog with real art: the start, an explored trail, and a flare on the minimap', async ({ browser }) => {
  mkdirSync(shots, { recursive: true });
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
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__map?.source === 'pack' && window.__game?.minimapPoint(0, 0) != null);
    await page.waitForFunction(() => window.__game!.packSprites() > 0 && window.__game!.turn() > 2);
  }

  // 1. The start: the base seen, the rest of the map black, on the main view and the minimap.
  await shot(host, 'fog-start.png');

  // 2. A villager walks out east and stays: its own sight is clear, the way it came is explored but fogged.
  const all = await units(host);
  const walker = all.find((u) => u.owner === 1 && u.type === VILLAGER)!;
  await host.evaluate(([id]) => window.__game!.issueMove([id!], 28.5, 4.5), [walker.id]);
  await host.waitForFunction(() => window.__game!.tileVisibility(28, 4) === 0x0f, undefined, { timeout: 90_000 });
  await expect.poll(() => visibility(host, 21, 6), { timeout: 30_000 }).toBe(FOGGED);
  await host.evaluate(() => window.__map!.centerOnTile(22, 6));
  await shot(host, 'fog-explored.png');

  // 3. The guest sends a villager away from its Town Center; the host's Bowman shoots it from beyond its sight. The
  // guest gets a flare at the Bowman: its spot shows on its minimap while its villager flashes.
  const prey = (await units(guest)).find((u) => u.owner === 2 && u.type === VILLAGER)!;
  await guest.evaluate(([id]) => window.__game!.issueMove([id!], 24.5, 22.5), [prey.id]);
  // It stops near the spot (its group forms around it): shoot it where it stands.
  await guest.waitForFunction(([id]) => window.__game!.units().some((u) => u.id === id && !u.moving && Math.hypot(u.x - 24.5, u.y - 22.5) < 2), [prey.id], {
    timeout: 90_000,
  });
  const at = (await units(guest)).find((u) => u.id === prey.id)!;
  const bowmen = all.filter((u) => u.owner === 1 && u.type === BOWMAN).map((u) => u.id);
  expect(bowmen.length).toBe(1);
  await host.evaluate(([ids, target, x, y]) => window.__game!.issueWork(ids as number[], target as number, x as number, y as number), [bowmen, prey.id, at.x, at.y]);
  await guest.waitForFunction(([flare]) => window.__game!.objects().some((o) => o.type === flare && o.owner === 2), [FLARE], {
    timeout: 120_000,
    polling: 100,
  });
  const flare = (await guest.evaluate(() => window.__game!.objects())).find((o) => o.type === FLARE && o.owner === 2)!;
  const [col, row] = [Math.floor(flare.x), Math.floor(flare.y)];
  expect(Math.hypot(flare.x - at.x, flare.y - at.y)).toBeGreaterThan(4);
  expect(await visibility(guest, col, row)).toBe(VISIBLE);
  await guest.evaluate(([c, r]) => window.__map!.centerOnTile(c!, r!), [Math.round((col + at.col) / 2), Math.round((row + at.row) / 2)]);
  await shot(guest, 'fog-flare.png');
  // One Bowman takes a few shots to kill a Villager: it was still alive when the shot was taken.
  expect((await units(guest)).some((u) => u.id === prey.id)).toBe(true);
});
