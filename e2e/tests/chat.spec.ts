import { expect, test, type Browser, type Page } from '@playwright/test';

// The chat (docs/spec/chat.md): the setup screen's chat box, Enter's chat bar and the Chat button's Send Messages dialog.
const URL = '/?debug=net&map=test&speed=20';
/** `TRIBE_Game::sounds` index 2, chatrcvd. */
const SOUND_CHAT = 2;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

const chatLines = (page: Page) => page.getByTestId('chat-line');
const chatSounds = (page: Page) => page.evaluate((n) => window.__game!.sounds().filter((s) => s.event === 'message' && s.game === n).length, SOUND_CHAT);

test('two players chat in the lobby and in the game, as the original', async ({ browser }) => {
  const host = await open(browser);
  const guest = await open(browser);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await expect(host.getByTestId('player-1')).toContainText('Bob');

  // The setup screen: Enter sends to everyone; the sender's own line shows too. A lobby redraw keeps the typing.
  await guest.getByTestId('lobby-chat-input').fill('hello from Bob');
  await guest.getByTestId('lobby-chat-input').press('Enter');
  for (const page of [host, guest]) await expect(page.getByTestId('lobby-chat-line')).toHaveText(['Bob: hello from Bob']);
  await expect(guest.getByTestId('lobby-chat-input')).toHaveValue('');
  await host.getByTestId('lobby-chat-input').pressSequentially('hi');
  await guest.getByTestId('ready').click();
  await expect(host.getByTestId('player-1')).toContainText('ready');
  await host.keyboard.type(' Bob');
  await host.keyboard.press('Enter');
  for (const page of [host, guest]) await expect(page.getByTestId('lobby-chat-line')).toHaveText(['Bob: hello from Bob', 'Alice: hi Bob']);

  await host.getByTestId('ready').click();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game?.selection() != null && window.__game.turn() > 5);
  const turnAtStart = await host.evaluate(() => window.__game!.turn());

  // Enter opens the chat bar; Enter sends and closes it. "Name: text" on both screens' chat lines with sound 2.
  await host.keyboard.press('Enter');
  await expect(host.getByTestId('quick-chat')).toBeVisible();
  // While it is open the game's keys wait: typed letters go into the line, not to the hotkeys.
  await host.keyboard.type('attack at dawn');
  await host.keyboard.press('Enter');
  await expect(host.getByTestId('quick-chat')).toHaveCount(0);
  for (const page of [host, guest]) await expect(chatLines(page).filter({ hasText: 'Alice: attack at dawn' })).toBeVisible();
  // (A late turn's "Problem communicating" also plays sound 2 on a loaded machine: at least one.)
  await expect.poll(() => chatSounds(guest)).toBeGreaterThanOrEqual(1);
  await expect.poll(() => chatSounds(host)).toBeGreaterThanOrEqual(1);

  // Esc closes the bar without sending; an empty Enter just closes it.
  await guest.keyboard.press('Enter');
  await guest.keyboard.type('never sent');
  await guest.keyboard.press('Escape');
  await expect(guest.getByTestId('quick-chat')).toHaveCount(0);
  await guest.keyboard.press('Enter');
  await guest.keyboard.press('Enter');
  await expect(guest.getByTestId('quick-chat')).toHaveCount(0);

  // The Chat button: the Send Messages dialog. Enter sends and keeps it open; the other player's box starts checked.
  await guest.getByTestId('menu-chat').click();
  const dialog = guest.getByTestId('send-message');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('chat-player-name')).toHaveText(['Alice', 'Bob']);
  await expect(dialog.getByTestId('chat-to-1')).toHaveAttribute('data-state', '1');
  await expect(dialog.getByTestId('chat-to-2')).toHaveCount(0);
  await expect(dialog.getByTestId('chat-select-player')).toHaveAttribute('data-state', '1');
  await dialog.getByTestId('chat-input').fill('gl hf');
  await dialog.getByTestId('chat-input').press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('chat-input')).toHaveValue('');
  for (const page of [host, guest]) await expect(chatLines(page).filter({ hasText: 'Bob: gl hf' })).toBeVisible();

  // Allies (no teams: nobody else) unchecks Alice; the message then reaches Bob's own screen only.
  await dialog.getByTestId('chat-allies').click();
  await expect(dialog.getByTestId('chat-to-1')).toHaveAttribute('data-state', '0');
  await dialog.getByTestId('chat-input').fill('note to self');
  await dialog.getByTestId('chat-input').press('Enter');
  await expect(chatLines(guest).filter({ hasText: 'Bob: note to self' })).toBeVisible();
  // Return to Game keeps the group: the chat bar now sends to Bob alone too.
  await dialog.getByTestId('chat-return').click();
  await expect(dialog).toHaveCount(0);
  await guest.keyboard.press('Enter');
  await guest.keyboard.type('still private');
  await guest.keyboard.press('Enter');
  await expect(chatLines(guest).filter({ hasText: 'Bob: still private' })).toBeVisible();
  // Everyone puts Alice back; Esc is Return to Game.
  await guest.getByTestId('menu-chat').click();
  await dialog.getByTestId('chat-everyone').click();
  await expect(dialog.getByTestId('chat-to-1')).toHaveAttribute('data-state', '1');
  await guest.keyboard.press('Escape');
  await guest.keyboard.press('Enter');
  await guest.keyboard.type('public again');
  await guest.keyboard.press('Enter');
  await expect(chatLines(host).filter({ hasText: 'Bob: public again' })).toBeVisible();
  await expect(chatLines(host).filter({ hasText: /note to self|still private|never sent/ })).toHaveCount(0);

  // Chat is outside the turns: the games stayed in step and nothing was issued.
  await host.waitForFunction((t) => window.__game!.turn() > t + 10, turnAtStart);
  expect(await host.evaluate(() => window.__game!.desync())).toBeNull();
  expect(await guest.evaluate(() => window.__game!.desync())).toBeNull();
});
