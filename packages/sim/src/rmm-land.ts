/**
 * The land generator (`RGE_RMM_Land_Generator`, src/rmm_land.cpp; docs/spec/random-maps.md §5.2) and the land centres
 * it starts from (`RGE_RMM_Database_Controller::calc_land_start`, src/rmm_dbct.cpp:299; §4.1). Each land grows from a
 * square around its centre into the free tiles, one tile per land per round, until it has its size.
 */
import { f32 } from './num';
import type { CrtRand } from './rng';
import { MapStack, NONE } from './rmm-base';
import type { RmmMap } from './rmm-map';

/** `RGE_Land_Info_Line` (include/rmm_land.h). */
export interface LandLine {
  /** `land_size`: tiles to grow. */
  size: number;
  terrain: number;
  x: number;
  y: number;
  /** `base_size`: half side of the starting square. */
  baseSize: number;
  /** `area`: how far another land's tiles keep this one away. */
  area: number;
  zone: number;
  clumpiness: number;
  /** `wall_1..4_avoidance_line`: x, y, x, y. */
  walls: [number, number, number, number];
  /** `wall_fade`. */
  fade: number;
}

/** `RGE_Land_Info`: the lands and the terrain under them. */
export interface LandInfo {
  lands: LandLine[];
  baseTerrain: number;
}

/**
 * `calc_land_start(first, edge, count, entry)`: one logged draw, then the centres of lands `first .. first+count-1`
 * by the entry's placement type: 0 random, 1 the entry's point, 2 random outside the centre box and apart from the
 * earlier lands of this call. A point too close to the land just before it moves that land there (src/rmm_dbct.cpp:
 * 398-403).
 */
export function calcLandStart(
  rng: CrtRand,
  width: number,
  height: number,
  lands: { x: number; y: number }[],
  first: number,
  edge: number,
  count: number,
  placement: number,
  entryX: number,
  entryY: number,
): void {
  rng.rand();
  let radius = f32((width - edge * 2) / Math.sqrt(count));
  if (count > 3 && count < 7) radius = f32(radius * f32(0.9));
  else if (count >= 7) radius = f32(radius * f32(0.8));
  const bound = f32(radius * radius);
  let minX = Math.trunc(Math.trunc(width / 2) - radius * 0.9);
  let minY = Math.trunc(Math.trunc(height / 2) - radius * 0.9);
  let maxX = Math.trunc(Math.trunc(width / 2) + radius * 0.9);
  let maxY = Math.trunc(Math.trunc(height / 2) + radius * 0.9);
  if (minX <= edge) minX = edge + 1;
  if (minY <= edge) minY = edge + 1;
  if (maxX >= width - edge - 1) maxX = width - edge - 2;
  if (maxY >= height - edge - 1) maxY = height - edge - 2;
  const end = first + count;
  const randomX = () => Math.trunc((rng.rand() * (width - edge * 2)) / 0x7fff) + edge;
  const randomY = () => Math.trunc((rng.rand() * (height - edge * 2)) / 0x7fff) + edge;
  for (let i = first; i < end; i++) {
    if (placement === 0) {
      const x = randomX();
      lands[i]!.x = x;
      lands[i]!.y = randomY();
    } else if (placement === 1) {
      lands[i]!.x = entryX;
      lands[i]!.y = entryY;
    } else if (placement === 2) {
      let x: number;
      let y: number;
      let retry: boolean;
      do {
        retry = false;
        x = randomX();
        y = randomY();
        if (x > minX && x < maxX && y > minY && y < maxY) {
          retry = true;
        } else {
          for (let j = first; j < i; j++) {
            const dx = Math.abs(x - lands[j]!.x);
            const dy = Math.abs(y - lands[j]!.y);
            if (f32(dx * dx + dy * dy) <= bound) {
              if (j === i - 1) {
                lands[j]!.x = x;
                lands[j]!.y = y;
              }
              retry = true;
              break;
            }
          }
        }
      } while (retry);
      lands[i]!.x = x;
      lands[i]!.y = y;
    }
  }
}

/**
 * `chance(x, y, land)` (src/rmm_land.cpp:90, N): the percent chance a tile near the walls is refused. Ported as the
 * shipped code computes it (checked against Empiresx.exe 1.0a at 0x4710a0, which matches the decomp body): the y term
 * also carries the x distance plus the wall's own offset when that is positive.
 */
export function landChance(line: LandLine, width: number, x: number, y: number): number {
  const fade = line.fade & 0xff;
  if (fade === 0) return 0;
  const [wall1, wall2, wall3, wall4] = line.walls;
  let a = wall1 - x;
  let xpos = x - wall3;
  const xChance = Math.max(a, xpos);
  a += wall1;
  xpos += width - wall3;
  if (a <= xpos) a = xpos;
  let w2: number;
  if (a > 0) {
    w2 = wall2 + a - y;
    a = a - wall4 + y;
  } else {
    w2 = wall2 - y;
    a = y - wall4;
  }
  if (w2 > a) a = w2;
  a = (Math.max(xChance, 0) + Math.max(a, 0)) * fade;
  return a >= 100 ? 101 : a & 0xff;
}

/**
 * `check_terrain_and_zone(target, land, x, y)` (src/rmm_land.cpp:27, L): 0 when the tile is taken or another land's
 * zone is within `area`; else the land's own tiles in the 5x5 window, plus 5 per off-map row and 1 per off-map column
 * within two of the tile.
 */
