import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

const RELIC = 159;
const RUIN = 158;

async function open(browser: Browser, url: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(url);
  return page;
}

async function shoot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  await page.screenshot({ path: join(shots, name), clip });
  console.log(`screenshot: ${join(shots, name)}`);
}

test('a relic and a ruin in the original art; holding all: the notifications and the countdown clocks', async ({ browser }) => {
  mkdirSync(shots, { recursive: true });
  // One Gaia relic above Alice's Villagers and one ruin left of them (`relics=1&ruins=1`), the game's only ones.
  const url = '/?debug=net&map=test&speed=2&relics=1&ruins=1';
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

  // Alice's Villagers take both: the relic shows a player's art (graphic 11, `Artifact1`; Gaia's is 12), the ruin its own (7).
  const objects = () => host.evaluate(([a, b]) => window.__game!.objects().filter((o) => o.type === a || o.type === b), [RELIC, RUIN] as const);
  await expect.poll(async () => (await objects()).map((o) => [o.type, o.owner, o.graphic])).toEqual([
    [RELIC, 1, 11],
    [RUIN, 1, 7],
  ]);
  await host.waitForFunction(() => window.__game!.packSprites() === window.__game!.shownObjects());
  const canvas = (await host.locator('canvas').first().boundingBox())!;
  for (const o of await objects()) {
    const p = (await host.evaluate((id) => window.__game!.objectScreenPos(id), o.id))!;
    expect(p.x).toBeGreaterThan(canvas.x);
    expect(p.y).toBeGreaterThan(canvas.y);
    expect(p.x).toBeLessThan(canvas.x + canvas.width);
    expect(p.y).toBeLessThan(canvas.y + canvas.height);
  }

  // The original's notifications, each with artheld.wav, and a clock per countdown in Alice's colour.
  for (const t of ['All Artifacts have been captured. Hold them for 2000 years to win!', 'All Ruins have been captured. Hold them for 2000 years to win!']) {
    await expect(host.getByTestId('chat-line').filter({ hasText: t })).toBeVisible();
  }
  for (const t of ['All Artifacts have been captured. You will lose if they are held for 2000 years!', 'All Ruins have been captured. You will lose if they are held for 2000 years!']) {
    await expect(guest.getByTestId('chat-line').filter({ hasText: t })).toBeVisible();
  }
  for (const page of [host, guest]) {
    const clocks = page.getByTestId('countdown-clock').filter({ visible: true });
    await expect(clocks).toHaveText([/^Artifacts: \d+ Years$/, /^Ruins: \d+ Years$/]);
    expect(await page.evaluate(() => window.__game!.sounds().filter((s) => s.event === 'message' && s.game === 11 && s.wav === 50311).length)).toBe(2);
  }
  await shoot(host, 'relics-held-host.png');
  await shoot(guest, 'relics-held-guest.png');
  const [relic, ruin] = await objects();
  const a = (await host.evaluate((id) => window.__game!.objectScreenPos(id), relic!.id))!;
  const b = (await host.evaluate((id) => window.__game!.objectScreenPos(id), ruin!.id))!;
  const x = Math.min(a.x, b.x) - 120;
  const y = Math.min(a.y, b.y) - 120;
  await shoot(host, 'relics-closeup.png', { x, y, width: Math.max(a.x, b.x) - x + 120, height: Math.max(a.y, b.y) - y + 80 });
});
