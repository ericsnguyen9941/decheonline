import { expect, test, type Browser, type Page } from '@playwright/test';

// The game screen's function keys, the cheats' map flags, the tribute notice's amount and taunts on two clients
// (docs/spec/hud.md "F11 clock and population, F5 timings", "Formations"; chat.md §7.5, §8; diplomacy.md §7): the fixed
// test map, 1000 of each resource and a Market each (tribute), Enable Cheating on.
const URL = '/?debug=net&map=test&speed=20&resources=1000&market=1';
const VILLAGER = 83;
/** `RGE_TILE_VISIBLE`, `RGE_TILE_FOGGED`, unexplored. */
const [VISIBLE, FOGGED, BLACK] = [0x0f, 0x80, 0];
/** `TRIBE_Game::sounds` index 4, tribute.wav. */
const SOUND_TRIBUTE = 4;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

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
  await host.getByTestId('cheating').check();
  await expect(guest.getByTestId('settings-summary')).toContainText('Enable Cheating: Yes');
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game?.selection() != null && window.__game.minimapPoint(0, 0) != null && window.__game.turn() > 5);
  return [host, guest];
}

const chatLines = (page: Page) => page.getByTestId('chat-line');
const applied = (page: Page, type: string) => page.evaluate((t) => window.__game!.applied().flat().filter((c) => c.type === t), type);
const drawn = (page: Page, col: number, row: number) => page.evaluate(([c, r]) => window.__game!.drawnTile(c, r), [col, row] as const);

/** Enter's chat bar: type `text` and send it. */
async function say(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('quick-chat')).toBeVisible();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('quick-chat')).toHaveCount(0);
}

test('F11, F4, F5 and Shift+F2..F7 on both clients, as the original', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  for (const page of [host, guest]) {
    // The game clock at the main view's top left and "pop: n/room" (tpnl_pop.cpp) are always shown; F11 does not hide them
    // (`pop-overlay.spec.ts` covers the rest).
    await expect(page.getByTestId('game-clock')).toBeVisible();
    await expect(page.getByTestId('game-clock')).toHaveText(/^\d\d:\d\d:\d\d \(1\.0\)$/);
    const first = (await page.getByTestId('game-clock').textContent())!;
    await expect(page.getByTestId('game-clock')).not.toHaveText(first);
    const pop = await page.evaluate(() => window.__game!.population());
    await expect(page.getByTestId('population')).toHaveText(`pop: ${pop.count}/${Math.min(pop.count + pop.headroom, pop.limit)}`);
    await page.keyboard.press('F11');
    await expect(page.getByTestId('game-clock')).toBeVisible();
    await expect(page.getByTestId('population')).toBeVisible();

    // F4: the score display, a line per player; again, gone.
    await page.keyboard.press('F4');
    const scores = page.getByTestId('score-line').filter({ visible: true });
    await expect(scores).toHaveText([/^(Alice|Bob): \d+\/\d+$/, /^(Alice|Bob): \d+\/\d+$/]);
    await page.keyboard.press('F4');
    await expect(scores).toHaveCount(0);

    // F5: the timings in place of the resource counts, averages, then peaks, then off.
    await page.keyboard.press('F5');
    await expect(page.getByTestId('timings')).toHaveText(/^t\d+,f\d+,avg\(r\(v0,m0,o0\),s0,u0,c0,l0,p0,o0\)$/);
    await expect(page.getByTestId('resource-bar')).toBeHidden();
    await page.keyboard.press('F5');
    await expect(page.getByTestId('timings')).toHaveText(/^t\d+,f\d+,max\(/);
    await page.keyboard.press('F5');
    await expect(page.getByTestId('timings')).toBeHidden();
    await expect(page.getByTestId('resource-bar')).toBeVisible();
    // F5 did not reload the page: the game goes on.
    expect(await page.evaluate(() => window.__game!.turn())).toBeGreaterThan(5);
  }

  // Shift+F4 (formation 2, a line along x) for the host's three Villagers, box-selected.
  const villagers = (await host.evaluate(() => window.__game!.units())).filter((u) => u.owner === 1 && u.type === VILLAGER);
  const box = (await host.getByTestId('game-canvas').boundingBox())!;
  const at = await Promise.all(villagers.map((v) => host.evaluate((id) => window.__game!.unitScreenPos(id)!, v.id)));
  const xs = at.map((p) => p.x);
  const ys = at.map((p) => p.y);
  await host.mouse.move(box.x + Math.min(...xs) - 30, box.y + Math.min(...ys) - 40);
  await host.mouse.down();
  await host.mouse.move(box.x + Math.max(...xs) + 30, box.y + Math.max(...ys) + 20, { steps: 5 });
  await host.mouse.up();
  await expect.poll(async () => (await host.evaluate(() => window.__game!.selection()))!.length).toBe(3);
  await host.keyboard.press('Shift+F4');
  for (const page of [host, guest]) {
    await expect.poll(() => applied(page, 'formation')).toHaveLength(1);
    const [c] = (await applied(page, 'formation')) as unknown as { units: number[]; formation: number }[];
    expect(c!.formation).toBe(2);
    expect([...c!.units].sort()).toEqual(villagers.map((v) => v.id).sort());
  }
  // The reference (nearest the origin) stays; the others walk towards rx + 2 and rx + 4 on its row (commands.md §6;
  // on the test map the three stand in that row already, so the last one walks along it past the others).
  const ref = [...villagers].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0]!;
  await host.waitForFunction(
    ([id, x, y, start]) => {
      const mine = window.__game!.units().filter((u) => u.owner === 1 && u.type === 83);
      const others = mine.filter((u) => u.id !== id);
      return mine.every((u) => !u.moving && Math.abs(u.y - y) < 1) && others.every((u) => u.x > x) && Math.max(...others.map((u) => u.x)) > start + 1;
    },
    [ref.id, ref.x, ref.y, Math.max(...villagers.map((v) => v.x))] as const,
  );
  // Both games the same.
  const turn = (await host.evaluate(() => window.__game!.turn())) + 2;
  for (const page of [host, guest]) await page.waitForFunction((t) => window.__game!.turn() > t, turn);
  const hashes = await Promise.all([host, guest].map((p) => p.evaluate((t) => window.__game!.hash(t), turn)));
  expect(hashes[0]).toBeDefined();
  expect(hashes[0]).toBe(hashes[1]);
});

