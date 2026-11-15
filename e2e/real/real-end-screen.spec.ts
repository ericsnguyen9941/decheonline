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

async function menuConfirm(page: Page, item: 'menu-resign' | 'menu-quit'): Promise<void> {
  await page.getByTestId('menu-menu').click();
  await page.getByTestId(item).click();
  await page.getByTestId('popup-yes').click();
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(shots, name) });
  console.log(`screenshot: ${join(shots, name)}`);
}

test('the end of the game in the original art: the menu, the victory text, and the won and lost achievements screens', async ({ browser }) => {
  const host = await open(browser);
  const guest = await open(browser);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__game !== undefined && window.__game.shownObjects() > 0 && window.__game.packSprites() === window.__game.shownObjects());
    // The debug strip of `?debug=net` covers the corner of the object panel.
    await page.getByTestId('net-debug').evaluate((el) => el.remove());
  }
  mkdirSync(shots, { recursive: true });

  // The menu in the game screen dialogs' look (info file 50006), with Resign while playing.
  await guest.getByTestId('menu-menu').click();
  await expect(guest.getByTestId('menu-resign')).toHaveText('Resign');
  await shoot(guest, 'end-menu.png');
  await guest.getByTestId('menu-resign').click();
  await expect(guest.getByTestId('popup-yes')).toBeVisible();
  await guest.getByTestId('popup-yes').click();

  await expect(host.getByTestId('game-over-text')).toHaveText('You are victorious!');
  await expect(guest.getByTestId('game-over-text')).toHaveText('You have been defeated!');
  await expect(host.getByTestId('chat-line').filter({ hasText: 'Bob resigned.' })).toBeVisible();
  await host.keyboard.press('F4');
  await expect(host.getByTestId('score-line').filter({ visible: true })).toHaveCount(2);
  await shoot(host, 'end-victory.png');

  // Quit Game at the end of the game: the end achievements, won (50057) for the winner, lost (50058) for the other.
  await menuConfirm(guest, 'menu-quit');
  await menuConfirm(host, 'menu-quit');
  for (const page of [host, guest]) await expect(page.getByTestId('achievements')).toBeVisible();
  await expect(host.getByTestId('achievements-winner-1')).toBeVisible();
  await expect(host.getByTestId('achievements-winner-2')).toHaveCount(0);
  await expect(host.getByTestId('achievements-name-1')).toHaveText('Alice');
  await shoot(host, 'end-achievements-won.png');
  await shoot(guest, 'end-achievements-lost.png');
});
