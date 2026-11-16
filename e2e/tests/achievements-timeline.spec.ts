import { expect, test, type Browser, type Page } from '@playwright/test';

// speed=20 runs the lockstep clock 20x faster; resources=2000 and a built Barracks (12) and Granary (68) per player let
// player 1 research the Tool Age (101) at once, so its history has an age event.
const URL = '/?debug=net&map=test&speed=20&resources=2000&buildings=12,68';
const TOWN_CENTER = 109;
const TOOL_AGE = 101;
const DONE = 3;
/** The timeline's colours of colour tables 0 and 1 (COLORREF 0xC40000, 0x0000C8) and the graph's top left. */
const BLUE = [0, 0, 196, 255];
const RED = [200, 0, 0, 255];
const X_START = 27;

test.setTimeout(600_000);

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

/** Host creates, guest joins by code, both ready, host starts; resolves once both have drawn the game screen. */
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
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game?.selection() != null && window.__game.turn() > 5);
  return [host, guest];
}

async function menuConfirm(page: Page, item: 'menu-resign' | 'menu-quit'): Promise<void> {
  await page.getByTestId('menu-menu').click();
  await page.getByTestId(item).click();
  await page.getByTestId('popup-yes').click();
}

/** The timeline canvas's pixel at (x, y). */
const pixel = (page: Page, x: number, y: number) =>
  page.getByTestId('timeline-canvas').evaluate((c, [px, py]) => [...(c as HTMLCanvasElement).getContext('2d')!.getImageData(px!, py!, 1, 1).data], [x, y]);

/** Timeline: the population history's graph, the names and the ages; Back returns to the summary. */
async function checkTimeline(page: Page): Promise<void> {
  const history = await page.evaluate(() => [window.__game!.history(1), window.__game!.history(2)]);
  await expect(page.getByTestId('achievements-name-1')).toBeVisible();
  await page.getByTestId('achievements-timeline').click();
  await expect(page.getByTestId('achievements-summary')).toHaveText('Timeline');
  await expect(page.getByTestId('achievements-timeline-panel')).toBeVisible();
  await expect(page.getByTestId('achievements-name-1')).toBeHidden();
  await expect(page.getByTestId('achievements-back')).toBeVisible();
  await expect(page.getByTestId('timeline-axis-population')).toHaveText('World Population');
  await expect(page.getByTestId('timeline-axis-time')).toHaveText('Time (Hr:Min)');
  await expect(page.getByTestId('timeline-name')).toHaveText([/^Alice - \w+/, /^Bob - \w+/]);
  await expect(page.getByTestId('timeline-age')).toHaveText(['Tool Age']);
  // The first entry's total and time are the last labels drawn (the original's list is newest first).
  await expect(page.getByTestId('timeline-total').last()).toHaveText(String(history[0]!.population[0]! + history[1]!.population[0]!));
  await expect(page.getByTestId('timeline-time').last()).toHaveText('0:00');
  // The first column: player 1's band in blue at the top, player 2's in red at the bottom.
  const height = await page.getByTestId('timeline-canvas').evaluate((c) => (c as HTMLCanvasElement).height);
  expect(await pixel(page, X_START, 16 * 2 + 15 + 3)).toEqual(BLUE);
  // The graph's last line is at height - 2 x 16 - 15 (the axis font 16 high).
  expect(await pixel(page, X_START, height - 16 * 2 - 18)).toEqual(RED);
  await page.getByTestId('achievements-back').click();
  await expect(page.getByTestId('achievements-timeline-panel')).toBeHidden();
  await expect(page.getByTestId('achievements-name-1')).toBeVisible();
}

test('after the game, Timeline shows each player population share with the ages reached; the X asks and Yes leaves', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  const tc = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === TOWN_CENTER)!;
  await host.evaluate(([building, tech]) => window.__game!.issue({ type: 'research', building, tech }), [tc.id, TOOL_AGE]);
  await host.waitForFunction(([t, s]) => window.__game!.techState(t, 1) === s, [TOOL_AGE, DONE] as const);
  // The event is at the entry count when the age was reached; one more entry draws its column.
  await host.waitForFunction(() => {
    const h = window.__game!.history(1);
    return h.events.length === 1 && h.population.length > h.events[0]!.time + 1;
  });

  // The guest resigns and quits: the end of the game's achievements. The host opens them from the menu.
  await menuConfirm(guest, 'menu-resign');
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game!.gameResult() !== null);
  await menuConfirm(guest, 'menu-quit');
  await expect(guest.getByTestId('achievements')).toBeVisible();
  await host.getByTestId('menu-menu').click();
  await host.getByTestId('menu-achievements').click();
  await expect(host.getByTestId('achievements')).toBeVisible();
  for (const page of [host, guest]) await test.step('timeline', () => checkTimeline(page));

  // The debug strip of `?debug=net` covers the screen's top right corner.
  for (const page of [host, guest]) await page.getByTestId('net-debug').evaluate((el) => el.remove());
  // The X, 17 x 17 at the top right: "Are you sure you want to quit this game?"; No (or Esc) keeps the screen.
  const box = (await guest.getByTestId('achievements-x').boundingBox())!;
  const panel = (await guest.getByTestId('achievements').boundingBox())!;
  expect([box.width, box.height, panel.x + panel.width - box.x - box.width, box.y - panel.y]).toEqual([17, 17, 4, 4]);
  await expect(guest.getByTestId('achievements-x')).toHaveText('X');
  await guest.getByTestId('achievements-x').click();
  await expect(guest.getByTestId('popup-text')).toHaveText('Are you sure you want to quit this game?');
  await guest.getByTestId('popup-no').click();
  await expect(guest.getByTestId('popup')).toHaveCount(0);
  await guest.getByTestId('achievements-x').click();
  await guest.keyboard.press('Escape');
  await expect(guest.getByTestId('popup')).toHaveCount(0);
  await expect(guest.getByTestId('achievements')).toBeVisible();
  // Yes leaves the game, from the end screen and from the in-game one.
  for (const [name, page] of [['guest', guest], ['host', host]] as const) {
    await test.step(`${name}: X, Yes`, async () => {
      await page.getByTestId('achievements-x').click();
      await page.getByTestId('popup-yes').click();
      await expect(page.getByTestId('achievements')).toHaveCount(0);
      await page.waitForFunction(() => window.__game === undefined);
    });
  }
});
