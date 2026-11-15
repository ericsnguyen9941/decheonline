import { expect, test, type Browser, type Page } from '@playwright/test';

// speed=20 runs the lockstep clock 20x faster; bowmen=1 gives each player a Bowman above its Villagers.
const URL = '/?debug=net&map=test&speed=20&bowmen=1';

// Master ids (empires.dat): Villager, Bowman.
const VILLAGER = 83;
const BOWMAN = 4;

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
const selection = (page: Page) => page.evaluate(() => [...window.__game!.selection()!].sort((a, b) => a - b));

async function canvasBox(page: Page) {
  return (await page.getByTestId('game-canvas').boundingBox())!;
}

/** Drag a box that holds the drawn middle of every unit in `ids` (box selection takes own units only). */
async function boxSelect(page: Page, ids: number[]): Promise<void> {
  const box = await canvasBox(page);
  const at = await Promise.all(ids.map((id) => page.evaluate((i) => window.__game!.unitScreenPos(i), id)));
  const xs = at.map((p) => p!.x);
  const ys = at.map((p) => p!.y);
  await page.mouse.move(box.x + Math.min(...xs) - 14, box.y + Math.min(...ys) - 14);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.max(...xs) + 14, box.y + Math.max(...ys) + 14, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => selection(page)).toEqual([...ids].sort((a, b) => a - b));
}

test('Ctrl+digit assigns a group, a digit recalls it, Shift adds, Alt centres, and a dead unit leaves it', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  const all = await units(host);
  const [v1, v2, v3] = all.filter((u) => u.owner === 1 && u.type === VILLAGER).map((u) => u.id) as [number, number, number];
  const bowman = all.find((u) => u.owner === 1 && u.type === BOWMAN)!.id;
  const hostile = all.find((u) => u.owner === 2 && u.type === BOWMAN)!.id;

  // The host's Bowman walks off, so that only the Villagers are in a box round them (and out of the way of the other Bowman and the fleeing Villager).
  await host.evaluate((id) => window.__game!.issueMove([id], 4.5, 20.5), bowman);
  await host.waitForFunction(
    (id) => window.__game!.units().some((u) => u.id === id && !u.moving && Math.hypot(u.x - 4.5, u.y - 20.5) < 2),
    bowman,
  );

  // Ctrl+1 puts the three Villagers in group 1. An empty group (2) empties the selection, group 1 selects all three.
  await boxSelect(host, [v1, v2, v3]);
  await host.keyboard.press('Control+Digit1');
  await host.keyboard.press('Digit2');
  expect(await selection(host)).toEqual([]);
  await host.keyboard.press('Digit1');
  expect(await selection(host)).toEqual([v1, v2, v3]);

  // An object has one group: v1 in group 2 leaves group 1.
  await boxSelect(host, [v1]);
  await host.keyboard.press('Control+Digit2');
  await host.keyboard.press('Digit1');
  expect(await selection(host)).toEqual([v2, v3]);
  await host.keyboard.press('Digit2');
  expect(await selection(host)).toEqual([v1]);

  // Shift+1 adds group 1 to the selection.
  await host.keyboard.press('Shift+Digit1');
  expect(await selection(host)).toEqual([v1, v2, v3]);

  // Alt+2 selects group 2 and scrolls the view to it, from where the camera was.
  const box = await canvasBox(host);
  const fromCentre = async () => {
    const at = await host.evaluate((id) => window.__game!.unitScreenPos(id), v1);
    return at ? Math.hypot(at.x - box.width / 2, at.y - box.height / 2) : null;
  };
  await host.evaluate(() => window.__map!.centerOnTile(30, 30));
  await expect.poll(async () => (await fromCentre()) ?? Infinity).toBeGreaterThan(400);
  await host.keyboard.press('Alt+Digit2');
  expect(await selection(host)).toEqual([v1]);
  await expect.poll(async () => (await fromCentre()) ?? Infinity).toBeLessThan(40);

  // The other player's Bowman kills v3: it leaves the selection and, recalled later, the group.
  await host.keyboard.press('Digit1');
  expect(await selection(host)).toEqual([v2, v3]);
  // A Villager that is shot at runs, so the order is given again, to where it stands, until it is dead.
  await guest.waitForFunction(
    ([shooter, target]) => {
      const game = window.__game!;
      const prey = game.units().find((u) => u.id === target);
      if (!prey) return true;
      const state = window as unknown as { shot?: number };
      if (state.shot === undefined || game.turn() - state.shot >= 20) {
        state.shot = game.turn();
        game.issueWork([shooter!], target!, prey.x, prey.y);
      }
      return false;
    },
    [hostile, v3],
  );
  await host.waitForFunction((id) => !window.__game!.units().some((u) => u.id === id), v3);
  expect(await selection(host)).toEqual([v2]);
  await host.keyboard.press('Digit2');
  expect(await selection(host)).toEqual([v1]);
  await host.keyboard.press('Digit1');
  expect(await selection(host)).toEqual([v2]);
  await host.keyboard.press('Shift+Digit2');
  expect(await selection(host)).toEqual([v1, v2]);
});
