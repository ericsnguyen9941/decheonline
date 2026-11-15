import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

// Master ids (empires.dat): the Barracks, Range, Stable and Academy units (techs.md §9), the four buildings with them
// (Academy, Government Center, Temple, Siege Workshop) and the trainers; the Villager.
const UNITS = [75, 76, 77, 282, 5, 6, 41, 39, 281, 25, 37, 38, 283, 40, 338, 339, 46, 345, 93, 94, 291];
const NEW_BUILDINGS = [0, 82, 104, 49];
const TRAINERS = [12, 87, 101, 0];
const BUILDINGS = [12, 87, 101, 0, 82, 104, 49];
const VILLAGER = 83;
const HOPLITE = 93;
/** Civ ids and their cultures (`icon_set`): Greek 1, Egyptian 0. */
const CIV_GREEK = 2;
const CULTURE = { 1: 1, 2: 0 } as const;
const NAME = { 1: 'greek', 2: 'egyptian' } as const;
/** `btnbldg_<culture>`, `btnunit`. */
const BUILDING_ICONS = 50704;
const UNIT_ICONS = 50730;
/** First page of the build menu: `button_location` 1-10; the rest after More (the dat's locations, scr_game.cpp:2452-2468). */
const PAGE_1 = [12, 87, 101];
const PAGE_2 = [0, 82, 104, 49];

// speed=4; resources, and houses for the Hoplite past 21 units and 3 Villagers; every player starts with the seven buildings and one of each unit.
const URL = `/?debug=net&map=test&speed=4&resources=5000&houses=6&buildings=${BUILDINGS.join(',')}&units=${UNITS.join(',')}`;

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

const slot = (page: Page, command: string, unit?: number) =>
  page.locator(`[data-testid=command-slot][data-command=${command}]${unit === undefined ? '' : `[data-unit="${unit}"]`}`);
const background = (page: Page, testid: string) => page.getByTestId(testid).evaluate((e) => getComputedStyle(e).backgroundImage);
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/**
 * Esc (nothing selected, so a click on the same spot is not a second click past the selection), centres the view on
 * the object and left clicks it, a little higher each try for a unit (its sprite stands above its foot point).
 */
async function selectObject(page: Page, id: number, unit: boolean): Promise<void> {
  await page.keyboard.press('Escape');
  const o = (await page.evaluate(() => window.__game!.objects())).find((x) => x.id === id)!;
  await page.evaluate(([x, y]) => window.__map!.centerOnTile(Math.floor(x), Math.floor(y)), [o.x, o.y] as const);
  await frames(page);
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  for (const dy of unit ? [-15, -30, -5, -45] : [0]) {
    const at = (await page.evaluate(([i, u]) => (u ? window.__game!.unitScreenPos(i) : window.__game!.objectScreenPos(i)), [id, unit] as const))!;
    await page.mouse.click(box.x + at.x, box.y + at.y + dy);
    await frames(page);
    if (JSON.stringify(await page.evaluate(() => window.__game!.selection())) === JSON.stringify([id])) break;
    await page.keyboard.press('Escape');
  }
  await expect.poll(() => page.evaluate(() => window.__game!.selection())).toEqual([id]);
}

/** `relation` stances: neutral, enemy. */
const NEUTRAL = 1;
const ENEMY = 3;

/**
 * Both players take `relation` towards the other, and both clients wait until it holds: neutral while the art is looked
 * at (the bases of the test map are close enough for each side's units to attack the other's buildings), enemy to fight.
 */
async function stance(pages: Page[], relation: number): Promise<void> {
  for (const [i, page] of pages.entries()) await page.evaluate(([p, r]) => window.__game!.issue({ type: 'relation', player: p, relation: r }), [2 - i, relation] as const);
  for (const page of pages) await page.waitForFunction((r) => window.__game!.relation(1, 2) === r && window.__game!.relation(2, 1) === r, relation);
}

