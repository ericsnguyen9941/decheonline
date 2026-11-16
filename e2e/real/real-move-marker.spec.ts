import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');
test.setTimeout(600_000);

test('real pack: a right click on the ground draws moveto.shp\'s red X, which plays out and goes', async ({ browser }) => {
  mkdirSync(shots, { recursive: true });
  const open = async () => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await page.addInitScript(() => {
      const real = performance.now.bind(performance);
      let frozenAt: number | null = null;
      let shift = 0;
      performance.now = () => (frozenAt ?? real()) - shift;
      Object.assign(window, { __freeze: () => (frozenAt = real()), __thaw: () => { shift += real() - frozenAt!; frozenAt = null; } });
    });
    await page.goto('/?debug=net&map=test&speed=4');
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
  for (const page of [host, guest]) await page.waitForFunction(() => window.__game?.selection() != null && window.__map?.source === 'pack');

  const box = (await host.getByTestId('game-canvas').boundingBox())!;
  const unit = (await host.evaluate(() => window.__game!.units())).find((u) => u.owner === 1)!;
  const at = (await host.evaluate((id) => window.__game!.unitScreenPos(id), unit.id))!;
  await host.mouse.click(box.x + at.x, box.y + at.y - 15);
  expect(await host.evaluate(() => window.__game!.selection())).toEqual([unit.id]);
  // A shot takes seconds on a loaded machine and the X lasts 720 ms: stop the page's clock while a frame with art is up.
  const p = await host.evaluate(() => window.__map!.tileScreenPos(18, 14));
  const path = join(shots, 'move-marker.png');
  await host.mouse.click(box.x + p.x, box.y + p.y, { button: 'right' });
  await host.waitForFunction(() => {
    const shown = window.__game!.markers().some((m) => m.shown && m.frame >= 1 && m.frame <= 3);
    if (shown) (window as unknown as { __freeze(): void }).__freeze();
    return shown;
  });
  await host.screenshot({ path, clip: { x: box.x + p.x - 60, y: box.y + p.y - 40, width: 120, height: 80 } });
  const frozen = await host.evaluate(() => window.__game!.markers());
  expect(frozen).toHaveLength(1);
  expect(frozen[0]!.shown).toBe(true);
  await host.evaluate(() => (window as unknown as { __thaw(): void }).__thaw());
  // The X plays out its frames and goes.
  await expect.poll(() => host.evaluate(() => window.__game!.markers().length)).toBe(0);
  console.log(`screenshot: ${path}`);
});
