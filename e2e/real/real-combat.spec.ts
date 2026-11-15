import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

// Master ids (empires.dat): the Bowman's arrow, the body a Villager leaves, the Bowman, the Town Center.
const ARROW = 9;
const DEAD_MAN = 43;
const BOWMAN = 4;
const TOWN_CENTER = 109;
/** `object_state`: active. */
const ACTIVE = 2;

test('a fight renders with real art: Bowmen shoot arrows, a Villager lies dead', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?debug=combat');
  await page.waitForFunction(() => window.__skirmish !== undefined && window.__map?.source === 'pack');
  // Every object is drawn from the pack, never as a debug shape.
  await page.waitForFunction(() => window.__skirmish!.shownObjects() > 0 && window.__skirmish!.packSprites() === window.__skirmish!.shownObjects());
  // A Villager has died into its body, and an arrow is in flight above the ground.
  await page.waitForFunction(
    ([arrow, dead]) => {
      const objects = window.__skirmish!.objects();
      return objects.some((o) => o.type === dead) && objects.some((o) => o.type === arrow && o.z > 0.3);
    },
    [ARROW, DEAD_MAN] as const,
    { polling: 'raf' },
  );
  // Villagers flee, so the fight drifts: centre the view on the body and the arrows, then take the shot.
  await page.evaluate(
    ([arrow, dead]) => {
      const points = window
        .__skirmish!.objects()
        .filter((o) => o.type === arrow || o.type === dead)
        .flatMap((o) => window.__skirmish!.objectScreenPos(o.id) ?? []);
      const x = points.reduce((s, p) => s + p.x, 0) / points.length;
      const y = points.reduce((s, p) => s + p.y, 0) / points.length;
      const camera = window.__map!.camera();
      window.__map!.setCamera(camera.x + x - innerWidth / 2, camera.y + y - innerHeight / 2);
    },
    [ARROW, DEAD_MAN] as const,
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  mkdirSync(shots, { recursive: true });
  const path = join(shots, 'combat.png');
  await page.getByTestId('game-canvas').screenshot({ path });
  const objects = await page.evaluate(() => window.__skirmish!.objects());
  expect(await page.evaluate(() => window.__skirmish!.packSprites())).toBe(await page.evaluate(() => window.__skirmish!.shownObjects()));
  const shown = await Promise.all(
    objects
      .filter((o) => o.type === ARROW || o.type === DEAD_MAN)
      .map(async (o) => `${o.type === ARROW ? 'arrow' : 'body'} at ${JSON.stringify(await page.evaluate((id) => window.__skirmish!.objectScreenPos(id), o.id))}`),
  );
  console.log(`screenshot: ${path}; ${shown.join(', ')}`);

  // With a Bowman selected, the pointer over the other player's Town Center is the original's sword (mcursors frame 4).
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  const bowman = objects.find((o) => o.owner === 1 && o.type === BOWMAN && o.state === ACTIVE)!;
  const at = (await page.evaluate((id) => window.__skirmish!.objectScreenPos(id), bowman.id))!;
  await page.mouse.move(box.x + at.x - 30, box.y + at.y - 30);
  await page.mouse.down();
  await page.mouse.move(box.x + at.x + 30, box.y + at.y + 40, { steps: 4 });
  await page.mouse.up();
  const tc = objects.find((o) => o.owner === 2 && o.type === TOWN_CENTER)!;
  await page.evaluate(([col, row]) => window.__map!.centerOnTile(col, row), [Math.floor(tc.x), Math.floor(tc.y)] as const);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const tcAt = (await page.evaluate((id) => window.__skirmish!.objectScreenPos(id), tc.id))!;
  await page.mouse.move(box.x + tcAt.x, box.y + tcAt.y);
  await expect.poll(() => page.getByTestId('game-canvas').evaluate((c) => c.style.cursor)).toMatch(/^url\("?data:image\/png/);
});
