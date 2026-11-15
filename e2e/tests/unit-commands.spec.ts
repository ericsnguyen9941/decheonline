import { expect, test, type Browser, type Page } from '@playwright/test';

// speed=20 runs the lockstep clock 20x faster; 500 of each resource pays for the repair; two Bowmen per player damage
// the host's Town Center so there is something to repair.
const URL = '/?debug=net&map=test&speed=20&resources=500&bowmen=2';

// Master ids (empires.dat): Villager, the Villager's repair form (Repair_Man), Bowman, Town Center.
const VILLAGER = 83;
const REPAIR_MAN = 156;
const BOWMAN = 4;
const TOWN_CENTER = 109;

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

const units = (page: Page) => page.evaluate(() => window.__game!.units());
const slot = (page: Page, command: string) => page.locator(`[data-testid=command-slot][data-command=${command}]`);
const applied = (page: Page, type: string) => page.evaluate((t) => window.__game!.applied().flat().filter((c) => c.type === t), type);

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

test('Stop halts a walking Villager; Repair (R, then a click on the building) restores a damaged Town Center for wood', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  const box = await canvasBox(host);
  const villagers = (await units(host)).filter((u) => u.owner === 1 && u.type === VILLAGER);
  const v1 = villagers[0]!;
  const v2 = villagers[1]!;

  // Stop (the grid button, shown while the Villager has an action): a Villager sent 12 tiles off stops where it is.
  await selectUnit(host, v1.id);
  await expect(slot(host, 'stop')).toHaveCount(0);
  await host.evaluate(([id, x, y]) => window.__game!.issueMove([id], x, y), [v1.id, v1.x + 12, v1.y + 12] as const);
  await host.waitForFunction((id) => window.__game!.units().some((u) => u.id === id && u.moving), v1.id);
  await expect(slot(host, 'stop')).toHaveCount(1);
  await slot(host, 'stop').click();
  await expect.poll(() => applied(host, 'stop')).toEqual([{ type: 'stop', objects: [v1.id] }]);
  await host.waitForFunction((id) => window.__game!.units().some((u) => u.id === id && !u.moving), v1.id);
  const stopped = (await units(host)).find((u) => u.id === v1.id)!;
  expect(Math.hypot(stopped.x - (v1.x + 12), stopped.y - (v1.y + 12))).toBeGreaterThan(2);
  // With nothing to do, the Stop button goes (setup_buttons shows it only while an object has an action).
  await expect(slot(host, 'stop')).toHaveCount(0);

  // The guest's Bowmen shoot the host's Town Center until it has lost 10 hit points, then walk home.
  const tc = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === TOWN_CENTER)!;
  const bowmen = (await units(guest)).filter((u) => u.owner === 2 && u.type === BOWMAN);
  await guest.evaluate(([ids, id, x, y]) => window.__game!.issueWork(ids, id, x, y), [bowmen.map((b) => b.id), tc.id, tc.x, tc.y] as const);
  await host.waitForFunction(([id, hp]) => window.__game!.buildings().find((b) => b.id === id)!.hp <= hp - 10, [tc.id, tc.hp] as const);
  const home = bowmen[0]!;
  await guest.evaluate(([ids, x, y]) => window.__game!.issueMove(ids, x, y), [bowmen.map((b) => b.id), home.x, home.y] as const);
  await host.waitForFunction(
    ([ids, x, y]) => window.__game!.units().filter((u) => ids.includes(u.id)).every((u) => Math.hypot(u.x - x, u.y - y) < 3),
    [bowmen.map((b) => b.id), home.x, home.y] as const,
  );
  const damaged = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.id === tc.id)!.hp;
  expect(damaged).toBeLessThan(tc.hp);

  // Repair: R arms the click mode (its message says so), a click on the Town Center orders the repair. The Villager
  // turns into its repair form and heals the building to full, paying wood.
  await selectUnit(host, v2.id);
  await expect(slot(host, 'repair')).toHaveCount(1);
  await host.keyboard.press('r');
  await expect(host.getByTestId('hud-message')).toHaveText('Click the building or boat to repair.');
  const wood = (await host.evaluate(() => window.__game!.resources())).wood;
  const at = (await host.evaluate((id) => window.__game!.objectScreenPos(id), tc.id))!;
  await host.mouse.click(box.x + at.x, box.y + at.y);
  await expect.poll(() => applied(host, 'repair')).toEqual([{ type: 'repair', units: [v2.id], target: tc.id }]);
  await host.waitForFunction(([id, type]) => window.__game!.units().some((u) => u.id === id && u.type === type), [v2.id, REPAIR_MAN] as const);
  await host.waitForFunction(([id, hp]) => window.__game!.buildings().find((b) => b.id === id)!.hp >= hp, [tc.id, tc.hp] as const);
  expect((await host.evaluate(() => window.__game!.resources())).wood).toBeLessThan(wood);

  // Both clients agree on the hash of a turn both have run.
  const turns = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game!.turn())));
  const turn = Math.max(...turns) + 2;
  for (const page of [host, guest]) await page.waitForFunction((t) => window.__game!.turn() > t, turn);
  const [a, b] = await Promise.all([host, guest].map((p) => p.evaluate((t) => window.__game!.hash(t), turn)));
  expect(a).toBeDefined();
  expect(a).toBe(b);
  console.log(`turn ${turn} hash ${a}: TC ${tc.id} ${tc.hp} -> ${damaged} -> repaired, wood ${wood} spent`);
});
