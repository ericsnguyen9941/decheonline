import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Local only; the screenshot lands in assets-local/ (gitignored) because it shows game art.
const dir = process.env.AOE1_DIR;
const shot = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots', 'map.png');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

test('the test map renders with real terrain from the pack', async ({ page }) => {
  await page.goto('/?debug=map&col=26&row=30');
  await page.waitForFunction(() => window.__map !== undefined && window.__map.drawnTiles() > 0);
  expect(await page.evaluate(() => window.__map!.source)).toBe('pack');
  mkdirSync(join(shot, '..'), { recursive: true });
  await page.getByTestId('game-canvas').screenshot({ path: shot });
  console.log(`screenshot: ${shot}`);
});
