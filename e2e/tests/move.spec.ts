import { expect, test, type Browser, type Page } from '@playwright/test';

// speed=20 runs the lockstep clock 20x faster, so a walk of a few tiles takes a few seconds.
const URL = '/?debug=net&map=test&speed=20';

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
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
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game?.selection() != null && window.__map !== undefined);
  return [host, guest];
}

type Unit = Awaited<ReturnType<NonNullable<Window['__game']>['units']>>[number];

const units = (page: Page): Promise<Unit[]> => page.evaluate(() => window.__game!.units());

async function canvasBox(page: Page) {
  return (await page.getByTestId('game-canvas').boundingBox())!;
}

/** Right click on the middle of tile (col, row), which must be on screen. */
async function rightClickTile(page: Page, col: number, row: number): Promise<void> {
  const box = await canvasBox(page);
  const p = await page.evaluate(([c, r]) => window.__map!.tileScreenPos(c!, r!), [col, row]);
  expect(p.x > 0 && p.y > 0 && p.x < box.width && p.y < box.height).toBe(true);
  await page.mouse.click(box.x + p.x, box.y + p.y, { button: 'right' });
}

/**
 * Once `commands` have been received and executed (a batch received at turn N runs COMMAND_DELAY_TURNS = 2 turns
 * later) and no unit has a move action left: a turn both clients ran since, and its hashes.
 */
async function settle(host: Page, guest: Page, commands: number): Promise<{ turn: number; hashes: (number | undefined)[] }> {
  let received = 0;
  for (const page of [host, guest]) {
    await page.waitForFunction((n) => window.__game!.applied().flat().length === n, commands);
    received = Math.max(received, await page.evaluate(() => window.__game!.turn()));
  }
  for (const page of [host, guest]) {
    await page.waitForFunction(
      (t) => window.__game!.turn() > t + 2 && window.__game!.units().every((u) => !u.moving),
      received,
    );
  }
  const turn = Math.max(...(await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game!.turn()))))) + 2;
  for (const page of [host, guest]) await page.waitForFunction((t) => window.__game!.turn() > t, turn);
  return { turn, hashes: await Promise.all([host, guest].map((p) => p.evaluate((t) => window.__game!.hash(t), turn))) };
}

test('a unit moved with the mouse ends on the same tile in both clients and the hashes stay equal', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  expect(await host.evaluate(() => window.__game!.player())).toBe(1);
  expect(await guest.evaluate(() => window.__game!.player())).toBe(2);

  // Host: left click its first villager, then right click a tile a few tiles away.
  const hostUnit = (await units(host)).find((u) => u.owner === 1)!;
  const box = await canvasBox(host);
  // The click goes a little above the unit's map position, onto the sprite's body.
  const at = (await host.evaluate((id) => window.__game!.unitScreenPos(id), hostUnit.id))!;
  await host.mouse.click(box.x + at.x, box.y + at.y - 15);
  expect(await host.evaluate(() => window.__game!.selection())).toEqual([hostUnit.id]);
  await rightClickTile(host, 15, 15);

  // Guest: drag a box round all three of its villagers and send them off together.
  const own = (await units(guest)).filter((u) => u.owner === 2);
  const points = await Promise.all(own.map((u) => guest.evaluate((id) => window.__game!.unitScreenPos(id)!, u.id)));
  const gbox = await canvasBox(guest);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  await guest.mouse.move(gbox.x + Math.min(...xs) - 20, gbox.y + Math.min(...ys) - 20);
  await guest.mouse.down();
  await guest.mouse.move(gbox.x + Math.max(...xs) + 20, gbox.y + Math.max(...ys) + 20, { steps: 5 });
  await guest.mouse.up();
  expect((await guest.evaluate(() => window.__game!.selection()))!.sort()).toEqual(own.map((u) => u.id).sort());
  await rightClickTile(guest, 34, 26);
  // The host cannot order the guest's units: the sim ignores it.
  await host.evaluate((ids) => window.__game!.issueMove(ids, 5, 5), own.map((u) => u.id));

  const { turn, hashes } = await settle(host, guest, 3);
  expect(hashes[0]).toBeDefined();
  expect(hashes[0]).toBe(hashes[1]);

  const [a, b] = await Promise.all([units(host), units(guest)]);
  expect(a).toEqual(b);
  const moved = a.find((u) => u.id === hostUnit.id)!;
  console.log(`turn ${turn} hash ${hashes[0]}: unit ${moved.id} on tile [${moved.col},${moved.row}] in both clients`);
  // It walked from tile [10,10] and stopped within its move range of the middle of tile [15,15].
  expect(Math.hypot(moved.x - 15.5, moved.y - 15.5)).toBeLessThan(1);
  for (const u of a.filter((u) => u.owner === 2)) expect(Math.hypot(u.x - 34.5, u.y - 26.5)).toBeLessThan(3);
  expect(await host.evaluate(() => window.__game!.applied().map((c) => c.map((x) => x.type)))).toEqual([['move', 'move'], ['move']]);
});
