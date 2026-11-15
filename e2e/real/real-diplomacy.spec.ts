import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

async function open(browser: Browser, url: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(url);
  return page;
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(shots, name) });
  console.log(`screenshot: ${join(shots, name)}`);
}

/** Alice hosts, Bob joins by the invite code, both start on the fixed test map with `url`'s debug options. */
async function play(browser: Browser, url: string): Promise<[Page, Page]> {
  const host = await open(browser, url);
  const guest = await open(browser, url);
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
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__game !== undefined && window.__game.shownObjects() > 0 && window.__game.packSprites() === window.__game.shownObjects());
    await page.getByTestId('net-debug').evaluate((el) => el.remove());
  }
  return [host, guest];
}

test('the Diplomacy dialog in the original art and strings: without a Market, with tribute, and the notifications', async ({ browser }) => {
  mkdirSync(shots, { recursive: true });

  // No Market: "You need a Market to pay tribute." where the fee, the stock and the tribute buttons would be.
  const [alone] = await play(browser, '/?debug=net&map=test&speed=4');
  await alone.getByTestId('menu-diplomacy').click();
  const dialog = alone.getByTestId('diplomacy');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => [(el as HTMLElement).offsetWidth, (el as HTMLElement).offsetHeight])).toEqual([625, 405]);
  await expect(dialog.getByTestId('diplomacy-title')).toHaveText('Diplomacy');
  for (const t of ['Name', 'Civilization', 'Ally', 'Neutral', 'Enemy', 'Allied Victory', 'OK', 'Clear Tributes', 'Cancel']) await expect(dialog.getByText(t, { exact: true })).toBeVisible();
  await expect(dialog.getByTestId('diplomacy-player-name')).toHaveText(['Alice', 'Bob']);
  await expect(dialog.getByTestId('diplomacy-player-civ')).toHaveText(['Egyptian', 'Egyptian']);
  await expect(dialog.getByTestId('diplomacy-need-market')).toHaveText('You need a Market to pay tribute.');
  await expect(dialog.getByTestId('diplomacy-need-market')).toBeVisible();
  await expect(dialog.getByTestId('diplomacy-fee')).toBeHidden();
  await expect(dialog.getByTestId('diplomacy-stock-food')).toBeHidden();
  for (const r of ['wood', 'food', 'gold', 'stone']) await expect(dialog.getByTestId(`diplomacy-tribute-${r}-2`)).toBeHidden();
  await expect(dialog.getByTestId('diplomacy-enemy-2')).toHaveAttribute('data-state', '1');
  await shoot(alone, 'diplomacy-no-market.png');
  await dialog.getByTestId('diplomacy-cancel').click();

  // A Market each and 1000 of everything; Alice picks Ally and tributes, with 0 gold left the gold button is disabled.
  const [host, guest] = await play(browser, '/?debug=net&map=test&speed=4&market=1&resources=1000');
  await host.getByTestId('menu-diplomacy').click();
  const tribute = host.getByTestId('diplomacy');
  await expect(tribute.getByTestId('diplomacy-fee')).toHaveText('Pay Tribute (cost 25%)');
  await expect(tribute.getByTestId('diplomacy-need-market')).toBeHidden();
  await tribute.getByTestId('diplomacy-ally-2').click();
  for (let i = 0; i < 2; i++) await tribute.getByTestId('diplomacy-tribute-food-2').click();
  await tribute.getByTestId('diplomacy-tribute-wood-2').click();
  // 8 clicks of 125 take all 1000 gold: 800 to send, and the button turns disabled.
  for (let i = 0; i < 8; i++) await tribute.getByTestId('diplomacy-tribute-gold-2').click();
  await expect(tribute.getByTestId('diplomacy-tribute-gold-2')).toHaveText('800');
  await expect(tribute.getByTestId('diplomacy-stock-gold')).toHaveText('0');
  await expect(tribute.getByTestId('diplomacy-tribute-gold-2')).toHaveAttribute('data-disabled', '1');
  await expect(tribute.getByTestId('diplomacy-tribute-food-2')).toHaveText('200');
  await expect(tribute.getByTestId('diplomacy-stock-food')).toHaveText('750');
  await shoot(host, 'diplomacy-tribute.png');
  await tribute.getByTestId('diplomacy-ok').click();

  for (const t of ['Alice changed diplomatic stance with you to Ally.', 'Alice paid 800 gold in tribute to you.', 'Alice paid 100 wood in tribute to you.', 'Alice paid 200 food in tribute to you.']) {
    await expect(guest.getByTestId('chat-line').filter({ hasText: t })).toBeVisible();
  }
  expect(await guest.evaluate(() => window.__game!.sounds().some((s) => s.event === 'message' && s.game === 4 && s.wav === 50304))).toBe(true);
  await shoot(guest, 'diplomacy-notices.png');
});
