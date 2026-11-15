import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

const WONDER = 276;
/** The Egyptian Wonder's standing graphic (empires.dat unit 276, civ 1). */
const WONDER_GRAPHIC = 265;

async function open(browser: Browser, url: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(url);
  return page;
}

async function shoot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  await page.screenshot({ path: join(shots, name), clip });
  console.log(`screenshot: ${join(shots, name)}`);
}

test('the Wonder in the original art, its notifications and its countdown clock on both screens', async ({ browser }) => {
  mkdirSync(shots, { recursive: true });
  // Alice starts with a built Wonder left of her Town Center (`wonder=1`).
  const url = '/?debug=net&map=test&speed=2&wonder=1';
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

  const wonder = await host.evaluate((t) => window.__game!.objects().find((o) => o.type === t)!, WONDER);
  expect([wonder.owner, wonder.graphic]).toEqual([1, WONDER_GRAPHIC]);
  const canvas = (await host.locator('canvas').first().boundingBox())!;
  const p = (await host.evaluate((id) => window.__game!.objectScreenPos(id), wonder.id))!;
  expect(p.x).toBeGreaterThan(canvas.x);
  expect(p.y).toBeGreaterThan(canvas.y);
  expect(p.x).toBeLessThan(canvas.x + canvas.width);
  expect(p.y).toBeLessThan(canvas.y + canvas.height);

  // The original's texts and sounds (mstart.wav 50308, mdone.wav 50309), and Alice's clock top right on both screens.
  await expect(host.getByTestId('chat-line').filter({ hasText: 'You completed a Wonder. You will win if it stands for 2000 years!' })).toBeVisible();
  await expect(guest.getByTestId('chat-line').filter({ hasText: 'Alice completed a Wonder. You will lose if it stands for 2000 years!' })).toBeVisible();
  for (const page of [host, guest]) {
    await expect(page.getByTestId('countdown-clock').filter({ visible: true })).toHaveText([/^Wonder: \d+ Years$/]);
    for (const [game, wav] of [[8, 50308], [9, 50309]]) {
      expect(await page.evaluate(([g, w]) => window.__game!.sounds().filter((s) => s.event === 'message' && s.game === g && s.wav === w).length, [game, wav])).toBe(1);
    }
  }
  await host.waitForFunction(() => window.__game!.packSprites() === window.__game!.shownObjects());
  await shoot(host, 'wonder-host.png');
  await shoot(guest, 'wonder-guest.png');
  await shoot(host, 'wonder-closeup.png', { x: p.x - 200, y: p.y - 260, width: 400, height: 340 });
});
