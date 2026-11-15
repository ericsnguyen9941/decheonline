import { expect, test, type Browser, type Page } from '@playwright/test';

// speed=20 runs the lockstep clock 20x faster, so building a House and training a Villager take seconds.
const URL = '/?debug=net&speed=20';

// Master ids (empires.dat): Villager, the Builder it turns into while building, House, Town Center.
const VILLAGER = 83;
const BUILDER = 118;
const HOUSE = 70;
const TOWN_CENTER = 109;
const ACTIVE = 2;

// The synthetic pack's dat has none of these masters' sounds, so the test gives them the real ones: their
// `[selected, created, death, command, move, construction]` dat sound ids in data2/empires.dat
// (npm run dat:dump -- unit <id>), each sound one of the synthetic pack's wavs.
const UNIT_SOUNDS: Record<number, number[]> = {
  [VILLAGER]: [47, 114, -1, 206, 206, -1],
  [BUILDER]: [47, 144, -1, 201, 206, -1],
  [HOUSE]: [113, -1, -1, -1, -1, 113],
  [TOWN_CENTER]: [185, -1, 70, -1, -1, 185],
};
const WAV = 5000;
/** `TRIBE_Game::sounds[1]`, button2.wav: every game screen button. */
const BUTTON = 1;

type Trigger = Awaited<ReturnType<NonNullable<typeof window.__game>['sounds']>>[number];

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.route('**/assets/manifest.json', async (route) => {
    const manifest = await (await route.fetch()).json();
    for (const [unit, sounds] of Object.entries(UNIT_SOUNDS)) {
      manifest.unitSounds[unit] = sounds;
      for (const s of sounds) if (s >= 0) manifest.sounds[s] = { items: [[WAV, 100]] };
    }
    await route.fulfill({ json: manifest });
  });
  await page.goto(URL);
  return page;
}

/** Host creates, guest joins by code, both ready, host starts; resolves once both have drawn the map. */
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
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game?.selection() != null && window.__map !== undefined);
  return [host, guest];
}

const slot = (page: Page, command: string, unit?: number) =>
  page.locator(`[data-testid=command-slot][data-command=${command}]${unit === undefined ? '' : `[data-unit="${unit}"]`}`);

async function canvasBox(page: Page) {
  return (await page.getByTestId('game-canvas').boundingBox())!;
}

/** Left click own object `id` in the middle of its drawn sprite, and check it is the selection. */
async function select(page: Page, id: number, unit = false): Promise<void> {
  const box = await canvasBox(page);
  const at = unit
    ? (await page.evaluate((i) => window.__game!.unitScreenPos(i), id))!
    : (await page.evaluate((i) => window.__game!.objectScreenPos(i), id))!;
  await page.mouse.click(box.x + at.x, box.y + at.y - (unit ? 15 : 0));
  await expect.poll(() => page.evaluate(() => window.__game!.selection())).toEqual([id]);
}

async function tile(page: Page, col: number, row: number) {
  const box = await canvasBox(page);
  const p = await page.evaluate(([c, r]) => window.__map!.tileScreenPos(c!, r!), [col, row]);
  return { x: box.x + p.x, y: box.y + p.y };
}

const sounds = (page: Page) => page.evaluate(() => window.__game!.sounds());
/** Waits until `page` has played a sound matching `want` after its first `from` sounds; returns how many it has now. */
async function heard(page: Page, want: Partial<Trigger>, from: number): Promise<number> {
  await expect.poll(async () => (await sounds(page)).slice(from).some((t) => Object.entries(want).every(([k, v]) => t[k as keyof Trigger] === v))).toBe(true);
  return (await sounds(page)).length;
}

test('selecting, ordering, building and training play the original sounds; the other player hears none of them', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  // The objects the game starts with were made without a sound.
  expect(await sounds(host)).toEqual([]);

  // A click on an own Villager: its selected sound (`select_one_object`); a right click on open ground: its move sound.
  const villager = (await host.evaluate(() => window.__game!.units())).find((u) => u.owner === 1 && u.type === VILLAGER)!;
  await select(host, villager.id, true);
  let n = await heard(host, { event: 'select', sound: 47, wav: WAV, source: VILLAGER }, 0);
  const ground = await tile(host, 12, 7);
  await host.mouse.click(ground.x, ground.y, { button: 'right' });
  n = await heard(host, { event: 'move', sound: 206, source: VILLAGER }, n);

  // Build, then House: each grid button clicks (button2.wav); placing it plays the Builder's command sound.
  await slot(host, 'build').click();
  n = await heard(host, { event: 'button', game: BUTTON }, n);
  await slot(host, 'place', HOUSE).click();
  n = await heard(host, { event: 'button', game: BUTTON }, n);
  const spot = await tile(host, 14, 8);
  await host.mouse.move(spot.x, spot.y);
  await expect.poll(() => host.evaluate(() => window.__game!.ghost())).toEqual({ unit: HOUSE, x: 14, y: 8, fits: true });
  await host.mouse.click(spot.x, spot.y);
  n = await heard(host, { event: 'command', sound: 201, source: BUILDER }, n);

  // The House finishes: its construction sound.
  await host.waitForFunction(
    ([house, active]) => window.__game!.buildings().some((b) => b.owner === 1 && b.type === house && b.state === active),
    [HOUSE, ACTIVE] as const,
  );
  n = await heard(host, { event: 'built', sound: 113, source: HOUSE }, n);

  // The Town Center: selected with its sound; Villager trained: the button clicks, and the new Villager its created sound.
  const tc = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === TOWN_CENTER)!;
  await select(host, tc.id);
  n = await heard(host, { event: 'select', sound: 185, source: TOWN_CENTER }, n);
  const population = (await host.evaluate(() => window.__game!.population(1))).count;
  await slot(host, 'train', VILLAGER).click();
  n = await heard(host, { event: 'button', game: BUTTON }, n);
  await host.waitForFunction((count) => window.__game!.population(1).count === count, population + 1);
  n = await heard(host, { event: 'created', sound: 114, source: VILLAGER }, n);

  // Menu, then Game Settings: the slider moves the volume, Cancel puts it back, OK keeps it.
  const volume = () => host.evaluate(() => Number((document.querySelector('[data-testid=sound-volume]') as HTMLInputElement).value));
  const settings = async () => {
    await host.getByTestId('menu-menu').click();
    await host.getByTestId('menu-settings').click();
  };
  await settings();
  await expect(host.getByTestId('options-dialog')).toBeVisible();
  await heard(host, { event: 'button', game: BUTTON }, n);
  const start = await volume();
  await host.getByTestId('sound-volume').fill('99');
  await host.getByTestId('options-cancel').click();
  await expect(host.getByTestId('options-dialog')).toBeHidden();
  await settings();
  expect(await volume()).toBe(start);
  await host.getByTestId('sound-volume').fill('40');
  await host.getByTestId('options-ok').click();
  await expect(host.getByTestId('options-dialog')).toBeHidden();
  expect(await host.evaluate(() => localStorage.getItem('aoe1web.soundVolume'))).toBe('40');

  // The guest gave no order and owns none of these objects: it heard none of the host's sounds.
  const other = await sounds(guest);
  expect(other.filter((t) => ['select', 'move', 'command', 'created', 'built', 'button'].includes(t.event))).toEqual([]);
});
