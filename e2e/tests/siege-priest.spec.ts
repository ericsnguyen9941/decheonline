import { expect, test, type Browser, type Page } from '@playwright/test';

// speed=20 runs the lockstep clock 20x faster; units= gives every player a Stone Thrower, a Priest and a Clubman above
// its Villagers (both clients ask for the same, so their games stay the same).
const URL = '/?debug=net&map=test&speed=20&units=35,125,73';

/** Master ids (empires.dat): Stone Thrower, Priest, Clubman, the Stone Thrower's stone. */
const STONE_THROWER = 35;
const PRIEST = 125;
const CLUBMAN = 73;
const STONE = 34;
/** `relation` stance: neutral (the test map's bases are close; nobody fights unless ordered). */
const NEUTRAL = 1;
/** Game sound 13, convwarn.wav: the old owner's conversion warning (docs/spec/sounds.md). */
const CONVERTED = 13;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL);
  return page;
}

/** Host creates, guest joins by code, both ready, host starts; both players then take a neutral stance. */
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
  await expect(host.getByTestId('start')).toBeEnabled();
  await host.getByTestId('start').click();
  const pages = [host, guest];
  for (const page of pages) await page.waitForFunction(() => window.__game?.selection() != null && window.__map !== undefined);
  for (const [i, page] of pages.entries()) await page.evaluate(([p, r]) => window.__game!.issue({ type: 'relation', player: p, relation: r }), [2 - i, NEUTRAL] as const);
  for (const page of pages) await page.waitForFunction((r) => window.__game!.relation(1, 2) === r && window.__game!.relation(2, 1) === r, NEUTRAL);
  return [host, guest];
}

const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const slot = (page: Page, command: string) => page.locator(`[data-testid=command-slot][data-command=${command}]`);
const unitOf = async (page: Page, owner: number, type: number) => (await page.evaluate(() => window.__game!.units())).find((u) => u.owner === owner && u.type === type)!;
const objectById = async (page: Page, id: number) => (await page.evaluate(() => window.__game!.objects())).find((o) => o.id === id);
/** The commands of every batch received so far (`applied()` lists a batch when it arrives, two turns before it runs). */
const applied = (page: Page) => page.evaluate(() => window.__game!.applied().flat() as unknown as { type: string; [field: string]: unknown }[]);

/** Centres the view on unit `id` and left clicks it (a little higher each try: its sprite stands above its foot point). */
async function selectUnit(page: Page, id: number): Promise<void> {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  for (const dy of [-15, -30, -5, -45]) {
    // Esc first: a second click on the same spot with something selected picks past it (`clickAt`).
    await page.keyboard.press('Escape');
    const u = (await page.evaluate(() => window.__game!.units())).find((x) => x.id === id)!;
    await page.evaluate(([x, y]) => window.__map!.centerOnTile(Math.floor(x), Math.floor(y)), [u.x, u.y] as const);
    await frames(page);
    const at = (await page.evaluate((i) => window.__game!.unitScreenPos(i), id))!;
    await page.mouse.click(box.x + at.x, box.y + at.y + dy);
    await frames(page);
    if (JSON.stringify(await page.evaluate(() => window.__game!.selection())) === JSON.stringify([id])) return;
  }
  await expect.poll(() => page.evaluate(() => window.__game!.selection())).toEqual([id]);
}

/**
 * Presses the selected Priest's `button` (heal or convert) and clicks `target`, until a `work` order on it goes out (a
 * click that misses the sprite ends the mode with cantdo.wav, so each try arms it again).
 */
async function priestOrder(page: Page, button: 'heal' | 'convert', target: number): Promise<void> {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  const sent = async () => (await applied(page)).some((c) => c.type === 'work' && c.target === target);
  for (const dy of [-15, -30, -5, -45, -20, -10]) {
    const u = (await page.evaluate(() => window.__game!.units())).find((x) => x.id === target)!;
    await page.evaluate(([x, y]) => window.__map!.centerOnTile(Math.floor(x), Math.floor(y)), [u.x, u.y] as const);
    await frames(page);
    await slot(page, button).click({ timeout: 15_000 });
    expect(await page.evaluate(() => window.__game!.commandMode())).toBe(button);
    const at = (await page.evaluate((i) => window.__game!.unitScreenPos(i), target))!;
    await page.mouse.click(box.x + at.x, box.y + at.y + dy);
    await frames(page);
    expect(await page.evaluate(() => window.__game!.commandMode())).toBeNull();
    try {
      await expect.poll(sent, { timeout: 3000 }).toBe(true);
      return;
    } catch {
      // missed: try the next spot
    }
  }
  expect(await sent()).toBe(true);
}

// The lockstep paces steps to the clients' frame times (turn-timing.md §8.1): the waits are on state.
test.setTimeout(600_000);

