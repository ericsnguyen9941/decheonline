/**
 * The cliffs generator (`RGE_RMM_Cliffs_Generator`, src/rmm_clif.cpp, all M; docs/spec/random-maps.md §5.5): random
 * walks over a grid of 3x3-tile cells of flat grass or desert, each painted as impassable grass with cliff pieces
 * along it by the TRIBE map's terrain and cliff brushes.
 */
import { MapStack, NONE } from './rmm-base';
import { TERRAIN_CLIFF, type RmmMap } from './rmm-map';

/** `RGE_Cliffs_Info` (include/rmm_clif.h). */
export interface CliffsInfo {
  count: number;
  /** `number_of_cliffs_variance`: set by the controller, never read. */
  countVariance: number;
  averageSize: number;
  sizeVariance: number;
  /** `cliff_terrain_spacing`: cells kept clear of water. */
  terrainSpacing: number;
  /** `cliff_to_cliff_spacing`. */
  cliffSpacing: number;
  hotSpots: { x: number; y: number; radius: number }[];
}

/** The generator's state across its cliffs: the shuffled list of valid cells. */
interface Cliffs {
  m: RmmMap;
  stack: MapStack;
  search: Uint8Array;
  info: CliffsInfo;
  sites: number;
}

/** `RGE_RMM_Cliffs_Generator::generate` (src/rmm_clif.cpp:15): set up the cells, one logged draw, then each cliff. */
export function generateCliffs(m: RmmMap, stack: MapStack, search: Uint8Array, info: CliffsInfo): void {
  const c: Cliffs = { m, stack, search, info, sites: stack.head() };
  setupCliffMaps(c);
  m.rng.rand();
  for (let i = 0; i < info.count; i++) generateCliff(c);
}

/**
 * `setup_cliff_maps` (src/rmm_clif.cpp:30): a cell whose 9 tiles are grass or desert at one height is a site, marked
 * height + 1 in the search map (indexed by cell, with the tile row stride); a cell with water clears the cells within
 * the terrain spacing. Cells near hot spots and sites with no site beside them are dropped, then the list is shuffled.
 */
function setupCliffMaps(c: Cliffs): void {
  const { m, stack, search } = c;
  const w = m.w;
  const cellsW = Math.trunc(m.w / 3);
  const cellsH = Math.trunc(m.h / 3);
  stack.clear();
  search.fill(1);
  for (let cy = 0; cy < cellsH; cy++) {
    for (let cx = 0; cx < cellsW; cx++) {
      let height = -1;
      let valid = true;
      let water = false;
      for (let ty = cy * 3; ty < cy * 3 + 3; ty++) {
        for (let tx = cx * 3; tx < cx * 3 + 3; tx++) {
          const terrain = m.terrain[ty * w + tx]!;
          if (terrain === 0 || terrain === 6) {
            const h = m.height[ty * w + tx]!;
            if (height < 0) height = h;
            else if (height !== h) valid = false;
          } else {
            valid = false;
            if (terrain === 1 || terrain === 4 || terrain === 22) water = true;
          }
        }
      }
      if (valid) {
        if (search[cy * w + cx] !== 0) {
          search[cy * w + cx] = height + 1;
          stack.push(c.sites, cx, cy, 0, 0);
        }
      } else {
        if (water) invalidateCliffArea(c, cx, cy, c.info.terrainSpacing);
        search[cy * w + cx] = 0;
      }
    }
  }
  for (const spot of c.info.hotSpots) {
    invalidateCliffArea(c, Math.trunc(spot.x / 3), Math.trunc(spot.y / 3), Math.trunc(spot.radius / 3) + 2);
  }
  for (let y = 0; y < cellsH; y++) {
    for (let x = 0; x < cellsW; x++) {
      const i = y * w + x;
      if (
        search[i] !== 0 &&
        (y <= 0 || search[i - w] === 0) &&
        (x <= 0 || search[i - 1] === 0) &&
        (y >= cellsH - 1 || search[i + w] === 0) &&
        (x >= cellsW - 1 || search[i + 1] === 0)
      ) {
        search[i] = 0;
        stack.remove(i);
      }
    }
  }
  stack.randomize(c.sites, m.rng);
}

/**
 * `generate_cliff` (src/rmm_clif.cpp:136): draw the length, take the next live site, draw a direction and walk from
 * cell to cell of the same height, turning at random; then paint it from the last cell back to the first.
 */
