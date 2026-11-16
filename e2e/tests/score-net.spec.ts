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
  // Normal play: both round trips measured (the pings at start), no icon on either screen. Both clients report a fixed
  // 30 ms frame time: the icons follow the frame times within a turn now, so a loaded machine's real ones would show.
  for (const page of [host, guest]) await page.evaluate(() => window.__game!.forceFrameMs(30));
  await host.waitForFunction(() => window.__game!.net().rtt.length === 2);
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__game!.net().frameTimes.join() === '30,30');
    await expect(page.getByTestId('score-line').filter({ visible: true })).toHaveCount(2);
    for (const name of ['Alice', 'Bob']) await expect.poll(() => icons(line(page, name))).toEqual([]);
  }

  // The guest reports 150 ms frames (6 fps) with each turn: within 2 s Bob's line shows the slow icon on both screens,
  // Alice's none (the frame times ride on every released turn, not only on the 8 s round-trip message).
  const slowedAt = Date.now();
  await guest.evaluate(() => window.__game!.forceFrameMs(150));
  await expect.poll(() => icons(line(host, 'Bob')), { timeout: 2000, intervals: [50] }).toEqual(['score-slow 17']);
  const delay = Date.now() - slowedAt;
  console.log(`slow icon shown on the host ${delay} ms after the guest's frames slowed`);
  expect(delay).toBeLessThan(2000);
  expect(await icons(line(host, 'Alice'))).toEqual([]);
  await expect.poll(() => icons(line(guest, 'Bob')), { timeout: 2000, intervals: [50] }).toEqual(['score-slow 17']);

  // Back to a normal frame time, and every pong held 1.2 s: the round trip between the two is past 1000 ms, so on the
  // host Bob's line shows frame 20, and the slow icon goes.
  await guest.evaluate(() => {
    window.__game!.forceFrameMs(30);
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

test("a dropped player's score line is struck out", async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  await host.keyboard.press('F4');
  const bob = line(host, 'Bob').first();
  const decoration = () => bob.evaluate((el) => getComputedStyle(el).textDecorationLine);
  await expect(bob).toBeVisible();
  expect(await decoration()).not.toContain('line-through');
  // The guest's socket breaks and stays away past the server's drop time (DROP_AFTER_MS, 40 s in the e2e server).
  await guest.evaluate(() => window.__game!.dropLink(90_000));
  await expect.poll(decoration, { timeout: 90_000 }).toContain('line-through');
  expect(await line(host, 'Alice').first().evaluate((el) => getComputedStyle(el).textDecorationLine)).not.toContain('line-through');
});
