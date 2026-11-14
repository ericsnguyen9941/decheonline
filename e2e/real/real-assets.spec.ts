import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Local only; the screenshot lands in assets-local/ (gitignored) because it shows game art.
const dir = process.env.AOE1_DIR;
const shot = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots', 'assets-debug.png');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

test('debug view renders real terrain and a Villager from the pack', async ({ page }) => {
  await page.goto('/?debug=assets');
  await page.waitForFunction(() => window.__assetsDebug !== undefined);
  const view = await page.evaluate(() => {
    const v = window.__assetsDebug!;
    return { source: v.source, terrainFrames: v.terrainFrames, unitRect: v.unitRect };
  });
  expect(view.source).toBe('pack');
  expect(view.terrainFrames).toBeGreaterThan(1);
  expect(view.unitRect).not.toBeNull();
  mkdirSync(join(shot, '..'), { recursive: true });
  await page.getByTestId('game-canvas').screenshot({ path: shot });
  console.log(`screenshot: ${shot}`);
});
