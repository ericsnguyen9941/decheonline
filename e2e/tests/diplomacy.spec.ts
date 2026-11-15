import { expect, test, type Browser, type Page } from '@playwright/test';

// The Diplomacy dialog and its notifications (docs/spec/diplomacy.md §7): a built Market for each player (`market=1`),
// so tribute is enabled, and 1000 of each resource.
const URL = '/?debug=net&map=test&speed=20&resources=1000&market=1';
/** `TRIBE_Game::sounds` index 4, tribute.wav. */
const SOUND_TRIBUTE = 4;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

const chatLines = (page: Page) => page.getByTestId('chat-line');
const tributeSounds = (page: Page) => page.evaluate((n) => window.__game!.sounds().filter((s) => s.event === 'message' && s.game === n).length, SOUND_TRIBUTE);

test('a player sets Ally and pays tribute from the Diplomacy dialog; the other is told, as the original', async ({ browser }) => {
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

  // The Diplomacy button opens the dialog: a row per player, Bob's stance radio on Enemy (every other player starts an
  // enemy), the fee and Alice's stock with a Market; no tribute buttons on her own row.
  await host.getByTestId('menu-diplomacy').click();
  const dialog = host.getByTestId('diplomacy');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('diplomacy-title')).toHaveText('Diplomacy');
  await expect(dialog.getByTestId('diplomacy-player-name')).toHaveText(['Alice', 'Bob']);
  await expect(dialog.getByTestId('diplomacy-enemy-2')).toHaveAttribute('data-state', '1');
  await expect(dialog.getByTestId('diplomacy-ally-2')).toHaveAttribute('data-state', '0');
  await expect(dialog.getByTestId('diplomacy-ally-1')).toHaveCount(0);
  await expect(dialog.getByTestId('diplomacy-fee')).toHaveText('Pay Tribute (cost 25%)');
  await expect(dialog.getByTestId('diplomacy-need-market')).toBeHidden();
  await expect(dialog.getByTestId('diplomacy-stock-food')).toHaveText('1000');
  await expect(dialog.getByTestId('diplomacy-tribute-food-1')).toHaveCount(0);

  // Each click adds 100 and takes 125 (fee 25%) from the stock shown; Clear Tributes puts it back.
  const food = dialog.getByTestId('diplomacy-tribute-food-2');
  await food.click();
  await food.click();
  await expect(food).toHaveText('200');
  await expect(dialog.getByTestId('diplomacy-stock-food')).toHaveText('750');
  await dialog.getByTestId('diplomacy-clear').click();
  await expect(food).toHaveText('');
  await expect(dialog.getByTestId('diplomacy-stock-food')).toHaveText('1000');
  // Cancel sends nothing.
  await food.click();
  await dialog.getByTestId('diplomacy-ally-2').click();
  await dialog.getByTestId('diplomacy-cancel').click();
  await expect(dialog).toHaveCount(0);

  // Again: Ally, 200 food, Allied Victory, OK.
  const turn = await host.evaluate(() => window.__game!.turn());
  await host.getByTestId('menu-diplomacy').click();
  await expect(dialog.getByTestId('diplomacy-enemy-2')).toHaveAttribute('data-state', '1');
  await dialog.getByTestId('diplomacy-ally-2').click();
  await expect(dialog.getByTestId('diplomacy-enemy-2')).toHaveAttribute('data-state', '0');
  await food.click();
  await food.click();
  await dialog.getByTestId('diplomacy-allied-victory').click();
  await dialog.getByTestId('diplomacy-ok').click();
  await expect(dialog).toHaveCount(0);

  // Bob is told of both on his chat lines, the tribute with tribute.wav; his stance stays his own (one-sided).
  await expect(chatLines(guest).filter({ hasText: 'Alice changed diplomatic stance with you to Ally.' })).toBeVisible();
  await expect(chatLines(guest).filter({ hasText: 'Alice paid 200 food in tribute to you.' })).toBeVisible();
  await expect.poll(() => tributeSounds(guest)).toBe(1);
  for (const page of [host, guest]) {
    expect(await page.evaluate(() => [window.__game!.relation(1, 2), window.__game!.relation(2, 1), window.__game!.alliedVictory(1)])).toEqual([0, 3, true]);
    expect(await page.evaluate(() => [window.__game!.resources(1).food, window.__game!.resources(2).food])).toEqual([750, 1200]);
  }
  // The sender hears of neither (`val2 == curr_player`, src/tribegam.cpp:1858, :1884).
  await expect(chatLines(host).filter({ hasText: /changed diplomatic stance|in tribute to you/ })).toHaveCount(0);
  expect(await tributeSounds(host)).toBe(0);

  // Bob's dialog shows his own stance towards Alice, still Enemy; Esc closes it.
  await guest.getByTestId('menu-diplomacy').click();
  await expect(guest.getByTestId('diplomacy-enemy-1')).toHaveAttribute('data-state', '1');
  await expect(guest.getByTestId('diplomacy-stock-food')).toHaveText('1200');
  await guest.keyboard.press('Escape');
  await expect(guest.getByTestId('diplomacy')).toHaveCount(0);

  // The games stayed in step.
  await host.waitForFunction((t) => window.__game!.turn() > t + 10, turn);
  expect(await host.evaluate(() => window.__game!.desync())).toBeNull();
  expect(await guest.evaluate(() => window.__game!.desync())).toBeNull();
});
