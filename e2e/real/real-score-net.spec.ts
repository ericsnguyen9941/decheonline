import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art. The F4 score display's
// slow-player and latency icons from btn6 and the score button's rollover text from the language strings
// (docs/spec/hud.md "Menu, game over, score display, achievements").
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');
const URL = '/?debug=net&map=test&speed=4';

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

test("the score display's slow and latency icons and the score button's rollover in the original art and strings", async ({ browser }) => {
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
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__game !== undefined && window.__game.shownObjects() > 0 && window.__game.packSprites() === window.__game.shownObjects());
    await page.getByTestId('net-debug').evaluate((el) => el.remove());
  }

  // The guest reports 150 ms frames and holds its pongs 500 ms: on the host Bob's line shows the slow icon (frame 17)
  // left of the latency icon (frame 19, 300-1000 ms), Alice's none.
  await guest.evaluate(() => {
    window.__game!.forceFrameMs(150);
    window.__game!.delayPongs(500);
  });
  await host.keyboard.press('F4');
  const bob = host.getByTestId('score-line').filter({ hasText: 'Bob:' });
  await expect(bob.getByTestId('score-slow')).toBeVisible({ timeout: 40_000 });
  await expect(bob.getByTestId('score-latency')).toBeVisible({ timeout: 40_000 });
  await expect(bob.getByTestId('score-latency')).toHaveAttribute('data-frame', '19');
  // The art is the host's culture's btn6 (Egyptian, interfac.drs 50605), painted from the pack.
  for (const kind of ['slow', 'latency']) await expect(bob.getByTestId(`score-${kind}`)).toHaveCSS('background-image', /interface\/50605\.png/);
  await host.getByTestId('score-button').hover();
  await expect(host.getByTestId('hud-message')).toHaveText('Score (F4)');
  await shoot(host, 'score-net-icons.png');
  await bob.screenshot({ path: join(shots, 'score-net-line.png') });
  console.log(`screenshot: ${join(shots, 'score-net-line.png')}`);
  await host.mouse.move(400, 300);
  await expect(host.getByTestId('hud-message')).toBeHidden();
});
