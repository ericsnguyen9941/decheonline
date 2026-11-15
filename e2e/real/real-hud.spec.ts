import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshot lands in assets-local/ (gitignored) because it shows game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('/?debug=net&map=test&speed=4');
  return page;
}

test('the game screen shows the original panels, a selected villager its civilization, name, hit points and attack, and the Town Center its name', async ({ browser }) => {
  const host = await open(browser);
  const guest = await open(browser);
  await host.getByTestId('name').fill('Alice');
  await host.getByTestId('create').click();
  const code = (await host.getByTestId('invite-code').textContent())!;
  await guest.getByTestId('name').fill('Bob');
  await guest.getByTestId('code').fill(code);
  await guest.getByTestId('join').click();
  await host.getByTestId('ready').click();
  await guest.getByTestId('ready').click();
  await host.getByTestId('start').click();
  // Every object the fog lets the player see is drawn from the pack.
  await host.waitForFunction(() => window.__game !== undefined && window.__game.shownObjects() > 0 && window.__game.packSprites() === window.__game.shownObjects());

  // 1280x800 gets the 1024x768 art: Egyptian screen SLP 50741 (frame 0 the strip, frame 1 the bottom panel).
  const style = (testid: string, prop: string) => host.getByTestId(testid).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  expect(await style('hud-bottom', 'background-image')).toContain('/assets/sprites/interface/50741.png');
  expect(await style('hud-top', 'background-image')).toContain('url("data:image/png');
  expect(await host.getByTestId('hud-bottom').evaluate((el) => el.getBoundingClientRect().height)).toBe(126);
  await expect(host.getByTestId('res-wood').locator('b')).toHaveText('200');
  await expect.poll(() => host.evaluate(() => document.getElementById('game')!.style.getPropertyValue('--cursor-normal'))).toContain('url(data:image/png');

  const villager = (await host.evaluate(() => window.__game!.units())).find((u) => u.owner === 1 && u.type === 83)!;
  const at = (await host.evaluate((id) => window.__game!.unitScreenPos(id), villager.id))!;
  const box = (await host.getByTestId('game-canvas').boundingBox())!;
  await host.mouse.click(box.x + at.x, box.y + at.y - 15);
  await expect.poll(() => host.evaluate(() => window.__game!.selection())).toEqual([villager.id]);

  // The language strings (languagex.dll over language.dll): the name is string 5131, not the dat's "Man".
  await expect(host.getByTestId('object-civ')).toHaveText('Egyptian');
  await expect(host.getByTestId('object-name')).toHaveText('Villager');
  await expect(host.getByTestId('object-hp')).toHaveText('25/25');
  // The attack row: itemicon (50731) frame 7 and the dat's displayed attack; a villager has no armour or range row.
  await expect(host.getByTestId('object-attack')).toHaveText('3');
  expect(await style('object-attack-icon', 'background-image')).toContain('/assets/sprites/interface/50731.png');
  await expect(host.getByTestId('object-armor')).toHaveCount(0);
  await expect(host.getByTestId('object-range')).toHaveCount(0);
  // The icon is the villager's picture in btnunit (SLP 50730) in the owner's colour (player 1: blue, image .o1).
  expect(await style('object-icon', 'background-image')).toContain('/assets/sprites/interface/50730.o1.png');
  expect(await style('object-health', 'background-image')).toContain('/assets/sprites/interface/50745.png');

  mkdirSync(shots, { recursive: true });
  await host.mouse.move(box.x + box.width / 2, box.y + 200); // away from the edges, which scroll the view
  // The debug strip of `?debug=net` covers the corner of the object panel.
  await host.getByTestId('net-debug').evaluate((el) => el.remove());
  // Over the Build button the message line shows the command's text.
  await host.locator('[data-testid=command-slot][data-command=build]').hover();
  await expect(host.getByTestId('hud-message')).toHaveText('Build (B)');
  await host.mouse.move(box.x + box.width / 2, box.y + 200);
  await expect(host.getByTestId('hud-message')).toBeHidden();
  await host.screenshot({ path: join(shots, 'hud.png') });
  console.log(`screenshot: ${join(shots, 'hud.png')}`);

  // The Town Center: its string name, and over the Villager button the message with the cost.
  const tc = (await host.evaluate(() => window.__game!.buildings())).find((b) => b.owner === 1 && b.type === 109)!;
  const tcAt = (await host.evaluate((id) => window.__game!.objectScreenPos(id), tc.id))!;
  await host.mouse.click(box.x + tcAt.x, box.y + tcAt.y);
  await expect.poll(() => host.evaluate(() => window.__game!.selection())).toEqual([tc.id]);
  await expect(host.getByTestId('object-name')).toHaveText('Town Center');
  await expect(host.getByTestId('object-civ')).toHaveText('Egyptian');
  await host.locator('[data-testid=command-slot][data-command=train][data-unit="83"]').hover();
  await expect(host.getByTestId('hud-message')).toHaveText('Create Villager (C) (Food: 50)');
  await host.screenshot({ path: join(shots, 'hud-town-center.png') });
  console.log(`screenshot: ${join(shots, 'hud-town-center.png')}`);
});
