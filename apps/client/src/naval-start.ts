import { checkPlacement, master, TOWN_CENTER, type World } from '@aoe/sim';
import { alignBuilding } from './units/placement';

// Master ids (empires.dat): the Dock, the Transport Boat and the Trade Boat (docs/spec/naval.md §3, §7.1).
export const DOCK = 45;
export const TRANSPORT_BOAT = 17;
export const TRADE_BOAT = 15;
/** How far from the Town Center the Dock is looked for, in tiles. */
const SEARCH = 40;

/** Tiles at Chebyshev distance `d` from (col, row), row by row: the same order on every client. */
function* ring(col: number, row: number, d: number): Generator<[number, number]> {
  for (let y = row - d; y <= row + d; y++) {
    for (let x = col - d; x <= col + d; x++) if (d === 0 || Math.abs(x - col) === d || Math.abs(y - row) === d) yield [x, y];
  }
}

/**
 * Debug only (`?debug=net&naval=1`): each player gets a built Dock on the shore nearest its Town Center where the Dock
 * may stand (`checkPlacement`, as the build command checks it), then a Transport Boat and a Trade Boat on open water
 * near it, so an e2e can board, unload and trade without training them first. Both clients must ask for it.
 */
export function placeNavalStart(world: World): void {
  const ctx = world.gameContext();
  const { width, height } = world.map;
  for (let p = 1; p < world.players; p++) {
    const tc = [...world.entities.ofPlayer(p)].find((e) => e.type === TOWN_CENTER);
    if (!tc) continue;
    const dock = master(world, p, DOCK);
    let site: { x: number; y: number } | null = null;
    for (let d = 1; d <= SEARCH && !site; d++) {
      for (const [col, row] of ring(Math.floor(tc.x), Math.floor(tc.y), d)) {
        const at = alignBuilding(dock.radiusX, dock.radiusY, col + 0.5, row + 0.5, width, height);
        if (checkPlacement(ctx, dock, at.x, at.y, true, true) !== 0) continue;
        site = at;
        break;
      }
    }
    if (!site) continue;
    world.createUnit({ owner: p, type: DOCK, x: site.x, y: site.y });
    const taken: { x: number; y: number }[] = [site];
    for (const type of [TRANSPORT_BOAT, TRADE_BOAT]) {
      const t = master(world, p, type);
      // Open water: the tile and its eight neighbours are the boat's terrain, 3 tiles from the Dock and the other boat.
      const open = (col: number, row: number) => {
        for (const [x, y] of [...ring(col, row, 0), ...ring(col, row, 1)]) {
          if (x < 0 || y < 0 || x >= width || y >= height || !((t.terrainTable[world.map.terrainAt(x, y)] ?? 0) > 0)) return false;
        }
        return taken.every((o) => Math.max(Math.abs(o.x - col - 0.5), Math.abs(o.y - row - 0.5)) >= 3);
      };
      let spot: { x: number; y: number } | null = null;
      for (let d = 2; d <= 8 && !spot; d++) {
        for (const [col, row] of ring(Math.floor(site.x), Math.floor(site.y), d)) {
          if (!open(col, row)) continue;
          spot = { x: col + 0.5, y: row + 0.5 };
          break;
        }
      }
      if (!spot) continue;
      world.createUnit({ owner: p, type, x: spot.x, y: spot.y });
      taken.push(spot);
    }
  }
}
