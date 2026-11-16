import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art. F11's clock and
// population, F5's timings, REVEAL MAP and NO FOG, the tribute notice and a taunt with the real pack (docs/spec/hud.md
// "F11 clock and population, F5 timings, formations", chat.md §7.5, §8).
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');
const URL = '/?debug=net&map=test&speed=4&market=1&resources=1000';

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(shots, name) });
  console.log(`screenshot: ${join(shots, name)}`);
}

async function say(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Enter');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('quick-chat')).toHaveCount(0);
}

test('F11 and F5 overlays, REVEAL MAP and NO FOG, the tribute notice and a taunt in the original art and strings', async ({ browser }) => {
  mkdirSync(shots, { recursive: true });
  const host = await open(browser);
  const guest = await open(browser);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await expect(host.getByTestId('player-1')).toContainText('Bob');
  await host.getByTestId('cheating').check();
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__game !== undefined && window.__game.shownObjects() > 0 && window.__game.packSprites() === window.__game.shownObjects());
    await page.getByTestId('net-debug').evaluate((el) => el.remove());
  }

  // F11: "00:00:12 (1.0)" at the top left of the view, "pop: 3/..." from language string 11050; F5's timings over the
  // resource counts.
  await host.keyboard.press('F11');
  await expect(host.getByTestId('game-clock')).toHaveText(/^\d\d:\d\d:\d\d \(1\.0\)$/);
  await expect(host.getByTestId('population')).toHaveText(/^pop: \d+\/\d+$/);
  await host.keyboard.press('F5');
  await expect(host.getByTestId('timings')).toHaveText(/^t\d+,f\d+,avg\(/);
  await shoot(host, 'hud-f11-f5.png');
  await host.keyboard.press('F5');
  await host.keyboard.press('F5');

  // REVEAL MAP: the whole map explored (fogged) on both screens, no chat line; NO FOG: all of it plain.
  await say(guest, 'REVEAL MAP');
  for (const page of [host, guest]) await expect.poll(() => page.evaluate(() => window.__game!.drawnTile(2, 45))).toBe(0x80);
  await host.evaluate(() => window.__map!.centerOnTile(24, 24));
  await shoot(host, 'cheat-reveal-map.png');
  await say(host, 'NO FOG');
  for (const page of [host, guest]) await expect.poll(() => page.evaluate(() => window.__game!.drawnTile(2, 45))).toBe(0x0f);
  await shoot(host, 'cheat-no-fog.png');
  expect(await host.getByTestId('chat-line').filter({ hasText: /REVEAL|FOG/ }).count()).toBe(0);

  // The tribute notice with the amount received; "12" plays Taunt012.wav on both screens.
  await host.evaluate(() => window.__game!.issue({ type: 'tribute', player: 2, resource: 0, amount: 2000 }));
  await expect(guest.getByTestId('chat-line').filter({ hasText: 'Alice paid 750 food in tribute to you.' })).toBeVisible();
  await say(host, '12');
  for (const page of [host, guest]) {
    await expect(page.getByTestId('chat-line').filter({ hasText: 'Alice: 12' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__game!.sounds().filter((s) => s.event === 'taunt'))).toEqual([{ event: 'taunt', sound: -1, game: -1, wav: 12, source: 12 }]);
  }
  await shoot(guest, 'hud-tribute-taunt.png');
});