export function checkTerrainAndZone(search: Uint8Array, width: number, height: number, info: LandInfo, land: number, x: number, y: number): number {
  const line = info.lands[land]!;
  const landNum = info.lands.length;
  const area = line.area;
  const zone = line.zone & 0xff;
  if (search[y * width + x] !== landNum) return 0;
  let count = 0;
  for (let row = y - area; row <= y + area; row++) {
    if (row < 0) {
      if (row > y - 2) count += 5;
    } else if (row < height) {
      for (let col = x - area; col <= x + area; col++) {
        if (col < 0) {
          if (col > x - 2) count++;
        } else if (col < width) {
          const state = search[row * width + col]!;
          if (state === zone) {
            if (row >= y - 2 && row <= y + 2 && col >= x - 2 && col <= x + 2) count++;
          } else if (state < landNum) {
            return 0;
          }
        } else if (col < x + 2) {
          count++;
        }
      }
    } else if (row < y + 2) {
      count += 5;
    }
  }
  return count & 0xff;
}

/**
 * `RGE_RMM_Land_Generator::generate` (src/rmm_land.cpp:17): the whole map becomes the base terrain, the lands grow,
 * then `clean_terrain` with the base terrain. Grown tiles are written straight to the terrain (5 bits, the height is
 * kept), without terrain objects.
 */
export function generateLand(m: RmmMap, stack: MapStack, search: Uint8Array, info: LandInfo): void {
  stack.clear();
  search.fill(info.lands.length & 0xff);
  m.setTerrainArea(null, 0, 0, m.w - 1, m.h - 1, info.baseTerrain, true, false);
  baseLandGenerate(m, stack, search, info);
  m.cleanTerrain(0, 0, m.w, m.h, info.baseTerrain);
}

/** `base_land_generate` (src/rmm_land.cpp:142, L). */
function baseLandGenerate(m: RmmMap, stack: MapStack, search: Uint8Array, info: LandInfo): void {
  const w = m.w;
  const h = m.h;
  const maxX = w - 1;
  const maxY = h - 1;
  const lands = info.lands;
  const landNum = lands.length;
  const free = landNum & 0xff;
  const grown = new Array<number>(Math.max(99, landNum)).fill(0);
  const heads: number[] = [];
  for (let i = 0; i < landNum; i++) {
    const line = lands[i]!;
    const head = stack.head();
    heads.push(head);
    grown[i] = 0;
    const x0 = Math.max(0, line.x - line.baseSize);
    const y0 = Math.max(0, line.y - line.baseSize);
    const x1 = Math.min(w - 1, line.x + line.baseSize);
    const y1 = Math.min(h - 1, line.y + line.baseSize);
    m.setTerrainArea(null, x0, y0, x1, y1, line.terrain & 0xff, true, false);
    const zone = line.zone & 0xff;
    // Quirk: the starting count goes to the zone's slot, not the land's (src/rmm_land.cpp:182-183).
    grown[zone] = (x1 - x0 + 1) * (y1 - y0 + 1);
    for (let row = y0; row <= y1; row++) for (let col = x0; col <= x1; col++) search[row * w + col] = zone;
    if (x0 > 0) for (let row = y0; row <= y1; row++) stack.push(head, x0 - 1, row, i, 0);
    if (y0 > 0) for (let col = x0; col <= x1; col++) stack.push(head, col, y0 - 1, i, 0);
    if (x1 < maxX) for (let row = y0; row <= y1; row++) stack.push(head, x1 + 1, row, i, 0);
    if (y1 < maxY) for (let col = x0; col <= x1; col++) stack.push(head, col, y1 + 1, i, 0);
  }
  const rng = m.rng;
  let done: boolean;
  do {
    done = true;
    for (let i = 0; i < landNum; i++) {
      const line = lands[i]!;
      const size = grown[i]!;
      if (size >= line.size) continue;
      const node = stack.pop(heads[i]!);
      if (node === NONE) continue;
      done = false;
      const x = node % w;
      const y = (node - x) / w;
      const chance = landChance(line, w, x, y);
      if (chance > Math.trunc((rng.rand() * 100) / 0x7fff)) {
        search[node] = 0xff;
        continue;
      }
      const count = checkTerrainAndZone(search, w, h, info, i, x, y);
      if (search[node] !== free || count === 0) continue;
      m.terrain[node] = line.terrain & 0x1f;
      search[node] = line.zone & 0xff;
      const grow = (nx: number, ny: number) => {
        const cost = Math.trunc((rng.rand() * 100) / 0x7fff) - count * line.clumpiness + 250;
        stack.push(heads[i]!, nx, ny, 0, cost);
      };
      if (x > 0 && search[node - 1] === free) grow(x - 1, y);
      if (x < maxX && search[node + 1] === free) grow(x + 1, y);
      if (y > 0 && search[node - w] === free) grow(x, y - 1);
      if (y < maxY && search[node + w] === free) grow(x, y + 1);
      grown[i] = size + 1;
    }
  } while (!done);
  // What is left on a land's list fills in where the land is on both sides.
  for (let i = 0; i < landNum; i++) {
    const zone = lands[i]!.zone & 0xff;
    for (let node = stack.pop(heads[i]!); node !== NONE; node = stack.pop(heads[i]!)) {
      const x = node % w;
      const y = (node - x) / w;
      if (
        (x > 0 && search[node - 1] === zone && x < maxX && search[node + 1] === zone) ||
        (y > 0 && search[node - w] === zone && y < maxY && search[node + w] === zone)
      ) {
        m.terrain[node] = lands[i]!.terrain & 0x1f;
      }
    }
  }
  for (const head of heads) stack.deinit(head);
}
