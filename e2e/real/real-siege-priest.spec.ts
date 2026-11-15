import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

// Every player starts with a Stone Thrower and a Priest above its Villagers.
const URL = '/?debug=net&map=test&speed=4&units=35,125';
const STONE_THROWER = 35;
const PRIEST = 125;
const VILLAGER = 83;
/** btncmd.shp (interface SLP 50721) frames: Attack Ground, Heal, Convert, Cancel. */
const BTNCMD = 50721;
const FRAMES = { 'attack-ground': 12, heal: 13, convert: 14, cancel: 10 } as const;
/** `relation` stance: neutral. */
const NEUTRAL = 1;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

async function shot(page: Page, name: string, clip?: string): Promise<void> {
  const path = join(shots, name);
  if (clip) await page.getByTestId(clip).screenshot({ path });
  else await page.screenshot({ path });
  console.log(`screenshot: ${path}`);
}

const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const slot = (page: Page, command: string) => page.locator(`[data-testid=command-slot][data-command=${command}]`);
const background = (page: Page, command: string) => slot(page, command).locator('.hud-slot-icon').evaluate((e) => getComputedStyle(e).backgroundImage);
const unitOf = async (page: Page, owner: number, type: number) => (await page.evaluate(() => window.__game!.units())).find((u) => u.owner === owner && u.type === type)!;

/** Centres the view on unit `id` and left clicks it, a little higher each try (its sprite stands above its foot point). */
async function selectUnit(page: Page, id: number): Promise<void> {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  for (const dy of [-15, -30, -5, -45]) {
    await page.keyboard.press('Escape');
    const u = (await page.evaluate(() => window.__game!.units())).find((x) => x.id === id)!;
    await page.evaluate(([x, y]) => window.__map!.centerOnTile(Math.floor(x), Math.floor(y)), [u.x, u.y] as const);
    await frames(page);
    const at = (await page.evaluate((i) => window.__game!.unitScreenPos(i), id))!;
    await page.mouse.click(box.x + at.x, box.y + at.y + dy);
    await frames(page);
    if (JSON.stringify(await page.evaluate(() => window.__game!.selection())) === JSON.stringify([id])) return;
  }
  await expect.poll(() => page.evaluate(() => window.__game!.selection())).toEqual([id]);
}

test.setTimeout(600_000);

test('real pack: Attack Ground, Heal, Convert and Cancel buttons and the ring cursor are the original art', async ({ browser }) => {
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
  const pages = [host, guest];
  for (const page of pages) await page.waitForFunction(() => window.__game?.selection() != null && window.__map?.source === 'pack');
  for (const [i, page] of pages.entries()) await page.evaluate(([p, r]) => window.__game!.issue({ type: 'relation', player: p, relation: r }), [2 - i, NEUTRAL] as const);
  for (const page of pages) await page.waitForFunction((r) => window.__game!.relation(1, 2) === r && window.__game!.relation(2, 1) === r, NEUTRAL);

  // The Stone Thrower's grid: Stand Ground and Attack Ground; its click mode leaves Cancel alone.
  const st = await unitOf(host, 1, STONE_THROWER);
  await selectUnit(host, st.id);
  expect(await background(host, 'attack-ground')).toContain('/assets/sprites/interface/50721');
  await shot(host, 'siege-priest-stone-thrower-grid.png', 'hud-bottom');
  await slot(host, 'attack-ground').click();
  expect(await background(host, 'cancel')).toContain('/assets/sprites/interface/50721');
  await shot(host, 'siege-priest-click-mode-grid.png', 'hud-bottom');
  await host.keyboard.press('Escape');
  expect(await host.evaluate(() => window.__game!.commandMode())).toBeNull();

  // The Priest's grid: Heal and Convert.
  const priest = await unitOf(host, 1, PRIEST);
  await selectUnit(host, priest.id);
  for (const b of ['heal', 'convert'] as const) expect(await background(host, b)).toContain('/assets/sprites/interface/50721');
  await shot(host, 'siege-priest-priest-grid.png', 'hud-bottom');

  // The ring (mcursors facet 5) over a unit the Priest can convert: a guest Villager, walked next to it.
  const villager = await unitOf(host, 2, VILLAGER);
  await guest.evaluate(([id, x, y]) => window.__game!.issueMove([id], x, y), [villager.id, priest.x, priest.y - 2] as const);
  await host.waitForFunction(([id, x, y]) => {
    const u = window.__game!.units().find((o) => o.id === id)!;
    return !u.moving && Math.hypot(u.x - x, u.y - y) < 3;
  }, [villager.id, priest.x, priest.y - 2] as const);
  await host.evaluate(([x, y]) => window.__map!.centerOnTile(Math.floor(x), Math.floor(y)), [priest.x, priest.y - 2] as const);
  await frames(host);
  const box = (await host.getByTestId('game-canvas').boundingBox())!;
  const url = await host.evaluate(() => document.getElementById('game')!.style.getPropertyValue('--cursor-target'));
  expect(url).toContain('url(data:image/png');
  const ringPng = /data:image\/png;base64,([^)"]+)/.exec(url)![1]!;
  let ring = false;
  for (const dy of [-15, -30, -5, -45, -20, -10]) {
    const at = (await host.evaluate((i) => window.__game!.unitScreenPos(i), villager.id))!;
    await host.mouse.move(box.x + at.x, box.y + at.y + dy);
    await frames(host);
    const shown = await host.evaluate(() => window.__game!.cursor());
    if (shown.includes(ringPng)) {
      ring = true;
      break;
    }
  }
  expect(ring).toBe(true);
  // The ring's own image, to look at (a page screenshot has no mouse pointer).
  writeFileSync(join(shots, 'siege-priest-cursor-ring.png'), Buffer.from(ringPng, 'base64'));
  console.log(`cursor ring: ${join(shots, 'siege-priest-cursor-ring.png')}; buttons from SLP ${BTNCMD} frames ${JSON.stringify(FRAMES)}`);
});
