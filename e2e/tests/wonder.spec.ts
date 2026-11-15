import { expect, test, type Browser, type Page } from '@playwright/test';

// The Wonder (docs/spec/victory.md §8, docs/spec/hud.md "Wonder"): Alice starts with a built Wonder left of her Town
// Center (`wonder=1`). Its action starts with it and counts from the first update: both screens are told it was started
// and completed, both show her Wonder clock top right in her colour, and when 2000 years (~1000 game seconds) have run
// out she wins, with end condition 100.
const URL = '/?debug=net&map=test&speed=20&wonder=1';
const WONDER = 276;
/** `TRIBE_Game::sounds`: mstart.wav, mdone.wav. */
const SOUND_STARTED = 8;
const SOUND_COMPLETED = 9;
const END_WONDER = 100;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

const chatLines = (page: Page) => page.getByTestId('chat-line');
const clocks = (page: Page) => page.getByTestId('countdown-clock');
const gameSounds = (page: Page, n: number) => page.evaluate((n) => window.__game!.sounds().filter((s) => s.event === 'message' && s.game === n).length, n);
const years = async (page: Page) => Number(/Wonder: (\d+) Years/.exec((await clocks(page).first().textContent()) ?? '')?.[1] ?? NaN);

test('a completed Wonder: both players are told, both show its countdown, and its owner wins when it runs out', async ({ browser }) => {
  test.setTimeout(600_000);
  const host = await open(browser);
  const guest = await open(browser);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await expect(host.getByTestId('player-1')).toContainText('Bob');
  await guest.getByTestId('ready').click();
  await expect(host.getByTestId('player-1')).toContainText('ready');
  await host.getByTestId('ready').click();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game?.selection() != null && window.__game.turn() > 5);

  for (const page of [host, guest]) {
    await expect.poll(() => page.evaluate((t) => window.__game!.objects().filter((o) => o.type === t).map((o) => o.owner), WONDER)).toEqual([1]);
  }
  await expect(chatLines(host).filter({ hasText: 'You have started building a Wonder!' })).toBeVisible();
  await expect(chatLines(host).filter({ hasText: 'You completed a Wonder. You will win if it stands for 2000 years!' })).toBeVisible();
  await expect(chatLines(guest).filter({ hasText: 'Alice started building a Wonder!' })).toBeVisible();
  await expect(chatLines(guest).filter({ hasText: 'Alice completed a Wonder. You will lose if it stands for 2000 years!' })).toBeVisible();
  for (const page of [host, guest]) {
    await expect.poll(() => gameSounds(page, SOUND_STARTED)).toBe(1);
    await expect.poll(() => gameSounds(page, SOUND_COMPLETED)).toBe(1);
    // One clock, top right of the view, in Alice's colour (blue), counting down in steps of 5 years.
    await expect(clocks(page).filter({ visible: true })).toHaveCount(1);
    await expect(clocks(page).first()).toHaveText(/^Wonder: \d+ Years$/);
    await expect(clocks(page).first()).toHaveCSS('color', 'rgb(0, 0, 255)');
    const first = await years(page);
    expect(first).toBeLessThanOrEqual(2000);
    expect(first % 5).toBe(0);
    await expect.poll(() => years(page)).toBeLessThan(first);
  }
  const view = (await host.getByTestId('hud-view').boundingBox())!;
  const clock = (await clocks(host).first().boundingBox())!;
  expect([Math.round(view.x + view.width - clock.x - clock.width), Math.round(clock.y - view.y), clock.width, clock.height]).toEqual([4, 4, 170, 20]);

  // 2000 years later: Alice wins on both screens.
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game!.gameResult() !== null, null, { timeout: 0 });
  for (const page of [host, guest]) {
    expect(await page.evaluate(() => window.__game!.gameResult())).toEqual({ endCondition: END_WONDER, winners: [1], status: [0, 1, 2] });
  }
  await expect(host.getByTestId('game-over-text')).toHaveText('You are victorious!');
  await expect(guest.getByTestId('game-over-text')).toHaveText('You have been defeated!');
});
