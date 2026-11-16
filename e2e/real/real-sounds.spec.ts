import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only: what the player hears with the real pack (docs/spec/sounds.md). The levels are measured on the outputs:
// an AnalyserNode after the sound gain and one after the music gain, sampled every frame (`__game.audioLevels()`, the
// peak since the last call), so a sound counts only when the browser's audio graph actually put it out.
const dir = process.env.AOE1_DIR;
const URL = '/?debug=net&map=test&speed=4';

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  // A sound or music file the server does not serve, or a synthesizer that fails, shows here.
  page.on('console', (m) => (m.type() === 'error' || m.text().startsWith('music:')) && console.log(`page ${m.type()}: ${m.text()}`));
  await page.goto(URL);
  return page;
}

/** The peak level of `bus` over the next `ms` (sampled every 100 ms). */
async function peak(page: Page, bus: 'sound' | 'music', ms = 1500): Promise<number> {
  let max = 0;
  await page.evaluate(() => window.__game!.audioLevels());
  for (let t = 0; t < ms; t += 100) {
    await page.waitForTimeout(100);
    max = Math.max(max, (await page.evaluate(() => window.__game!.audioLevels()))[bus]);
  }
  return max;
}

async function menuConfirm(page: Page, item: 'menu-resign' | 'menu-quit'): Promise<void> {
  await page.getByTestId('menu-menu').click();
  await page.getByTestId(item).click();
  await page.getByTestId('popup-yes').click();
}

test('sound and music are heard: button clicks, the terrain sound, music1.mid on in a game, the volume off, won.mid and lost.mid', async ({ browser }) => {
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
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__game !== undefined && window.__game.shownObjects() > 0 && window.__game.packSprites() === window.__game.shownObjects());
    await page.getByTestId('net-debug').evaluate((el) => el.remove());
  }

  // The lobby's clicks started the audio; the game plays music1.mid, synthesized and put out.
  for (const page of [host, guest]) {
    expect((await page.evaluate(() => window.__game!.audioLevels())).running).toBe(true);
    expect(await page.evaluate(() => window.__game!.music())).toEqual({ playing: 'music1.mid', on: true, volume: 50, tracks: 9 });
  }
  await expect.poll(() => peak(host, 'music'), { timeout: 30_000 }).toBeGreaterThan(0.01);
  console.log(`music1.mid peak: ${(await peak(host, 'music')).toFixed(3)}`);

  // The Menu button's click (button2.wav) on the sound output.
  await host.getByTestId('menu-menu').click();
  const click = await peak(host, 'sound', 500);
  console.log(`button2.wav peak: ${click.toFixed(3)}`);
  expect(click).toBeGreaterThan(0.01);

  // Settings: the music slider at "Off" and OK shut the music down; back up, it starts again from music1.mid.
  await host.getByTestId('menu-settings').click();
  await expect(host.getByTestId('music-volume')).toHaveValue('50');
  await host.getByTestId('music-volume').fill('99');
  await host.getByTestId('options-ok').click();
  expect(await host.evaluate(() => window.__game!.music())).toMatchObject({ playing: null, on: false, volume: 99 });
  await expect.poll(() => peak(host, 'music', 500)).toBeLessThan(0.0001);
  await host.getByTestId('menu-menu').click();
  await host.getByTestId('menu-settings').click();
  await host.getByTestId('music-volume').fill('20');
  await host.getByTestId('options-ok').click();
  expect(await host.evaluate(() => window.__game!.music())).toMatchObject({ playing: 'music1.mid', on: true, volume: 20 });
  await expect.poll(() => peak(host, 'music'), { timeout: 30_000 }).toBeGreaterThan(0.01);

  // The terrain sound: 20 s into the game screen, a file of the most drawn terrain's sound streams. The pointer left at
  // the top edge scrolled the view off the map (nothing drawn, no sound): back to the Town Center.
  await host.mouse.move(640, 400);
  await host.evaluate(() => {
    const tc = window.__game!.objects().find((o) => o.owner === 1 && o.type === 109)!;
    window.__map!.centerOnTile(Math.floor(tc.x), Math.floor(tc.y));
  });
  const terrains = () => host.evaluate(() => window.__game!.sounds().filter((s) => s.event === 'terrain'));
  const before = (await terrains()).length;
  await expect.poll(async () => (await terrains()).length, { timeout: 60_000 }).toBeGreaterThan(before);
  const terrain = (await terrains())[before]!;
  let level = 0;
  await expect.poll(async () => (level = Math.max(level, await peak(host, 'sound', 500))), { timeout: 8000 }).toBeGreaterThan(0.001);
  console.log(`terrain sound ${terrain.sound} ${terrain.file}: peak ${level.toFixed(3)}`);
  expect(terrain.wav).toBe(-1);
  expect(level).toBeGreaterThan(0.001);

  // The end of the game: the end achievements play won.mid for the winner, lost.mid for the other.
  await menuConfirm(guest, 'menu-resign');
  await expect(host.getByTestId('game-over-text')).toBeVisible();
  await menuConfirm(guest, 'menu-quit');
  await menuConfirm(host, 'menu-quit');
  for (const page of [host, guest]) await expect(page.getByTestId('achievements')).toBeVisible();
  expect((await host.evaluate(() => window.__game!.music())).playing).toBe('won.mid');
  expect((await guest.evaluate(() => window.__game!.music())).playing).toBe('lost.mid');
  await expect.poll(() => peak(guest, 'music'), { timeout: 30_000 }).toBeGreaterThan(0.01);
  console.log(`lost.mid peak: ${(await peak(guest, 'music')).toFixed(3)}`);
});
