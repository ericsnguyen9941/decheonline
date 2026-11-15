// A Villager walks onto a hill by a right click on the raised tile and is then selected by a left click on it, where
// it is drawn (docs/spec/hud.md "Elevation"). Shared by the debug-art and the real-asset random map specs.
import { expect, type Page } from '@playwright/test';

const VILLAGER = 83;
/** Water and deep water: every other terrain is walked on, unless an object (a tree) stands there. */
const WATER = [1, 22];

export interface HillWalk {
  villager: number;
  hill: { col: number; row: number; height: number };
  /** How far up the screen the Villager is drawn from its flat map pixel, in pixels. */
  lift: number;
}

/**
 * The plateau tile nearest the Villager on foot: raised, it and its 8 neighbours level at the same height (so a Villager
 * that stops next to its middle still stands at that height), not water, nothing on it or round it, and reached from
 * the Villager over such tiles (a flood fill, so not behind water or a wall of trees).
 */
function findHill(page: Page, villager: number) {
  return page.evaluate(
    ([id, water]) => {
      const g = window.__game!;
      const m = window.__map!;
      const me = g.units().find((u) => u.id === id)!;
      const taken = new Set(g.objects().filter((o) => o.id !== id).map((o) => Math.floor(o.y) * m.width + Math.floor(o.x)));
      const walkable = (c: number, r: number) => c >= 0 && r >= 0 && c < m.width && r < m.height && !taken.has(r * m.width + c) && !water!.includes(m.tileInfo(c, r).terrain);
      const plateau = (col: number, row: number) => {
        const t = m.tileInfo(col, row);
        if (t.height < 1 || t.type !== 0) return false;
        for (let r = row - 2; r <= row + 2; r++) {
          for (let c = col - 2; c <= col + 2; c++) {
            if (!walkable(c, r)) return false;
            const n = m.tileInfo(c, r);
            if (Math.abs(c - col) <= 1 && Math.abs(r - row) <= 1 && (n.height !== t.height || n.type !== 0)) return false;
          }
        }
        return true;
      };
      const start = [Math.floor(me.x), Math.floor(me.y)] as const;
      const seen = new Set([start[1] * m.width + start[0]]);
      let queue: (readonly [number, number])[] = [start];
      for (let steps = 0; queue.length > 0 && steps < 80; steps++) {
        const next: (readonly [number, number])[] = [];
        for (const [col, row] of queue) {
          if (steps >= 5 && plateau(col, row)) return { col, row, height: m.tileInfo(col, row).height };
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
            const [c, r] = [col + dc, row + dr];
            // A diagonal step needs both sides open, as the pathing does.
            if (seen.has(r * m.width + c) || !walkable(c, r) || (dc !== 0 && dr !== 0 && (!walkable(col + dc, row) || !walkable(col, row + dr)))) continue;
            seen.add(r * m.width + c);
            next.push([c, r]);
          }
        }
        queue = next;
      }
      return null;
    },
    [villager, WATER] as const,
  );
}

export async function walkOntoHill(page: Page): Promise<HillWalk> {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  const villager = await page.evaluate((v) => window.__game!.units().find((u) => u.owner === window.__game!.player() && u.type === v)!.id, VILLAGER);
  const hill = await findHill(page, villager);
  expect(hill, 'a plateau tile the Villager can walk to').not.toBeNull();

  // Select the Villager with a left click on it.
  await page.evaluate((id) => {
    const u = window.__game!.units().find((x) => x.id === id)!;
    window.__map!.centerOnTile(Math.floor(u.x), Math.floor(u.y));
  }, villager);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const at = (await page.evaluate((id) => window.__game!.objectScreenPos(id), villager))!;
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await expect.poll(() => page.evaluate(() => window.__game!.selection())).toEqual([villager]);

  // Right click on the middle of the raised tile, as it is drawn: the Villager walks there.
  await page.evaluate(([c, r]) => window.__map!.centerOnTile(c!, r!), [hill!.col, hill!.row] as const);
  const spot = await page.evaluate(([c, r]) => window.__map!.tileScreenPos(c!, r!), [hill!.col, hill!.row] as const);
  expect(await page.evaluate(([x, y]) => window.__map!.tileAt(x!, y!), [spot.x, spot.y] as const)).toEqual({ col: hill!.col, row: hill!.row });
  await page.mouse.click(box.x + spot.x, box.y + spot.y, { button: 'right' });
  // It stops at the clicked point, or next to it when another unit stands there.
  await expect
    .poll(
      async () => {
        const [u, applied] = await page.evaluate((id) => [window.__game!.units().find((x) => x.id === id)!, window.__game!.applied().flat().slice(-2)] as const, villager);
        const off = Math.hypot(u.x - hill!.col - 0.5, u.y - hill!.row - 0.5);
        return u.moving || off >= 1 ? `at ${u.x.toFixed(2)}, ${u.y.toFixed(2)}${u.moving ? ', moving' : ''} for ${JSON.stringify(hill)}; ${JSON.stringify(applied)}` : 'arrived';
      },
      { timeout: 180_000 },
    )
    .toBe('arrived');

  // Select something else (H: the Town Center), then a left click on the Villager standing on the hill selects it.
  await page.keyboard.press('h');
  await expect.poll(() => page.evaluate(() => window.__game!.selection())).not.toEqual([villager]);
  await page.evaluate(([c, r]) => window.__map!.centerOnTile(c!, r!), [hill!.col, hill!.row] as const);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const placed = await page.evaluate((id) => {
    const u = window.__game!.units().find((x) => x.id === id)!;
    const cam = window.__map!.camera();
    const flatY = (u.y - u.x + window.__map!.width) * 16 - cam.y;
    return { drawn: window.__game!.unitScreenPos(id)!, flatY, body: window.__game!.objectScreenPos(id)! };
  }, villager);
  await page.mouse.click(box.x + placed.body.x, box.y + placed.body.y);
  await expect.poll(() => page.evaluate(() => window.__game!.selection())).toEqual([villager]);
  return { villager, hill: { col: hill!.col, row: hill!.row, height: hill!.height }, lift: placed.flatY - placed.drawn.y };
}
