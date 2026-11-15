import { expect, test, type Browser, type Page } from '@playwright/test';

// All relics held (docs/spec/victory.md §10, docs/spec/hud.md "Relic and ruin countdown"): one Gaia relic above Alice's
// first Villager (`relics=1`, the game's only relic), which she takes at once; both screens are told and show her
// countdown, top right; then Bob takes it and the lost and captured notifications swap.
const URL = '/?debug=net&map=test&speed=20&relics=1';
const RELIC = 159;
const VILLAGER = 83;
/** `TRIBE_Game::sounds`: artheld.wav, artlost.wav. */
const SOUND_HELD = 11;
const SOUND_LOST = 12;
const HOLD = 'All Artifacts have been captured. Hold them for 2000 years to win!';
const LOSE = 'All Artifacts have been captured. You will lose if they are held for 2000 years!';
const LOST = 'Control of the Artifacts was lost!';

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

const chatLines = (page: Page) => page.getByTestId('chat-line');
const clocks = (page: Page) => page.getByTestId('countdown-clock');
const relicOwner = (page: Page) => page.evaluate((t) => window.__game!.objects().find((o) => o.type === t)?.owner, RELIC);
const gameSounds = (page: Page, n: number) => page.evaluate((n) => window.__game!.sounds().filter((s) => s.event === 'message' && s.game === n).length, n);
const years = async (page: Page) => Number(/Artifacts: (\d+) Years/.exec((await clocks(page).first().textContent()) ?? '')?.[1] ?? NaN);

test('holding all relics: both players are told and both show the countdown, as the original', async ({ browser }) => {
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

  // Alice's Villager next to it takes it (its unit AI); she holds all relics, so the countdown starts at 2000.
  for (const page of [host, guest]) await expect.poll(() => relicOwner(page)).toBe(1);
  await expect(chatLines(host).filter({ hasText: HOLD })).toBeVisible();
  await expect(chatLines(guest).filter({ hasText: LOSE })).toBeVisible();
  for (const page of [host, guest]) {
    await expect.poll(() => gameSounds(page, SOUND_HELD)).toBe(1);
    // One clock, top right of the view, in Alice's colour (blue), counting down in steps of 5 years.
    await expect(clocks(page).filter({ visible: true })).toHaveCount(1);
    await expect(clocks(page).first()).toHaveText(/^Artifacts: \d+ Years$/);
    await expect(clocks(page).first()).toHaveCSS('color', 'rgb(0, 0, 255)');
    const first = await years(page);
    expect(first).toBeLessThanOrEqual(2000);
    expect(first % 5).toBe(0);
    await expect.poll(() => years(page)).toBeLessThan(first);
  }
  const view = (await host.getByTestId('hud-view').boundingBox())!;
  const clock = (await clocks(host).first().boundingBox())!;
  expect([Math.round(view.x + view.width - clock.x - clock.width), Math.round(clock.y - view.y), clock.width, clock.height]).toEqual([4, 4, 170, 20]);

  // Alice's Villagers walk away and Bob's comes: Bob takes it. Alice's countdown stops ("lost", for both) and Bob's starts.
  const villagers = (page: Page, owner: number) =>
    page.evaluate(([o, t]) => window.__game!.units().filter((u) => u.owner === o && u.type === t).map((u) => u.id), [owner, VILLAGER] as const);
  const relic = await host.evaluate((t) => window.__game!.objects().find((o) => o.type === t)!, RELIC);
  await host.evaluate((ids) => window.__game!.issueMove(ids, 3.5, 3.5), await villagers(host, 1));
  await guest.evaluate(([ids, x, y]) => window.__game!.issueMove(ids.slice(0, 1), x, y), [await villagers(guest, 2), relic.x, relic.y + 1] as const);
  for (const page of [host, guest]) await expect.poll(() => relicOwner(page), { timeout: 120_000 }).toBe(2);
  for (const page of [host, guest]) await expect(chatLines(page).filter({ hasText: LOST })).toBeVisible();
  await expect(chatLines(host).filter({ hasText: LOSE })).toBeVisible();
  await expect(chatLines(guest).filter({ hasText: HOLD })).toBeVisible();
  for (const page of [host, guest]) {
    await expect.poll(() => gameSounds(page, SOUND_LOST)).toBe(1);
    await expect.poll(() => gameSounds(page, SOUND_HELD)).toBe(2);
    await expect(clocks(page).filter({ visible: true })).toHaveCount(1);
    // Bob's colour (red).
    await expect(clocks(page).first()).toHaveCSS('color', 'rgb(198, 57, 33)');
  }
});
