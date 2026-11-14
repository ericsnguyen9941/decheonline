import { expect, test, type Browser, type Page } from '@playwright/test';

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('/?debug=net&speed=4');
  return page;
}

/** Host creates, guest joins by code, both ready, host starts; resolves once the host has drawn its units. */
async function startGame(browser: Browser): Promise<Page> {
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
  await host.getByTestId('start').click();
  await host.waitForFunction(() => window.__game?.selection() != null && window.__map !== undefined);
  return host;
}

test.setTimeout(60_000);

test('selecting a villager fills the bottom panel with its name and hit points', async ({ browser }) => {
  const host = await startGame(browser);
  await expect(host.getByTestId('hud-top')).toBeVisible();
  await expect(host.getByTestId('hud-bottom')).toBeVisible();
  await expect(host.getByTestId('res-wood').locator('b')).toHaveText('200');
  await expect(host.getByTestId('object-panel')).toBeHidden();

  const villager = (await host.evaluate(() => window.__game!.units())).find((u) => u.owner === 1 && u.type === 83)!;
  const at = (await host.evaluate((id) => window.__game!.unitScreenPos(id), villager.id))!;
  const box = (await host.getByTestId('game-canvas').boundingBox())!;
  await host.mouse.click(box.x + at.x, box.y + at.y - 15);
  await expect.poll(() => host.evaluate(() => window.__game!.selection())).toEqual([villager.id]);

  await expect(host.getByTestId('object-panel')).toBeVisible();
  // The synthetic pack's language.dll has the civilization (string 10231) but no record for unit 83: the dat name.
  await expect(host.getByTestId('object-civ')).toHaveText('Egyptian');
  await expect(host.getByTestId('object-name')).toHaveText('Man');
  await expect(host.getByTestId('object-hp')).toHaveText('25/25');

  // Clicking bare ground clears the selection, and the panel empties with it.
  await host.mouse.click(box.x + 10, box.y + 100);
  await expect(host.getByTestId('object-panel')).toBeHidden();
});
