import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('/?debug=net&map=test&speed=4');
  return page;
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(shots, name) });
  console.log(`screenshot: ${join(shots, name)}`);
}

test('the chat in the original art: the lobby chat, the chat bar, the Send Messages dialog and the chat lines', async ({ browser }) => {
  const host = await open(browser);
  const guest = await open(browser);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await expect(host.getByTestId('player-1')).toContainText('Bob');
  mkdirSync(shots, { recursive: true });

  await guest.getByTestId('lobby-chat-input').fill('ready when you are');
  await guest.getByTestId('lobby-chat-input').press('Enter');
  await expect(host.getByTestId('lobby-chat-line')).toHaveText(['Bob: ready when you are']);
  await shoot(host, 'chat-lobby.png');

  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__game !== undefined && window.__game.shownObjects() > 0 && window.__game.packSprites() === window.__game.shownObjects());
    await page.getByTestId('net-debug').evaluate((el) => el.remove());
  }

  // Enter's chat bar with a line typed.
  await host.keyboard.press('Enter');
  await host.keyboard.type('Wololo');
  await shoot(host, 'chat-quick.png');
  await host.keyboard.press('Enter');
  await guest.keyboard.press('Enter');
  await guest.keyboard.type('Good luck, have fun');
  await guest.keyboard.press('Enter');
  for (const page of [host, guest]) await expect(page.getByTestId('chat-line').filter({ hasText: 'Bob: Good luck, have fun' })).toBeVisible();
  await shoot(host, 'chat-lines.png');

  // The Chat button's Send Messages dialog.
  await guest.getByTestId('menu-chat').click();
  await expect(guest.getByTestId('send-message')).toContainText('Send Messages to');
  await shoot(guest, 'chat-dialog.png');
});
