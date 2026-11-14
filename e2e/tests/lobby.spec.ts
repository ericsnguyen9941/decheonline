import { expect, test, type Browser, type Page } from '@playwright/test';

// speed=20 runs the lockstep clock 20x faster so 50 turns take a few seconds.
const URL = '/?debug=net&speed=20';

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(URL);
  return page;
}

async function createGame(page: Page, name: string): Promise<string> {
  await page.getByTestId('name').fill(name);
  await page.getByTestId('create').click();
  const code = await page.getByTestId('invite-code').textContent();
  expect(code).toMatch(/^[A-Z0-9]{5}$/);
  return code!;
}

async function joinGame(page: Page, code: string, name: string): Promise<void> {
  await page.getByTestId('name').fill(name);
  await page.getByTestId('code').fill(code);
  await page.getByTestId('join').click();
}

/** Host creates, guest joins by code, both ready, host starts. */
async function startGame(browser: Browser): Promise<[Page, Page]> {
  const host = await open(browser);
  const guest = await open(browser);
  const code = await createGame(host, 'Alice');
  await joinGame(guest, code, 'Bob');
  await expect(host.getByTestId('player-1')).toContainText('Bob');
  await expect(guest.getByTestId('player-0')).toContainText('Alice');
  await expect(host.getByTestId('start')).toBeDisabled();
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await expect(host.getByTestId('start')).toBeEnabled();
  await expect(guest.getByTestId('start')).toHaveCount(0);
  await host.getByTestId('start').click();
  await expect(host.getByTestId('net-debug')).toBeVisible();
  await expect(guest.getByTestId('net-debug')).toBeVisible();
  return [host, guest];
}

test('two players join by invite code and stay in sync to turn 50 with commands from both sides', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  await host.evaluate(() => window.__game!.issueTest(10, 20));
  await guest.evaluate(() => window.__game!.issueTest(30, 40));
  // Another one later, from the guest only, to cross the single-step / full-turn boundary.
  await host.waitForFunction(() => window.__game!.turn() > 8);
  await guest.evaluate(() => window.__game!.issueTest(50, 60));

  for (const page of [host, guest]) await page.waitForFunction(() => window.__game!.turn() > 50, undefined, { timeout: 30_000 });
  const hashes = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game!.hash(50))));
  expect(hashes[0]).toBeDefined();
  expect(hashes[0]).toBe(hashes[1]);

  for (const page of [host, guest]) {
    const state = await page.evaluate(() => ({
      applied: window.__game!.applied().map((cmds) => cmds.map((c) => c.type)),
      owners: window.__game!.entityOwners(),
    }));
    expect(state.applied).toEqual([['test'], ['test', 'test']]);
    expect(state.owners.slice().sort()).toEqual([1, 2, 2]); // player 0 is Gaia: slot 0 -> 1, slot 1 -> 2
  }
});

test('joining with a wrong invite code shows an error', async ({ browser }) => {
  const page = await open(browser);
  await joinGame(page, 'ZZZZZ', 'Bob');
  await expect(page.getByTestId('error')).toHaveText('No game with that invite code.');
  await expect(page.getByTestId('invite-code')).toHaveCount(0);
});

test('a third player is told the game is full', async ({ browser }) => {
  const host = await open(browser);
  const guest = await open(browser);
  const third = await open(browser);
  const code = await createGame(host, 'Alice');
  await joinGame(guest, code, 'Bob');
  await expect(host.getByTestId('player-1')).toBeVisible();
  await joinGame(third, code, 'Carol');
  await expect(third.getByTestId('error')).toHaveText('That game is full.');
  await expect(host.getByTestId('players').locator('li')).toHaveCount(2);
});

test('the other player sees "Opponent left" when someone leaves mid-game', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  await guest.close();
  await expect(host.getByTestId('opponent-left')).toBeVisible();
  await expect(host.getByTestId('opponent-left')).toContainText('Opponent left');
});