test('REVEAL MAP and NO FOG draw the map on both screens; the tribute notice gives the amount received; a number plays its taunt', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  // A tile far from both bases: unexplored for both.
  const [col, row] = [2, 45];
  for (const page of [host, guest]) expect(await drawn(page, col, row)).toBe(BLACK);
  const linesBefore = await chatLines(guest).allTextContents();

  // A cheat goes out as its command, not as chat: no line on either screen (chat.md §7.1); the shared map's flag draws
  // every tile explored on both.
  await say(guest, 'REVEAL MAP');
  for (const page of [host, guest]) await expect.poll(() => drawn(page, col, row)).toBe(FOGGED);
  expect(await chatLines(host).filter({ hasText: 'REVEAL MAP' }).count()).toBe(0);
  expect((await chatLines(guest).allTextContents()).filter((t) => t.includes('REVEAL'))).toEqual(linesBefore.filter((t) => t.includes('REVEAL')));
  // The other player's Villagers are still hidden in the fog.
  const enemyHidden = await host.evaluate(() => window.__game!.units().filter((u) => u.owner === 2).every((u) => window.__game!.drawnTile(u.col, u.row) !== 0x0f));
  expect(enemyHidden).toBe(true);
  await say(host, 'NO FOG');
  for (const page of [host, guest]) await expect.poll(() => drawn(page, col, row)).toBe(VISIBLE);
  await host.waitForFunction(() => window.__game!.units().filter((u) => u.owner === 2).every((u) => window.__game!.drawnTile(u.col, u.row) === 0x0f));
  // Each in its sender's batch.
  expect(await applied(host, 'cheat')).toEqual(expect.arrayContaining([
    { type: 'cheat', code: 230 },
    { type: 'cheat', code: 231 },
  ]));

  // 2000 food offered of 1000 with a 25% fee: the whole stock goes, 750 reach Bob, the amount the sim logged.
  await host.evaluate(() => window.__game!.issue({ type: 'tribute', player: 2, resource: 0, amount: 2000 }));
  await expect(chatLines(guest).filter({ hasText: 'Alice paid 750 food in tribute to you.' })).toBeVisible();
  await expect.poll(() => guest.evaluate((n) => window.__game!.sounds().filter((s) => s.event === 'message' && s.game === n).length, SOUND_TRIBUTE)).toBe(1);
  expect(await chatLines(host).filter({ hasText: 'tribute' }).count()).toBe(0);

  // "12" is a chat line and taunt 12 on both screens; 77 has no wav.
  await say(host, '12');
  for (const page of [host, guest]) {
    await expect(chatLines(page).filter({ hasText: 'Alice: 12' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__game!.sounds().filter((s) => s.event === 'taunt'))).toEqual([{ event: 'taunt', sound: -1, game: -1, wav: 12, source: 12 }]);
  }
  await say(guest, '77');
  await expect.poll(() => host.evaluate(() => window.__game!.sounds().filter((s) => s.event === 'taunt').at(-1))).toEqual({ event: 'taunt', sound: -1, game: -1, wav: null, source: 77 });
});