function generateCliff(c: Cliffs): void {
  const { m, stack, search, info } = c;
  const w = m.w;
  const rng = m.rng;
  const variance = info.sizeVariance;
  const cost = Math.trunc((rng.rand() * variance * 2) / 0x7fff) + info.averageSize - variance;
  if (stack.next[c.sites] === NONE || cost < 3) return;
  const cliff = stack.head();
  let node: number;
  for (;;) {
    node = stack.pop(c.sites);
    if (search[node] !== 0) break;
    if (stack.next[c.sites] === NONE) return;
  }
  const at = { x: node % w, y: (node - (node % w)) / w };
  const valid = search[node]!;
  stack.push(cliff, at.x, at.y, 0, 0);
  search[node] = 0;
  let direction = Math.trunc((rng.rand() * 4) / 0x7fff);
  let first = true;
  for (let size = 0; size < cost; size++) {
    const turn = Math.trunc((rng.rand() * 100) / 0x7fff);
    if (turn < 18) direction = direction <= 0 ? 3 : direction - 1;
    else if (turn < 36) direction = direction >= 3 ? 0 : direction + 1;
    const step =
      checkForValidCliffSite(c, direction, at, valid) ||
      checkForValidCliffSite(c, direction + 1, at, valid) ||
      checkForValidCliffSite(c, direction - 1, at, valid) ||
      (first && checkForValidCliffSite(c, direction - 2, at, valid));
    first = false;
    if (!step) break;
    stack.push(cliff, at.x, at.y, 0, 0);
    search[at.y * w + at.x] = 0;
  }
  let x = -1;
  let y = -1;
  for (let n = stack.pop(cliff); n !== NONE; n = stack.pop(cliff)) {
    const cx = n % w;
    const cy = (n - cx) / w;
    if (x === -1) {
      x = cx;
      y = cy;
    }
    m.terrainBrushStroke(x * 3 + 1, y * 3 + 1, cx * 3 + 1, cy * 3 + 1, 1, TERRAIN_CLIFF);
    m.cliffBrushStroke(x * 3 + 1, y * 3 + 1, cx * 3 + 1, cy * 3 + 1);
    x = cx;
    y = cy;
    invalidateCliffArea(c, cx, cy, info.cliffSpacing);
  }
}

/** `check_for_valid_cliff_site`'s direction wrap (src/rmm_clif.cpp:242-249): by 3, not 4, so 4 is 1 and -1 is 2. */
export function wrapCliffDirection(direction: number): number {
  if (direction > 3) {
    let count = Math.trunc((direction - 1) / 3);
    do {
      direction -= 3;
      count--;
    } while (count !== 0);
  }
  if (direction < 0) direction = Math.trunc((2 - direction) / 3) * 3 + direction;
  return direction;
}

/**
 * `check_for_valid_cliff_site(direction, x, y, valid)` (src/rmm_clif.cpp:235): step one cell (0 up, 1 right, 2 down,
 * 3 left) if that cell is a site of the walk's height.
 */
function checkForValidCliffSite(c: Cliffs, direction: number, at: { x: number; y: number }, valid: number): boolean {
  direction = wrapCliffDirection(direction);
  let { x, y } = at;
  switch (direction) {
    case 0:
      if (y <= 0) return false;
      y--;
      break;
    case 1:
      if (x >= Math.trunc(c.m.w / 3) - 1) return false;
      x++;
      break;
    case 2:
      if (y >= Math.trunc(c.m.h / 3) - 1) return false;
      y++;
      break;
    case 3:
      if (x <= 0) return false;
      x--;
      break;
  }
  if (c.search[y * c.m.w + x] !== (valid & 0xff)) return false;
  at.x = x;
  at.y = y;
  return true;
}

/**
 * `invalidate_cliff_area` (src/rmm_clif.cpp:283): clear the cells within `radius`. Bug kept: the bottom row is
 * clamped only when the clamped right column is past the last cell row, which on a square map never happens, so rows
 * below the cell grid (still 1 from the fill, read by nothing) are cleared too.
 */
function invalidateCliffArea(c: Cliffs, x: number, y: number, radius: number): void {
  const w = c.m.w;
  const lastCol = Math.trunc(c.m.w / 3) - 1;
  const lastRow = Math.trunc(c.m.h / 3) - 1;
  const x1 = Math.max(0, x - radius);
  const minY = Math.max(0, y - radius);
  const maxX = Math.min(lastCol, x + radius);
  let maxY = y + radius;
  if (maxX > lastRow) maxY = lastRow;
  for (let row = minY; row <= maxY && row < c.m.h; row++) {
    for (let col = x1; col <= maxX; col++) {
      const i = row * w + col;
      if (c.search[i] !== 0) {
        c.search[i] = 0;
        c.stack.remove(i);
      }
    }
  }
}
