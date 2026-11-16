import { expect, test, type Browser, type Page } from '@playwright/test';

const URL = '/?debug=net&map=test&speed=4';

async function startGame(browser: Browser): Promise<Page> {
  const open = async () => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(URL);
    return page;
  };
  const host = await open();
  const guest = await open();
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
  return host;
}

test('a right click on open ground leaves the red X where it was made, and it goes after its 8 frames', async ({ browser }) => {
  const page = await startGame(browser);
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  const tileAt = (col: number, row: number) => page.evaluate(([c, r]) => window.__map!.tileScreenPos(c!, r!), [col, row]);
  const markers = () => page.evaluate(() => window.__game!.markers());

  // Nothing selected: the click orders nothing and marks nothing.
  const p = await tileAt(14, 14);
  await page.mouse.click(box.x + p.x, box.y + p.y, { button: 'right' });
  expect(await markers()).toEqual([]);

  const unit = (await page.evaluate(() => window.__game!.units())).find((u) => u.owner === 1)!;
  const at = (await page.evaluate((id) => window.__game!.unitScreenPos(id), unit.id))!;
  await page.mouse.click(box.x + at.x, box.y + at.y - 15);
  expect(await page.evaluate(() => window.__game!.selection())).toEqual([unit.id]);

  await page.mouse.click(box.x + p.x, box.y + p.y, { button: 'right' });
  const first = await markers();
  expect(first).toHaveLength(1);
  expect(first[0]!.x).toBeCloseTo(p.x, 0);
  expect(first[0]!.y).toBeCloseTo(p.y, 0);
  // It plays through the frames of moveto.shp, 90 ms each, and is removed after the 8th (720 ms).
  await expect.poll(async () => (await markers())[0]?.frame ?? -1).toBeGreaterThan(2);
  await expect.poll(async () => (await markers()).length).toBe(0);

  // Each right click leaves its own marker.
  const q = await tileAt(16, 12);
  await page.mouse.click(box.x + p.x, box.y + p.y, { button: 'right' });
  await page.mouse.click(box.x + q.x, box.y + q.y, { button: 'right' });
  expect(await markers()).toHaveLength(2);
});
