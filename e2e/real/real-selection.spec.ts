import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Local only; the screenshots land in assets-local/ (gitignored) because they show game art.
const dir = process.env.AOE1_DIR;
const shots = join(import.meta.dirname, '..', '..', 'assets-local', 'screenshots');

test.skip(!dir, 'set AOE1_DIR (and run npm run assets:import first)');

// Master ids (empires.dat): the Villager, the Villager cutting wood, the Gaia trees.
const VILLAGER = 83;
const LUMBERJACK = 123;
const TREES = [134, 141, 143];
/** `attribute_type_held` of wood. */
const WOOD = 1;

async function open(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('/?debug=net&map=test&speed=4');
  return page;
}

const slots = (page: Page) => page.locator('[data-testid=command-slot].used').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.command));

test('the top strip shows the age and buttons in the original strings; a wood carrier, a multi-selection and an enemy unit show in the panel', async ({
  browser,
}) => {
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
  // The debug strip of `?debug=net` covers the corner of the object panel.
  await host.getByTestId('net-debug').evaluate((el) => el.remove());
  const canvas = host.getByTestId('game-canvas');
  const box = (await canvas.boundingBox())!;
  const away = () => host.mouse.move(box.x + box.width / 2, box.y + 200);
  mkdirSync(shots, { recursive: true });

  // The age (string 4201) and the chat, diplomacy and menu buttons (4113-4115) from language.dll.
  await expect(host.getByTestId('age')).toHaveText('Stone Age');
  await expect(host.getByTestId('menu-chat')).toHaveText('Chat');
  await expect(host.getByTestId('menu-diplomacy')).toHaveText('Diplomacy');
  await expect(host.getByTestId('menu-menu')).toHaveText('Menu');

  // A Villager sent to the nearest tree cuts wood; selected, it shows the load row: itemicon frame 0 and the amount.
  const own = (await host.evaluate(() => window.__game!.objects())).filter((o) => o.owner === 1 && o.type === VILLAGER);
  const villager = own[0]!;
  const at = (await host.evaluate((id) => window.__game!.unitScreenPos(id), villager.id))!;
  await host.mouse.click(box.x + at.x, box.y + at.y - 15);
  await expect.poll(() => host.evaluate(() => window.__game!.selection())).toEqual([villager.id]);
  const trees = (await host.evaluate(() => window.__game!.objects())).filter((o) => o.owner === 0 && TREES.includes(o.type));
  const tree = trees.sort((a, b) => Math.hypot(a.x - villager.x, a.y - villager.y) - Math.hypot(b.x - villager.x, b.y - villager.y))[0]!;
  const treeAt = (await host.evaluate((id) => window.__game!.objectScreenPos(id), tree.id))!;
  await host.mouse.click(box.x + treeAt.x, box.y + treeAt.y, { button: 'right' });
  await host.waitForFunction(
    ([id, type, wood]) => {
      const o = window.__game!.objects().find((u) => u.id === id)!;
      return o.type === type && o.heldType === wood && o.heldAmount >= 4;
    },
    [villager.id, LUMBERJACK, WOOD] as const,
  );
  await expect(host.getByTestId('object-held')).toHaveText(/^\d+$/);
  expect(Number(await host.getByTestId('object-held').textContent())).toBeGreaterThanOrEqual(4);
  const style = (testid: string, prop: string) => host.getByTestId(testid).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  // The panel's rows are made again on every update: poll, as a read can land on a row just taken away.
  await expect.poll(() => style('object-held-icon', 'background-image')).toContain('/assets/sprites/interface/50731.png');
  await away();
  await host.screenshot({ path: join(shots, 'selection-wood.png') });

  // A box round the other Villagers selects them all; the panel shows one of them (`selected_obj`), and the grid gets
  // Group and Ungroup.
  const rest = own.slice(1);
  const points = await Promise.all(rest.map((u) => host.evaluate((id) => window.__game!.unitScreenPos(id)!, u.id)));
  const [x0, x1] = [Math.min(...points.map((p) => p.x)) - 20, Math.max(...points.map((p) => p.x)) + 20];
  const [y0, y1] = [Math.min(...points.map((p) => p.y)) - 40, Math.max(...points.map((p) => p.y)) + 20];
  await host.mouse.move(box.x + x0, box.y + y0);
  await host.mouse.down();
  await host.mouse.move(box.x + x1, box.y + y1, { steps: 5 });
  await host.mouse.up();
  await expect.poll(async () => ((await host.evaluate(() => window.__game!.selection())) ?? []).sort()).toEqual(rest.map((u) => u.id).sort());
  await expect(host.getByTestId('object-name')).toHaveText('Villager');
  expect(await slots(host)).toEqual(['build', 'repair', 'group', 'ungroup', 'unselect']);
  await away();
  await host.screenshot({ path: join(shots, 'selection-multi.png') });

  // Over a guest's Villager with own units selected: the sword and the rollover text 3701. The selected Villagers walk
  // to it until the fog shows it.
  const enemy = (await host.evaluate(() => window.__game!.objects())).find((o) => o.owner === 2 && o.type === VILLAGER)!;
  await host.evaluate(([ids, x, y]) => window.__game!.issueMove(ids, x, y), [rest.map((u) => u.id), enemy.x, enemy.y] as const);
  await host.waitForFunction(
    ([x, y]) => window.__game!.tileVisibility(x!, y!) === 0x0f,
    [Math.floor(enemy.x), Math.floor(enemy.y)] as const,
  );
  await host.evaluate((id) => {
    const p = window.__game!.unitScreenPos(id)!;
    const camera = window.__map!.camera();
    window.__map!.setCamera(camera.x + p.x - innerWidth / 2, camera.y + p.y - innerHeight / 2);
  }, enemy.id);
  // Only objects near the view are drawn: it is once the view is on it.
  const enemyAt = (await (await host.waitForFunction((id) => window.__game!.objectScreenPos(id), enemy.id)).jsonValue())!;
  await host.mouse.move(box.x + enemyAt.x, box.y + enemyAt.y);
  await expect(host.getByTestId('hud-message')).toHaveText('Click to attack this unit.');

  // A left click selects it: its owner's civilization, name, hit points and stats, its hit point bar, and only Unselect.
  await host.mouse.click(box.x + enemyAt.x, box.y + enemyAt.y);
  await expect.poll(() => host.evaluate(() => window.__game!.selection())).toEqual([enemy.id]);
  await expect(host.getByTestId('object-civ')).toHaveText('Egyptian');
  await expect(host.getByTestId('object-name')).toHaveText('Villager');
  await expect(host.getByTestId('object-hp')).toHaveText('25/25');
  await expect(host.getByTestId('object-attack')).toHaveText('3');
  expect(await style('object-icon', 'background-image')).toContain('/assets/sprites/interface/50730.o2.png');
  expect(await slots(host)).toEqual(['unselect']);
  await away();
  await expect(host.getByTestId('hud-message')).toBeHidden();
  await host.screenshot({ path: join(shots, 'selection-enemy.png') });
  console.log(`screenshots: ${['selection-wood', 'selection-multi', 'selection-enemy'].map((n) => join(shots, `${n}.png`)).join(' ')}`);
});