test('Attack Ground, Heal and Convert from their buttons, on two clients', async ({ browser }) => {
  const [host, guest] = await startGame(browser);
  const both = [host, guest];
  const st = await unitOf(host, 1, STONE_THROWER);
  const priest = await unitOf(host, 1, PRIEST);
  const ownClub = await unitOf(host, 1, CLUBMAN);
  const enemyClub = await unitOf(host, 2, CLUBMAN);
  const guestSt = await unitOf(host, 2, STONE_THROWER);

  // A click mode leaves only Cancel in the grid, and Esc leaves the mode with the selection kept.
  await selectUnit(host, st.id);
  await expect(slot(host, 'attack-ground')).toBeVisible();
  await slot(host, 'attack-ground').click();
  expect(await host.evaluate(() => window.__game!.commandMode())).toBe('attack-ground');
  await expect(host.locator('[data-testid=command-slot]:not([data-command=""])')).toHaveCount(1);
  await expect(slot(host, 'cancel')).toBeVisible();
  await host.keyboard.press('Escape');
  expect(await host.evaluate(() => window.__game!.commandMode())).toBeNull();
  expect(await host.evaluate(() => window.__game!.selection())).toEqual([st.id]);
  await expect(slot(host, 'attack-ground')).toBeVisible();

  // Attack Ground: the button, then a click on a tile 6 tiles left of the Stone Thrower (away from the other units) (the view's centre).
  const tile = { col: Math.floor(st.x) - 6, row: Math.floor(st.y) };
  await host.evaluate(([c, r]) => window.__map!.centerOnTile(c, r), [tile.col, tile.row] as const);
  await frames(host);
  await slot(host, 'attack-ground').click();
  const box = (await host.getByTestId('game-canvas').boundingBox())!;
  await host.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(await host.evaluate(() => window.__game!.commandMode())).toBeNull();
  await expect.poll(async () => (await applied(host)).find((c) => c.type === 'attack-ground')).toBeTruthy();
  const ground = (await applied(host)).find((c) => c.type === 'attack-ground')!;
  expect(ground.units).toEqual([st.id]);
  expect(Math.abs((ground.x as number) - tile.col)).toBeLessThanOrEqual(2);
  expect(Math.abs((ground.y as number) - tile.row)).toBeLessThanOrEqual(2);
  // It fires: a stone of the host's flies, on both clients.
  for (const p of both) await p.waitForFunction((s) => window.__game!.objects().some((o) => o.owner === 1 && o.type === s), STONE);
  await host.keyboard.press('Escape');
  // It walks into the corner, and the host's Clubman away from it, out of its sight: else it fires at the guest's Clubman
  // in the fight below to defend the host's.
  await host.evaluate((id) => window.__game!.issueMove([id], 1.5, 1.5), st.id);
  await host.evaluate((id) => window.__game!.issueMove([id], 18.5, 12.5), ownClub.id);
  await host.waitForFunction(([s, c]) => {
    const [a, b] = [s, c].map((id) => window.__game!.units().find((o) => o.id === id)!);
    return Math.hypot(a!.x - b!.x, a!.y - b!.y) > 16 && !b!.moving;
  }, [st.id, ownClub.id] as const);
  const club = (await objectById(host, ownClub.id))!;

  // The guest selects its Clubman and makes it group 1, as a player would before losing it.
  await selectUnit(guest, enemyClub.id);
  await guest.keyboard.press('Control+Digit1');
  await expect.poll(() => guest.evaluate(() => window.__game!.groupNumbers())).toContainEqual({ id: enemyClub.id, group: 1 });

  // The guest's Clubman hurts the host's Clubman; the guest's Stone Thrower walks close so the guest sees.
  await guest.evaluate(([a, t]) => window.__game!.issue({ type: 'attack', units: [a], target: t }), [enemyClub.id, ownClub.id] as const);
  await guest.evaluate(([id, x, y]) => window.__game!.issueMove([id], x, y), [guestSt.id, club.x + 2, club.y + 2] as const);
  await host.waitForFunction(([id, hp]) => (window.__game!.objects().find((o) => o.id === id)?.hp ?? hp) < hp, [ownClub.id, (await objectById(host, ownClub.id))!.hp] as const);
  // Both stop: the host's Clubman hits back once attacked.
  await guest.evaluate((id) => window.__game!.issue({ type: 'stop', objects: [id] }), enemyClub.id);
  await host.evaluate((id) => window.__game!.issue({ type: 'stop', objects: [id] }), ownClub.id);

  // Heal: the Priest's Heal button on the hurt Clubman raises its hit points.
  const hurt = (await objectById(host, ownClub.id))!.hp;
  await selectUnit(host, priest.id);
  await expect(slot(host, 'heal')).toBeVisible();
  await expect(slot(host, 'convert')).toBeVisible();
  await priestOrder(host, 'heal', ownClub.id);
  await host.waitForFunction(([id, hp]) => window.__game!.objects().find((o) => o.id === id)!.hp > hp, [ownClub.id, hurt] as const);

  // Convert: the Priest's Convert button on the guest's Clubman; it turns the host's, drawn in the host's colour and out of
  // the guest's selection and group on both clients, and the guest hears convwarn.
  await selectUnit(host, priest.id);
  await priestOrder(host, 'convert', enemyClub.id);
  for (const p of both) await p.waitForFunction((id) => window.__game!.objects().find((o) => o.id === id)?.owner === 1, enemyClub.id);
  for (const p of both) await expect.poll(() => p.evaluate((id) => window.__game!.drawnOwner(id), enemyClub.id)).toBe(1);
  expect(await guest.evaluate(() => window.__game!.selection())).not.toContain(enemyClub.id);
  expect((await guest.evaluate(() => window.__game!.groupNumbers())).some((g) => g.id === enemyClub.id)).toBe(false);
  expect((await guest.evaluate(() => window.__game!.sounds())).some((s) => s.game === CONVERTED)).toBe(true);
  expect((await host.evaluate(() => window.__game!.sounds())).some((s) => s.game === CONVERTED)).toBe(false);

  // Both games agree on the hash of a turn both have run.
  const turn = Math.max(...(await Promise.all(both.map((p) => p.evaluate(() => window.__game!.turn()))))) + 2;
  for (const p of both) await p.waitForFunction((t) => window.__game!.turn() > t, turn);
  const [a, b] = await Promise.all(both.map((p) => p.evaluate((t) => window.__game!.hash(t), turn)));
  expect(a).toBe(b);
  console.log(`stone at (${ground.x}, ${ground.y}); Clubman ${ownClub.id} healed from ${hurt}; Clubman ${enemyClub.id} converted; turn ${turn} hash ${a}`);
});
