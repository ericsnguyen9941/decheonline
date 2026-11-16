import { expect, test, type Page } from '@playwright/test';

// The production build carries the GTM snippet (run with `npm run test:e2e:prod`; the e2e build leaves it out). room_create and
// game_start reach window.dataLayer, also when googletagmanager.com is blocked.
const dataLayer = (page: Page) => page.evaluate(() => (window.dataLayer ?? []).map((e) => e.event));

for (const blocked of [false, true]) {
  test(`room_create and game_start reach the dataLayer${blocked ? ' with googletagmanager.com blocked' : ''}`, async ({ browser }) => {
    const host = await browser.newPage();
    const guest = await browser.newPage();
    for (const p of [host, guest]) {
      if (blocked) await p.route(/googletagmanager\.com/, (r) => r.abort());
      await p.goto('/');
    }
    expect(await host.content()).toContain('GTM-PFVT9V9G');
    await host.getByTestId('name').fill('Alice');
    await host.getByTestId('create').click();
    const code = (await host.getByTestId('invite-code').textContent()) ?? '';
    await guest.getByTestId('name').fill('Bob');
    await guest.getByTestId('code').fill(code);
    await guest.getByTestId('join').click();
    await expect(host.getByTestId('player-1')).toContainText('Bob');
    expect(await dataLayer(host)).toContain('room_create');
    await host.getByTestId('ready').click();
    await guest.getByTestId('ready').click();
    await host.getByTestId('start').click();
    await expect(host.getByTestId('game-canvas')).toBeVisible();
    const start = await host.evaluate(() => window.dataLayer?.find((e) => e.event === 'game_start'));
    expect(start).toMatchObject({ player_count: 2 });
    expect(typeof start?.map_type).toBe('number');
  });
}
