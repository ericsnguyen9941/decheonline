import { expect, test, type Browser, type Page } from '@playwright/test';

// The server retunes the step size G and buffer frames F from turn 25 on (docs/spec/turn-timing.md §5, §7).

async function open(browser: Browser, url: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(url);
  return page;
}

/** Host creates, guest joins by code, both ready, host starts; resolves once both have drawn their units. */
async function startGame(browser: Browser, url: string): Promise<[Page, Page]> {
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
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game?.selection() != null && window.__map !== undefined);
  return [host, guest];
}

const net = (page: Page) => page.evaluate(() => window.__game!.net());

type Latency = { __latency?: Promise<number> };

/**
 * Right click tile (col, row) with unit `id` selected; resolves to the wall ms from the button going down to the
 * first change of the unit's position in the sim.
 */
async function clickToAction(page: Page, id: number, col: number, row: number): Promise<number> {
  await page.evaluate((id) => {
    (window as Latency).__latency = new Promise<number>((resolve) => {
      const onDown = (e: PointerEvent) => {
        if (e.button !== 2) return;
        window.removeEventListener('pointerdown', onDown, true);
        const t0 = performance.now();
        const at = () => window.__game!.units().find((u) => u.id === id)!;
        const { x, y } = at();
        const poll = () => {
          const u = at();
          if (u.x !== x || u.y !== y) resolve(performance.now() - t0);
          else setTimeout(poll, 1);
        };
        poll();
      };
      window.addEventListener('pointerdown', onDown, true);
    });
  }, id);
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  const p = await page.evaluate(([c, r]) => window.__map!.tileScreenPos(c!, r!), [col, row]);
  await page.mouse.click(box.x + p.x, box.y + p.y, { button: 'right' });
  return page.evaluate(() => (window as Latency).__latency!);
}

test('click-to-action at the original pace drops to the LAN range once the step size is tuned', async ({ browser }) => {
  test.setTimeout(90_000);
  const [host] = await startGame(browser, '/?debug=net');
  // Turns 7-24 run at the defaults, about 15 s of wall time.
  await host.waitForFunction(() => window.__game!.net().granularity !== 90, undefined, { timeout: 45_000, polling: 100 });
  const speed = await net(host);

  const unit = (await host.evaluate(() => window.__game!.units())).find((u) => u.owner === 1)!;
  const box = (await host.getByTestId('game-canvas').boundingBox())!;
  const at = (await host.evaluate((id) => window.__game!.unitScreenPos(id), unit.id))!;
  await host.mouse.click(box.x + at.x, box.y + at.y - 15);
  expect(await host.evaluate(() => window.__game!.selection())).toEqual([unit.id]);

  const measured: number[] = [];
  for (const [col, row] of [
    [13, 13],
    [10, 14],
    [14, 10],
  ] as const) {
    await host.waitForFunction((id) => !window.__game!.units().find((u) => u.id === id)!.moving, unit.id);
    measured.push(Math.round(await clickToAction(host, unit.id, col, row)));
  }
  console.log(`G ${speed.granularity} ms F ${speed.frames} frame ${speed.frameMs} ms: click-to-action ${measured.join(', ')} ms`);
  expect(Math.max(...measured)).toBeLessThanOrEqual(600);
});

test('both clients stay in sync while a longer round trip changes the step size and buffer frames', async ({ browser }) => {
  test.setTimeout(90_000);
  const [host, guest] = await startGame(browser, '/?debug=net&speed=20');
  const order = (page: Page, x: number, y: number) =>
    page.evaluate(
      ([x, y]) => {
        const g = window.__game!;
        g.issueMove(g.units().filter((u) => u.owner === g.player()).map((u) => u.id), x!, y!);
      },
      [x, y],
    );
  await order(host, 14, 14);
  await order(guest, 30, 24);
  await host.waitForFunction(() => window.__game!.net().granularity !== 90, undefined, { timeout: 30_000 });
  const tuned = await net(host);

  // Fake a 1.5 s round trip to the host. The server pings every 8 s; the next analysis after the long round trip
  // lands raises F to H / G + 2 (at most 20), so a turn's buffer covers the round trip or F hits the cap.
  await host.evaluate(() => window.__game!.delayPongs(1500));
  await order(host, 20, 10);
  await order(guest, 10, 20);
  await host.waitForFunction(() => window.__game!.net().rtt[0]! >= 1500, undefined, { timeout: 30_000 });
  for (const page of [host, guest]) {
    await page.waitForFunction(() => {
      const { granularity, frames } = window.__game!.net();
      return frames === 20 || granularity * frames >= 1500;
    }, undefined, { timeout: 30_000 });
  }
  const slowed = await net(host);
  expect(await net(guest)).toMatchObject({ granularity: slowed.granularity, frames: slowed.frames });
  expect(slowed.frames).toBeGreaterThan(tuned.frames);

  // Let both run on a while at the new speed, then compare every turn's hash.
  const turn = Math.max(...(await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game!.turn()))))) + 20;
  for (const page of [host, guest]) await page.waitForFunction((t) => window.__game!.turn() > t, turn);
  const hashes = await Promise.all(
    [host, guest].map((p) => p.evaluate((n) => Array.from({ length: n }, (_, t) => window.__game!.hash(t)), turn)),
  );
  expect(hashes[0]!.every((h) => h !== undefined)).toBe(true);
  expect(hashes[1]).toEqual(hashes[0]);
  console.log(
    `G/F ${tuned.granularity}/${tuned.frames} -> ${slowed.granularity}/${slowed.frames} at RTT ${slowed.rtt.join(' + ')} ms; ` +
      `${turn} turns, final hash ${hashes[0]![turn - 1]} in both clients`,
  );
});
