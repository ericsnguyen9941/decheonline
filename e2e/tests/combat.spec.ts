import { expect, test, type Browser, type Page } from '@playwright/test';

// speed=20 runs the lockstep clock 20x faster, so building a Barracks, training a Clubman and the fight take seconds.
const URL = '/?debug=net&speed=20';

// Master ids (empires.dat): Villager, Barracks, Clubman, and the body a Villager leaves (`dead_unit`).
const VILLAGER = 83;
const BARRACKS = 12;
const CLUBMAN = 73;
const DEAD_MAN = 43;
/** `object_state`: active, dying. */
const ACTIVE = 2;
const DYING = 3;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
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

/** Drag a small box round own unit `id` (box selection takes units only), and check it is the selection. */
async function selectUnit(page: Page, id: number): Promise<void> {
  const box = await canvasBox(page);
  const at = (await page.evaluate((i) => window.__game!.unitScreenPos(i), id))!;
  await page.mouse.move(box.x + at.x - 12, box.y + at.y - 12);
  await page.mouse.down();
  await page.mouse.move(box.x + at.x + 12, box.y + at.y + 12, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__game!.selection())).toEqual([id]);
}

test.setTimeout(180_000);

test("a Clubman trained at a Barracks kills the other player's Villager; both clients show the body and agree on the hash", async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  const box = await canvasBox(host);

  // The host's villager places a Barracks on open ground east of the Town Center and builds it.
  const villager = (await host.evaluate(() => window.__game!.units())).find((u) => u.owner === 1 && u.type === VILLAGER)!;
  await selectUnit(host, villager.id);
  await slot(host, 'build').click();
  await slot(host, 'place', BARRACKS).click();
  const spot = await host.evaluate(() => window.__map!.tileScreenPos(15, 8));
  await host.mouse.move(box.x + spot.x, box.y + spot.y);
  await expect.poll(() => host.evaluate(() => window.__game!.ghost())).toMatchObject({ unit: BARRACKS, fits: true });
  await host.mouse.click(box.x + spot.x, box.y + spot.y);
  await host.waitForFunction(
    ([type, active]) => window.__game!.buildings().some((b) => b.owner === 1 && b.type === type && b.state === active),
    [BARRACKS, ACTIVE] as const,
    { timeout: 60_000 },
  );

  // The Barracks trains one Clubman.
  const barracks = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.type === BARRACKS)!;
  const barracksAt = (await host.evaluate((id) => window.__game!.objectScreenPos(id), barracks.id))!;
  await host.mouse.click(box.x + barracksAt.x, box.y + barracksAt.y);
  await expect.poll(() => host.evaluate(() => window.__game!.selection())).toEqual([barracks.id]);
  await slot(host, 'train', CLUBMAN).click();
  await host.waitForFunction((type) => window.__game!.units().some((u) => u.owner === 1 && u.type === type), CLUBMAN, { timeout: 60_000 });
  const clubman = (await host.evaluate(() => window.__game!.units())).find((u) => u.owner === 1 && u.type === CLUBMAN)!;
  await selectUnit(host, clubman.id);

  // Scroll to one of the guest's villagers: over it the pointer is the attack cursor (no work hand), and a right click
  // orders an attack on it.
  const prey = (await host.evaluate(() => window.__game!.units())).find((u) => u.owner === 2 && u.type === VILLAGER)!;
  // It is in the fog until the Clubman walks up to it (docs/spec/hud.md "Fog of war").
  await host.evaluate(([id, x, y]) => window.__game!.issueMove([id], x - 2, y), [clubman.id, prey.x, prey.y] as const);
  await host.waitForFunction(([col, row]) => window.__game!.tileVisibility(col, row) === 0x0f, [prey.col, prey.row] as const, { timeout: 60_000 });
  await host.evaluate(([col, row]) => window.__map!.centerOnTile(col, row), [prey.col, prey.row] as const);
  await host.evaluate(() => new Promise(requestAnimationFrame));
  const preyAt = (await host.evaluate((id) => window.__game!.objectScreenPos(id), prey.id))!;
  await host.mouse.move(box.x + preyAt.x, box.y + preyAt.y);
  const cursor = await host.getByTestId('game-canvas').evaluate((c) => c.style.cursor);
  expect(cursor).not.toBe('');
  expect(cursor).not.toContain('--cursor-work');
  await host.mouse.click(box.x + preyAt.x, box.y + preyAt.y, { button: 'right' });
  await expect
    .poll(() => host.evaluate(() => window.__game!.applied()[0]!.filter((c) => c.type === 'attack')))
    .toEqual([{ type: 'attack', units: [clubman.id], target: prey.id }]);

  // On both clients the villager dies (dying, then gone) and leaves its body, which is drawn.
  for (const page of [host, guest]) {
    await page.waitForFunction(
      ([id, dying, dead]) => {
        const objects = window.__game!.objects();
        const villager = objects.find((o) => o.id === id);
        return (villager === undefined || villager.state >= dying) && objects.some((o) => o.owner === 2 && o.type === dead);
      },
      [prey.id, DYING, DEAD_MAN] as const,
      { timeout: 90_000 },
    );
  }
  for (const page of [host, guest]) {
    const body = (await page.evaluate(() => window.__game!.objects())).find((o) => o.owner === 2 && o.type === DEAD_MAN)!;
    await expect.poll(() => page.evaluate((id) => window.__game!.objectScreenPos(id), body.id)).not.toBeNull();
  }
  // The host's Clubman is still alive and the villager is gone (the Clubman's unit AI may go on to the next one).
  for (const page of [host, guest]) {
    const units = await page.evaluate(() => window.__game!.units());
    expect(units.some((u) => u.id === clubman.id)).toBe(true);
    expect(units.some((u) => u.id === prey.id)).toBe(false);
  }

  // Both clients agree on the hash of a turn both have run.
  const turns = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game!.turn())));
  const turn = Math.max(...turns) + 2;
  for (const page of [host, guest]) await page.waitForFunction((t) => window.__game!.turn() > t, turn);
  const [a, b] = await Promise.all([host, guest].map((p) => p.evaluate((t) => window.__game!.hash(t), turn)));
  expect(a).toBeDefined();
  expect(a).toBe(b);
  console.log(`turn ${turn} hash ${a}: villager ${prey.id} killed by clubman ${clubman.id}; cursor ${cursor.slice(0, 40)}`);
});
