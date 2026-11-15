/**
 * The shallows generator (`RGE_RMM_Shallows_Generator`, src/rmm_shal.cpp; docs/spec/random-maps.md §5.3): shallow
 * fords across the water between every pair of land centres, and between two pairs of random land tiles.
 */
import { f32 } from './num';
import { findPath, MapStack, NONE } from './rmm-base';
import type { RmmMap } from './rmm-map';

const TERRAIN_WATER = 1;
const TERRAIN_SHALLOWS = 4;
const TERRAIN_WATER_DARK = 22;

/** `make_tribe_connections`' path costs per terrain (src/rmm_shal.cpp:115-120): 0 is impassable. */
const PATH_COSTS: readonly number[] = (() => {
  const costs = new Array<number>(40).fill(0);
  costs[0] = 1;
  costs[TERRAIN_WATER] = 7;
  costs[2] = 1;
  costs[TERRAIN_SHALLOWS] = 2;
  costs[TERRAIN_WATER_DARK] = 14;
  return costs.map(f32);
})();

function isOpenWater(terrain: number): boolean {
  return terrain === TERRAIN_WATER || terrain === TERRAIN_WATER_DARK;
}

/**
 * `RGE_RMM_Shallows_Generator::generate` (src/rmm_shal.cpp:17): connect each pair of points (the land centres), then
 * twice draw two land tiles (not water, shallows or deep water) and connect them.
 */
export function generateShallows(m: RmmMap, stack: MapStack, search: Uint8Array, points: readonly (readonly [number, number])[]): void {
  stack.clear();
  const shallows = points.map(([x, y]) => [x, y] as [number, number]);
  for (let i = 0; i < shallows.length; i++) {
    for (let j = i + 1; j < shallows.length; j++) makeTribeConnections(m, stack, search, shallows[i]!, shallows[j]!);
  }
  const randomLand = (): [number, number] => {
    for (;;) {
      const x = Math.trunc((m.rng.rand() * (m.w - 1)) / 0x7fff);
      const y = Math.trunc((m.rng.rand() * (m.h - 1)) / 0x7fff);
      const terrain = m.terrain[y * m.w + x]!;
      if (terrain !== TERRAIN_WATER && terrain !== TERRAIN_WATER_DARK && terrain !== TERRAIN_SHALLOWS) return [x, y];
    }
  };
  for (let count = 2; count > 0; count--) {
    // The original stores the first pick at index n+1 and the second at n, then connects n+1 to n.
    const from = randomLand();
    const to = randomLand();
    makeTribeConnections(m, stack, search, from, to);
  }
}

/**
 * `make_tribe_connections(point1, point2)` (src/rmm_shal.cpp:65, L): find a path, walk it back from the target, and
 * queue the water around each path tile: a random box (4 draws) around a water tile, the water 4-neighbours of a land
 * tile. The target tile itself is not walked. Every queued tile becomes shallows, written straight to the terrain.
 */
export function makeTribeConnections(
  m: RmmMap,
  stack: MapStack,
  search: Uint8Array,
  start: readonly [number, number],
  target: readonly [number, number],
): void {
  const w = m.w;
  const h = m.h;
  const terrainAt = (x: number, y: number) => m.terrain[y * w + x]!;
  const pathHead = stack.head();
  const end = findPath(stack, search, terrainAt, pathHead, start[0], start[1], target[0], target[1], PATH_COSTS);
  stack.deinit(pathHead);
  let [tx, ty] = end ?? target;
  if (tx !== target[0] || ty !== target[1]) return;
  let x = tx;
  let y = ty;
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  const head = stack.head();
  const rng = m.rng;
  for (;;) {
    let done = false;
    switch (search[ty * w + tx]) {
      case 4:
        x++;
        break;
      case 5:
        x--;
        break;
      case 6:
        y++;
        break;
      case 7:
        y--;
        break;
      case 8:
        y++;
        x++;
        break;
      case 9:
        y--;
        x++;
        break;
      case 10:
        y++;
        x--;
        break;
      case 11:
        y--;
        x--;
        break;
      default:
        done = true;
    }
    if (x < 0 || x >= w || y < 0 || y >= h) done = true;
    if (done) break;
    if (isOpenWater(terrainAt(x, y))) {
      const minX = Math.max(0, x - Math.trunc((rng.rand() * 2) / 0x7fff) - 1);
      const minY = Math.max(0, y - Math.trunc((rng.rand() * 2) / 0x7fff) - 1);
      const maxX = Math.min(w - 1, x + Math.trunc((rng.rand() * 2) / 0x7fff) + 1);
      const maxY = Math.min(h - 1, y + Math.trunc((rng.rand() * 3) / 0x7fff) + 1);
      for (let fy = minY; fy <= maxY; fy++) {
        for (let fx = minX; fx <= maxX; fx++) if (isOpenWater(terrainAt(fx, fy))) stack.push(head, fx, fy, 0, 0);
      }
    } else {
      if (x > 0 && isOpenWater(terrainAt(x - 1, y))) stack.push(head, x - 1, y, 0, 0);
      if (x < w - 1 && isOpenWater(terrainAt(x + 1, y))) stack.push(head, x + 1, y, 0, 0);
      if (y > 0 && isOpenWater(terrainAt(x, y - 1))) stack.push(head, x, y - 1, 0, 0);
      if (y < h - 1 && isOpenWater(terrainAt(x, y + 1))) stack.push(head, x, y + 1, 0, 0);
    }
    search[ty * w + tx] = 0xff;
    tx = x;
    ty = y;
  }
  for (let node = stack.pop(head); node !== NONE; node = stack.pop(head)) m.terrain[node] = TERRAIN_SHALLOWS;
  stack.deinit(head);
}
