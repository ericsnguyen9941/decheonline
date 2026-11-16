import { expect, test } from '@playwright/test';

// The first click starts audio (browsers need a gesture): the click task must stay short, so the context is made at
// load and the click only resumes it. The task is timed from a capture listener added before the app's to a bubble
// listener after it, which brackets every handler the app runs on that click.
test('the first click in the lobby unlocks audio in under 50 ms', async ({ page }) => {
  await page.addInitScript(() => {
    let start = 0;
    window.addEventListener('pointerdown', () => (start = performance.now()), { capture: true });
    window.addEventListener('pointerdown', () => ((window as unknown as { clickMs: number }).clickMs = performance.now() - start));
  });
  await page.goto('/');
  await page.mouse.click(400, 300);
  const ms = await page.evaluate(() => (window as unknown as { clickMs: number }).clickMs);
  console.log(`first click task: ${ms.toFixed(1)} ms`);
  expect(ms).toBeLessThan(50);
});
