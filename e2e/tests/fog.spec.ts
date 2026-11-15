import { expect, test, type Browser, type Page } from '@playwright/test';

// Fog of war and the minimap (docs/spec/hud.md "Fog of war", "Minimap"). speed=20 runs the lockstep clock 20x faster.
const URL = '/?debug=net&map=test&speed=20';
const VISIBLE = 0x0f;
const FOGGED = 0x80;
const BLACK = 0;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

/** Host creates, guest joins by code, both ready, host starts; resolves once both have drawn their units. */
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
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__game?.selection() != null && window.__map !== undefined && window.__game.minimapPoint(0, 0) !== null);
  }
  return [host, guest];
}

type Unit = Awaited<ReturnType<NonNullable<Window['__game']>['units']>>[number];

const units = (page: Page): Promise<Unit[]> => page.evaluate(() => window.__game!.units());
const visibility = (page: Page, col: number, row: number): Promise<number> =>
  page.evaluate(([c, r]) => window.__game!.tileVisibility(c!, r!), [col, row]);

/** Centre the view on unit `id` and give the unit layer a few frames; then where it is drawn, or null when hidden. */
async function drawnAt(page: Page, u: Unit): Promise<{ x: number; y: number } | null> {
  await page.evaluate(([c, r]) => window.__map!.centerOnTile(c!, r!), [u.col, u.row]);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  return page.evaluate((id) => window.__game!.objectScreenPos(id), u.id);
}

/** The minimap canvas's pixels as 0xRRGGBB (-1 where transparent: outside map.bmp's lines). */
async function minimap(page: Page): Promise<{ width: number; at: (x: number, y: number) => number; pixels: number[] }> {
  const { width, pixels } = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="minimap-canvas"]')!;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixels: number[] = [];
    for (let i = 0; i < data.length; i += 4) pixels.push(data[i + 3] === 0 ? -1 : (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    return { width: canvas.width, pixels };
  });
  return { width, pixels, at: (x, y) => pixels[y * width + x]! };
}

/** Where tile (col, row) is on the minimap. */
const minimapPoint = (page: Page, col: number, row: number) =>
  page.evaluate(([c, r]) => window.__game!.minimapPoint(c!, r!)!, [col, row]);

test('each player sees only its own area; the other player units show once in sight and hide again in the fog', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  const all = await units(host);
  const mine = all.filter((u) => u.owner === 1);
  const theirs = all.filter((u) => u.owner === 2);

  // At the start each sees its own villagers' tiles and has never seen the other's.
  for (const u of mine) expect(await visibility(host, u.col, u.row)).toBe(VISIBLE);
  for (const u of theirs) expect(await visibility(guest, u.col, u.row)).toBe(VISIBLE);
  for (const u of theirs) expect(await visibility(host, u.col, u.row)).toBe(BLACK);
  for (const u of mine) expect(await visibility(guest, u.col, u.row)).toBe(BLACK);
  // Looking straight at the other's villagers shows nothing.
  expect(await drawnAt(host, theirs[0]!)).toBeNull();
  expect(await drawnAt(guest, mine[0]!)).toBeNull();
  expect(await drawnAt(host, mine[0]!)).not.toBeNull();

  // The host walks its villagers up to the guest's: then each sees the other's.
  const target = theirs[0]!;
  await host.evaluate(([ids, x, y]) => window.__game!.issueMove(ids as number[], x as number, y as number), [mine.map((u) => u.id), target.x - 2, target.y]);
  await host.waitForFunction(([c, r]) => window.__game!.tileVisibility(c!, r!) === 0x0f, [target.col, target.row]);
  await expect.poll(() => drawnAt(host, target)).not.toBeNull();
  // The walker keeps moving: read its current tile on every poll.
  const walker = async () => (await units(guest)).find((u) => u.id === mine[0]!.id)!;
  await expect.poll(async () => { const w = await walker(); return visibility(guest, w.col, w.row); }).toBe(VISIBLE);
  await expect.poll(async () => drawnAt(guest, await walker())).not.toBeNull();

  // Walking home again leaves the guest's tile fogged for the host, and its villager no longer drawn there.
  await host.evaluate(([ids, x, y]) => window.__game!.issueMove(ids as number[], x as number, y as number), [mine.map((u) => u.id), mine[0]!.x, mine[0]!.y]);
  await host.waitForFunction(([c, r]) => window.__game!.tileVisibility(c!, r!) === 0x80, [target.col, target.row]);
  expect(await visibility(host, target.col, target.row)).toBe(FOGGED);
  await expect.poll(() => drawnAt(host, target)).toBeNull();
});

test('the minimap shows the explored tiles, grows as a unit explores, and moves the view on a click', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  const all = await units(host);
  const mine = all.filter((u) => u.owner === 1);
  const theirs = all.filter((u) => u.owner === 2);
  const home = await minimapPoint(host, mine[0]!.col, mine[0]!.row);
  const away = await minimapPoint(host, theirs[0]!.col, theirs[0]!.row);

  // Inside the lines: the background colour (palette 0) where unexplored, the terrain's colour where explored.
  const start = await minimap(host);
  const background = start.at(away.x, away.y);
  expect(background).not.toBe(-1);
  const explored = (m: { pixels: number[] }) => m.pixels.filter((p) => p !== -1 && p !== background).length;
  expect(explored(start)).toBeGreaterThan(20);
  expect(start.at(home.x + 3, home.y)).not.toBe(background);
  // The guest's minimap is its own: its base explored, the host's not.
  const guestStart = await minimap(guest);
  expect(guestStart.at(home.x, home.y)).toBe(background);
  expect(guestStart.at(away.x + 3, away.y)).not.toBe(background);

  // A villager walking towards the guest's base explores the tiles on the way.
  const target = theirs[0]!;
  await host.evaluate(([ids, x, y]) => window.__game!.issueMove(ids as number[], x as number, y as number), [[mine[0]!.id], target.x - 3, target.y]);
  await host.waitForFunction(([c, r]) => window.__game!.tileVisibility(c!, r!) === 0x0f, [target.col, target.row]);
  await expect.poll(async () => (await minimap(host)).at(away.x + 3, away.y)).not.toBe(background);
  expect(explored(await minimap(host))).toBeGreaterThan(explored(start));

  // A left press on the minimap centres the main view on that tile.
  const box = (await host.getByTestId('minimap-canvas').boundingBox())!;
  await host.mouse.click(box.x + away.x + 0.5, box.y + away.y + 0.5);
  const canvas = (await host.getByTestId('game-canvas').boundingBox())!;
  const centre = await host.evaluate(([w, h]) => window.__map!.tileAt(w! / 2, h! / 2)!, [canvas.width, canvas.height]);
  expect(Math.abs(centre.col - target.col)).toBeLessThanOrEqual(2);
  expect(Math.abs(centre.row - target.row)).toBeLessThanOrEqual(2);
});
