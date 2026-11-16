import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

// The F4 score display's latency and slow-player icons and the score button's rollover text (docs/spec/hud.md "Menu,
// game over, score display, achievements"): the guest fakes a slow machine, then a slow link, and the host's line for
// it shows the slow icon (btn6 frame 17), then the latency icon (frame 20 past 1000 ms).
const URL = '/?debug=net&map=test&speed=20';

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

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

const line = (page: Page, name: string) => page.getByTestId('score-line').filter({ hasText: `${name}:` });
/** The frames of the icons shown on `l`, slow first. */
const icons = (l: Locator) => l.locator('[data-testid^="score-"]:visible').evaluateAll((els) => els.map((el) => `${el.getAttribute('data-testid')} ${el.getAttribute('data-frame')}`));

test("a slow player's and a lagging player's score lines show the original's icons on the other client", async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  for (const page of [host, guest]) await page.keyboard.press('F4');
  // Normal play: both round trips measured (the pings at start), no icon on either screen.
  await host.waitForFunction(() => window.__game!.net().rtt.length === 2);
  for (const page of [host, guest]) {
    await expect(page.getByTestId('score-line').filter({ visible: true })).toHaveCount(2);
    for (const name of ['Alice', 'Bob']) expect(await icons(line(page, name))).toEqual([]);
  }

  // The guest reports 150 ms frames (6 fps): with the next round trips (8 s pings) and the next refresh (3 s) Bob's
  // line shows the slow icon on both screens, Alice's none.
  await guest.evaluate(() => window.__game!.forceFrameMs(150));
  await host.waitForFunction(() => window.__game!.net().frameTimes[1] === 150);
  await expect.poll(() => icons(line(host, 'Bob')), { timeout: 30_000 }).toEqual(['score-slow 17']);
  expect(await icons(line(host, 'Alice'))).toEqual([]);
  await expect.poll(() => icons(line(guest, 'Bob')), { timeout: 30_000 }).toEqual(['score-slow 17']);

  // Back to its own frame time, and every pong held 1.2 s: the round trip between the two is past 1000 ms, so on the
  // host Bob's line shows frame 20, and the slow icon goes.
  await guest.evaluate(() => {
    window.__game!.forceFrameMs(0);
    window.__game!.delayPongs(1200);
  });
  await expect.poll(() => icons(line(host, 'Bob')), { timeout: 40_000 }).toEqual(['score-latency 20']);
  expect(await icons(line(host, 'Alice'))).toEqual([]);
  // The guest's own line keeps 30 ms; the host's is the same round trip seen from the guest.
  await expect.poll(() => icons(line(guest, 'Alice')), { timeout: 30_000 }).toEqual(['score-latency 20']);
  expect(await icons(line(guest, 'Bob'))).toEqual([]);
});

test("the score button's rollover text shows on the message line and goes when the mouse moves off", async ({ browser }) => {
  const [host] = await startGame(browser);
  const message = host.getByTestId('hud-message');
  await expect(message).toBeHidden();
  await host.getByTestId('score-button').hover();
  // Language string 0x1024 (4132), white.
  await expect(message).toHaveText('Score (F4)');
  await expect(message).toBeVisible();
  await expect(message).toHaveCSS('color', 'rgb(255, 255, 255)');
  const box = (await host.getByTestId('score-button').boundingBox())!;
  await host.mouse.move(box.x - 200, box.y - 200);
  await expect(message).toBeHidden();
});
