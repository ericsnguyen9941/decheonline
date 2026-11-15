import { expect, test, type Browser, type Page } from '@playwright/test';

const URL = '/?debug=net&map=test&speed=20';
/** How long the guest's socket stays broken: past the 25 s after which the original says who it waits for. */
const AWAY_MS = 27_000;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

/** Host creates, guest joins by code, both ready, host starts; resolves once both have drawn the game screen. */
async function startGame(browser: Browser): Promise<[Page, Page]> {
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
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game?.selection() != null && window.__game.turn() > 5);
  return [host, guest];
}

const turn = (page: Page) => page.evaluate(() => window.__game!.turn());

test('a player whose socket breaks rejoins its slot, catches up the turns it missed, and both games stay in step', async ({ browser }) => {
  const [host, guest] = await startGame(browser);

  // A command goes out from each side around the break: the guest's just before it, the host's while it waits.
  await guest.evaluate(() => window.__game!.issueTest(11, 22));
  await guest.waitForFunction(() => window.__game!.applied()[1]?.length === 1);
  const droppedAt = await turn(guest);
  await guest.evaluate((ms) => window.__game!.dropLink(ms), AWAY_MS);
  await host.evaluate(() => window.__game!.issueTest(33, 44));

  // Meanwhile the host's game waits for the guest's turns and, after 25 s, says who it waits for.
  await expect(host.getByTestId('chat-line').filter({ hasText: 'Problem communicating with Bob...' })).toBeVisible();
  const stalledAt = await turn(host);
  expect(stalledAt).toBeLessThan(droppedAt + 64);
  expect(await turn(host)).toBe(stalledAt);

  // The guest comes back by itself, gets the turns it missed and both games go on, hash for hash.
  for (const page of [host, guest]) await page.waitForFunction((t) => window.__game!.turn() > t + 40, stalledAt);
  const target = stalledAt + 40;
  const hashes = await Promise.all(
    [host, guest].map((page) =>
      page.evaluate(([from, to]) => Array.from({ length: to! - from! }, (_, i) => window.__game!.hash(from! + i)), [droppedAt - 5, target]),
    ),
  );
  expect(hashes[0]!.every((h) => h !== undefined)).toBe(true);
  expect(hashes[1]).toEqual(hashes[0]);

  // Every command arrived on both sides, the one sent while the link was down included.
  const applied = await Promise.all([host, guest].map((page) => page.evaluate(() => window.__game!.applied())));
  expect(applied[1]).toEqual(applied[0]);
  expect(applied[0]![0]).toEqual([{ type: 'test', x: 33, y: 44 }]);
  expect(applied[0]![1]).toEqual([{ type: 'test', x: 11, y: 22 }]);
  await expect(host.getByTestId('opponent-left')).toHaveCount(0);
  await expect(guest.getByTestId('opponent-left')).toHaveCount(0);
});
