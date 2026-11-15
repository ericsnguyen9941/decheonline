import { expect, test, type Browser, type Page } from '@playwright/test';

const URL = '/?debug=net&map=test&speed=20';
/** `game_status`: won, lost. */
const WON = 1;
const LOST = 2;
/** Interface wavs won.wav and lost.wav. */
const WAV_WON = 50320;
const WAV_LOST = 50321;

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

/** Menu, then `item`, then Yes in its confirmation. */
async function menuConfirm(page: Page, item: 'menu-resign' | 'menu-quit'): Promise<void> {
  await page.getByTestId('menu-menu').click();
  await page.getByTestId(item).click();
  await page.getByTestId('popup-yes').click();
}

const result = (page: Page) => page.evaluate(() => window.__game!.gameResult());
const gameOverWavs = (page: Page) => page.evaluate(() => window.__game!.sounds().flatMap((s) => (s.event === 'game-over' ? [s.wav] : [])));

/** Both games over: host (player 1) won, guest (player 2) lost, the same result on both, with its text and sound. */
async function expectHostWon(host: Page, guest: Page): Promise<void> {
  // The chat line lives 8 s: assert it right after the host's result, before the slower checks below.
  await host.waitForFunction(() => window.__game!.gameResult() !== null);
  await expect(host.getByTestId('chat-line').filter({ hasText: 'Bob resigned.' })).toBeVisible();
  await guest.waitForFunction(() => window.__game!.gameResult() !== null);
  const [h, g] = [await result(host), await result(guest)];
  expect(h).toEqual(g);
  expect(h!.winners).toEqual([1]);
  expect(h!.status.slice(1)).toEqual([WON, LOST]);
  await expect(host.getByTestId('game-over-text')).toHaveText('You are victorious!');
  await expect(guest.getByTestId('game-over-text')).toHaveText('You have been defeated!');
  await expect.poll(() => gameOverWavs(host)).toEqual([WAV_WON]);
  await expect.poll(() => gameOverWavs(guest)).toEqual([WAV_LOST]);
  await expect(host.getByTestId('opponent-left')).toHaveCount(0);
}

test('Resign ends the game for both: the other player wins, each sees its result, the score and the achievements', async ({ browser }) => {
  const [host, guest] = await startGame(browser);

  // F4 shows each player's score, highest first, on both screens.
  await host.keyboard.press('F4');
  await expect(host.getByTestId('score-line').filter({ visible: true })).toHaveCount(2);
  await expect(host.getByTestId('score-line').filter({ hasText: /^Alice: \d+\/\d+$/ })).toBeVisible();
  await expect(host.getByTestId('score-line').filter({ hasText: /^Bob: \d+\/\d+$/ })).toBeVisible();

  await menuConfirm(guest, 'menu-resign');
  await expectHostWon(host, guest);
  // A resigned player's score line is struck through.
  await expect(host.getByTestId('score-line').filter({ hasText: /^Bob:/ })).toHaveClass(/strikeout/);
  // Once the game is over the menu has no Resign.
  await guest.getByTestId('menu-menu').click();
  await expect(guest.getByTestId('menu-resign')).toHaveCount(0);
  await guest.getByTestId('menu-cancel').click();

  // Menu, Achievements: the summary's group columns are the sim's score on both screens.
  for (const page of [host, guest]) {
    await page.getByTestId('menu-menu').click();
    await page.getByTestId('menu-achievements').click();
    await expect(page.getByTestId('achievements')).toBeVisible();
    for (const p of [1, 2]) {
      const score = await page.evaluate((q) => window.__game!.score(q), p);
      const cells = [score.military, score.economy, score.religion, score.technology].map(String);
      for (const [column, value] of cells.entries()) await expect(page.getByTestId(`achievements-${p}-${column}`)).toHaveText(value);
    }
  }

  // The loser's Quit Game ends its game; the winner stays on its game screen.
  await guest.getByTestId('achievements-close').click();
  await menuConfirm(guest, 'menu-quit');
  await expect(guest.getByTestId('achievements')).toBeVisible();
  // At the end of the game the achievements' Close leaves the game screen.
  await guest.getByTestId('achievements-close').click();
  await guest.waitForFunction(() => window.__game === undefined);
  await host.getByTestId('achievements-close').click();
  await expect(host.getByTestId('achievements')).toHaveCount(0);
  await expect(host.getByTestId('opponent-left')).toHaveCount(0);
  expect(await host.evaluate(() => window.__game !== undefined)).toBe(true);
});

test('Quit Game in the middle of a game resigns the player: the other one wins', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  await menuConfirm(guest, 'menu-quit');
  await expect(guest.getByTestId('achievements')).toBeVisible();
  await host.waitForFunction(() => window.__game!.gameResult() !== null);
  await expect(host.getByTestId('chat-line').filter({ hasText: 'Bob resigned.' })).toBeVisible();
  expect((await result(host))!.winners).toEqual([1]);
  await expect(host.getByTestId('game-over-text')).toHaveText('You are victorious!');
  await expect(host.getByTestId('opponent-left')).toHaveCount(0);
});
