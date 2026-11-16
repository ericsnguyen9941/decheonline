import { expect, test } from '@playwright/test';

const URL = '/?debug=net&map=test&speed=20';

// A window smaller than the lobby must scroll to reach the buttons; the game screen must never scroll.
for (const size of [
  { width: 800, height: 450 },
  { width: 390, height: 700 },
]) {
  test(`lobby scrolls to its buttons at ${size.width}x${size.height}, the game does not`, async ({ browser }) => {
    const open = async () => {
      const page = await (await browser.newContext({ viewport: size })).newPage();
      await page.goto(URL);
      return page;
    };
    const host = await open();
    const guest = await open();
    await host.getByTestId('name').fill('Alice');
    await host.getByTestId('create').scrollIntoViewIfNeeded();
    await host.getByTestId('create').click();
    const code = (await host.getByTestId('invite-code').textContent())!;
    await guest.getByTestId('name').fill('Bob');
    await guest.getByTestId('code').fill(code);
    await guest.getByTestId('join').click();
    await expect(host.getByTestId('player-1')).toContainText('Bob');
    await host.getByTestId('ready').scrollIntoViewIfNeeded();
    await host.getByTestId('ready').click();
    await guest.getByTestId('ready').click();
    // The room is taller than the window: the page scrolls, and the Start button is reached by scrolling.
    expect(await host.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);
    await host.mouse.wheel(0, 5000);
    await expect.poll(() => host.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(host.getByTestId('start')).toBeEnabled();
    await host.getByTestId('start').scrollIntoViewIfNeeded();
    await host.getByTestId('start').click();
    await expect(host.getByTestId('game-canvas')).toBeVisible();
    await host.mouse.wheel(0, 500);
    await host.waitForTimeout(200);
    expect(await host.evaluate(() => [window.scrollY, document.documentElement.scrollTop, document.body.scrollTop])).toEqual([0, 0, 0]);
  });
}