/** Host plays Greek, guest Egyptian (two art sets), an Iron Age game with the map revealed; resolves once both draw it all. */
async function startGame(browser: Browser): Promise<[Page, Page]> {
  const host = await open(browser);
  const guest = await open(browser);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await expect(host.getByTestId('player-1')).toContainText('Bob');
  await host.getByTestId('civ-0').selectOption(String(CIV_GREEK));
  await host.getByTestId('starting-age').selectOption({ label: 'Iron Age' });
  await host.getByTestId('reveal-map').check();
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await expect(host.getByTestId('start')).toBeEnabled();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game !== undefined);
  await stance([host, guest], NEUTRAL);
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__game !== undefined && window.__game.shownObjects() > 0 && window.__game.packSprites() === window.__game.shownObjects());
    // The debug strip of `?debug=net` covers the corner of the object panel.
    await page.getByTestId('net-debug').evaluate((el) => el.remove());
  }
  return [host, guest];
}

test.setTimeout(900_000);

test('the land units, their buildings, icons, build menu pages and fight animations show the original art for two civs', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  mkdirSync(shots, { recursive: true });
  expect(await host.evaluate(() => window.__map!.source)).toBe('pack');
  const graphicNames: Record<string, { name: string }> = (await host.evaluate(() => fetch('/assets/manifest.json').then((r) => r.json()))).graphics;

  for (const [page, player] of [[host, 1], [guest, 2]] as const) {
    const civ = NAME[player];
    const culture = CULTURE[player];
    const own = (await page.evaluate(() => window.__game!.objects())).filter((o) => o.owner === player);

    // The 21 units standing, then each selected: its icon is btnunit's frame in the player's colour, and selecting it plays its sound.
    const first = own.find((o) => o.type === UNITS[7])!;
    await page.evaluate(([x, y]) => window.__map!.centerOnTile(Math.floor(x), Math.floor(y)), [first.x, first.y] as const);
    await frames(page);
    await shot(page, `land-units-${civ}-standing.png`);
    for (const type of UNITS) {
      const unit = own.find((o) => o.type === type)!;
      await selectObject(page, unit.id, true);
      expect(await background(page, 'object-icon')).toContain(`/assets/sprites/interface/${UNIT_ICONS}.o${player}.png`);
      if (player === 1) await shot(page, `land-unit-icon-${type}.png`, 'object-panel');
      console.log(`${civ} unit ${type}: "${await page.getByTestId('object-name').textContent()}" ${await page.getByTestId('object-hp').textContent()}`);
    }
    const selects = (await page.evaluate(() => window.__game!.sounds())).filter((s) => s.event === 'select' && UNITS.includes(s.source));
    console.log(`${civ} select sounds: ${selects.map((s) => `${s.source}:${s.sound}/${s.wav}`).join(' ')}`);
    expect(new Set(selects.map((s) => s.source)).size).toBe(UNITS.length);
    expect(selects.every((s) => s.sound < 0 || s.wav !== null)).toBe(true);

    // The buildings, in the culture's art: the view, then each selected (its picture from btnbldg_<culture>).
    const barracks = own.find((o) => o.type === BUILDINGS[0])!;
    await page.keyboard.press('Escape');
    await page.evaluate(([x, y]) => window.__map!.centerOnTile(Math.floor(x) + 2, Math.floor(y) + 6), [barracks.x, barracks.y] as const);
    await frames(page);
    await shot(page, `land-units-${civ}-buildings.png`);
    for (const type of BUILDINGS) {
      const b = own.find((o) => o.type === type)!;
      await selectObject(page, b.id, false);
      expect(await background(page, 'object-icon')).toContain(`/assets/sprites/interface/${BUILDING_ICONS + culture}.o${player}.png`);
      console.log(`${civ} building ${type}: "${await page.getByTestId('object-name').textContent()}"`);
      if (NEW_BUILDINGS.includes(type)) await shot(page, `land-units-${civ}-building-${type}.png`, 'object-panel');
      // The trainers' command panels: each unit's train button with its icon.
      if (TRAINERS.includes(type)) await shot(page, `land-units-${civ}-panel-${type}.png`, 'hud-bottom');
      if (type === 0 && player === 1) {
        // The Academy's Hoplite button trains one.
        const before = (await page.evaluate(() => window.__game!.units())).filter((u) => u.owner === 1 && u.type === HOPLITE).length;
        await slot(page, 'train', HOPLITE).click();
        await page.waitForFunction(([t, n]) => window.__game!.units().filter((u) => u.owner === 1 && u.type === t).length > n, [HOPLITE, before] as const);
      }
    }

    // The build menu's two pages: the Barracks, Range and Stable on the first, the four new buildings after More.
    const villager = own.find((o) => o.type === VILLAGER)!;
    await selectObject(page, villager.id, true);
    await slot(page, 'build').click();
    for (const type of PAGE_1) {
      await expect(slot(page, 'place', type)).toHaveCount(1);
      expect(await slot(page, 'place', type).locator('.hud-slot-icon').evaluate((e) => getComputedStyle(e).backgroundImage)).toContain(`${BUILDING_ICONS + culture}.o${player}.png`);
    }
    for (const type of PAGE_2) await expect(slot(page, 'place', type)).toHaveCount(0);
    await shot(page, `land-units-${civ}-build-page1.png`, 'hud-bottom');
    await slot(page, 'more').click();
    for (const type of PAGE_2) {
      await expect(slot(page, 'place', type)).toHaveCount(1);
      expect(await slot(page, 'place', type).locator('.hud-slot-icon').evaluate((e) => getComputedStyle(e).backgroundImage)).toContain(`${BUILDING_ICONS + culture}.o${player}.png`);
    }
    await shot(page, `land-units-${civ}-build-page2.png`, 'hud-bottom');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }

  // The fight: enemies again, each of the host's units attacks the guest's of the same type, so they walk, attack and die.
  await stance([host, guest], ENEMY);
  const all = await host.evaluate(() => window.__game!.objects());
  const pairs = UNITS.map((type) => [all.find((o) => o.owner === 1 && o.type === type)!, all.find((o) => o.owner === 2 && o.type === type)!] as const);
  for (const [a, b] of pairs) await host.evaluate(([u, t, x, y]) => window.__game!.issueWork([u], t, x, y), [a.id, b.id, b.x, b.y] as const);
  const target = pairs[7]![1];
  const seen = new Map<number, Set<number>>();
  // A dying unit becomes its dead record (another type), so the rest of the players' objects are kept apart.
  const others = new Set<number>();
  const watch = async () => {
    for (const o of await host.evaluate(() => window.__game!.objects())) {
      if (UNITS.includes(o.type)) (seen.get(o.type) ?? seen.set(o.type, new Set()).get(o.type)!).add(o.graphic);
      else if (o.owner > 0 && !BUILDINGS.includes(o.type) && o.type !== VILLAGER) others.add(o.graphic);
    }
  };
  const midway = { x: (pairs[7]![0].x + target.x) / 2, y: (pairs[7]![0].y + target.y) / 2 };
  await host.evaluate(([x, y]) => window.__map!.centerOnTile(Math.floor(x), Math.floor(y)), [midway.x, midway.y] as const);
  await host.waitForFunction(() => window.__game!.units().filter((u) => u.owner === 1 && u.moving).length >= 10);
  await watch();
  await shot(host, 'land-units-fight-walk.png');
  await host.evaluate(([x, y]) => window.__map!.centerOnTile(Math.floor(x), Math.floor(y)), [target.x, target.y] as const);
  const count = () => host.evaluate((types) => window.__game!.units().filter((u) => types.includes(u.type)).length, UNITS);
  const start = (await count()) + 1;
  for (let i = 0; i < 4; i++) {
    await host.waitForFunction(([types, n]) => window.__game!.units().filter((u) => types.includes(u.type)).length < n, [UNITS, start - 1 - 3 * i] as const);
    await watch();
    await shot(host, `land-units-fight-${i + 1}.png`);
  }
  for (let i = 0; i < 40; i++) {
    await watch();
    await host.waitForTimeout(250);
  }
  const deaths = (await host.evaluate(() => window.__game!.sounds())).filter((s) => s.event === 'death' && UNITS.includes(s.source));
  console.log(`death sounds: ${deaths.map((s) => `${s.source}:${s.sound}/${s.wav}`).join(' ')}`);
  for (const type of UNITS) console.log(`graphics of ${type}: ${[...seen.get(type)!].map((g) => `${g} ${graphicNames[g]?.name ?? '?'}`).join(', ')}`);
  console.log(`other graphics (dead records, missiles): ${[...others].map((g) => `${g} ${graphicNames[g]?.name ?? '?'}`).join(', ')}`);
  // Every unit was drawn in at least two of its sprites (standing and walking at least) from the pack.
  for (const type of UNITS) expect(seen.get(type)!.size, `unit ${type}`).toBeGreaterThanOrEqual(2);
});
