/**
 * The elevation generator (`RGE_RMM_Elevation_Generator`, src/rmm_elev.cpp; docs/spec/random-maps.md §5.4): hills
 * grown level by level on grass, kept away from the hot spots (the land centres), each level smoothed by
 * `clean_elevation`.
 */
import { f32 } from './num';
import { MapStack, NONE } from './rmm-base';
import type { RmmMap } from './rmm-map';
import { hotSpotModifiers, type HotSpot } from './rmm-terrain';

/** The elevation generator's `generate_modifiers` (src/rmm_elev.cpp:197) is the terrain generator's computation. */
export type { HotSpot };

/** `RGE_Elevation_Info_Line` (include/rmm_elev.h). */
export interface ElevationLine {
  /** `elevation_size`: tiles to raise. */
  size: number;
  /** `elevation`: the height raised to. */
  height: number;
  clumps: number;
  spacing: number;
  /** `base_elevation`: the height raised from. */
  baseHeight: number;
  /** `base_terrain_type`: the only terrain raised. */
  baseTerrain: number;
}

export interface ElevationInfo {
  levels: ElevationLine[];
  hotSpots: HotSpot[];
}

/**
 * `RGE_RMM_Elevation_Generator::generate` (src/rmm_elev.cpp:18, L): every height to the first level's base, the
 * modifiers, then per level `base_elevation_generate` and `clean_elevation(0, 0, W-1, H-1, 8)`.
 */
export function generateElevation(m: RmmMap, stack: MapStack, search: Uint8Array, info: ElevationInfo): void {
  stack.clear();
  if (info.levels.length > 0) m.height.fill(info.levels[0]!.baseHeight & 7);
  hotSpotModifiers(search, m.w, m.h, info.hotSpots);
  for (const level of info.levels) {
    baseElevationGenerate(m, stack, search, level);
    m.cleanElevation(0, 0, m.w - 1, m.h - 1, 8);
  }
}

/**
 * `link_stack_randomly` (src/rmm_elev.cpp:262, N; matches Empiresx.exe 1.0a 0x470810): chain every tile node in order
 * with the first node's back link on `head` but `head` itself left empty, then move W*H/16 random tiles to the head.
 * Only those reach the list, unless tile (0, 0) is drawn: unlinking it relinks `head` to the rest of the chain.
 */
export function linkStackRandomly(m: RmmMap, stack: MapStack, head: number): void {
  const n = m.w * m.h;
  for (let i = 0; i < n; i++) {
    stack.prev[i] = i === 0 ? head : i - 1;
    stack.next[i] = i === n - 1 ? NONE : i + 1;
  }
  for (let count = Math.trunc(n / 16); count > 0; count--) {
    const x = Math.trunc((m.rng.rand() * (m.w - 1)) / 0x7fff);
    const y = Math.trunc((m.rng.rand() * (m.h - 1)) / 0x7fff);
    stack.add(head, stack.node(x, y));
  }
}

/** `check_start_elevation` (src/rmm_elev.cpp:54, N; matches the exe at 0x470480): the clamped square is all base. */
function checkStartElevation(m: RmmMap, x: number, y: number, baseTerrain: number, baseHeight: number, spacing: number): boolean {
  const x0 = Math.max(0, x - spacing);
  const y0 = Math.max(0, y - spacing);
  const x1 = Math.min(m.w - 1, x + spacing);
  const y1 = Math.min(m.h - 1, y + spacing);
  for (let row = y0; row <= y1; row++) {
    for (let col = x0; col <= x1; col++) {
      const i = row * m.w + col;
      if (baseTerrain === 0xff || m.terrain[i] !== baseTerrain || m.height[i]! < baseHeight) return false;
    }
  }
  return true;
}

/**
 * `check_elevation` (src/rmm_elev.cpp:102, N): 0 when the clamped spacing square has a tile that is not base; else the
 * tiles of the target height in the clamped 5x5 window.
 */
function checkElevation(m: RmmMap, target: number, x: number, y: number, spacing: number, baseTerrain: number, baseHeight: number): number {
  if (spacing > 0 && !checkStartElevation(m, x, y, baseTerrain, baseHeight, spacing)) return 0;
  let count = 0;
  for (let row = Math.max(0, y - 2); row <= Math.min(m.h - 1, y + 2); row++) {
    for (let col = Math.max(0, x - 2); col <= Math.min(m.w - 1, x + 2); col++) if (m.height[row * m.w + col] === target) count++;
  }
  return count & 0xff;
}

/**
 * `remove_area_from_lists` (src/rmm_elev.cpp:290, M). Bug kept: the row loop runs from the clamped top row to the
 * clamped right column, so it removes rows y-s .. x+s. Rows below the map (reachable only on a map wider than tall;
 * the game's maps are square) are skipped.
 */
function removeAreaFromLists(m: RmmMap, stack: MapStack, x: number, y: number, spacing: number): void {
  const startX = Math.max(0, x - spacing);
  const startY = Math.max(0, y - spacing);
  const maxX = Math.min(m.w - 1, x + spacing);
  for (let row = startY; row <= maxX && row < m.h; row++) {
    for (let col = startX; col <= maxX; col++) stack.remove(stack.node(col, row));
  }
}

/** `base_elevation_generate` (src/rmm_elev.cpp:318, L): seed `clumps` hills, then grow them round-robin to `size`. */
function baseElevationGenerate(m: RmmMap, stack: MapStack, search: Uint8Array, level: ElevationLine): void {
  const w = m.w;
  const maxX = w - 1;
  const maxY = m.h - 1;
  const rng = m.rng;
  const target = level.height & 0xff;
  const base = level.baseHeight;
  const baseTerrain = level.baseTerrain & 0xff;
  const heads: number[] = [];
  for (let i = 0; i < level.clumps; i++) heads.push(stack.head());
  const loc = stack.head();
  linkStackRandomly(m, stack, loc);
  const area = Math.max(2, Math.trunc(Math.trunc(Math.sqrt(level.size / level.clumps)) / 2));
  let raised = 0;
  let clump = 0;
  while (clump < level.clumps) {
    const node = stack.pop(loc);
    if (node === NONE) break;
    const x = node % w;
    const y = (node - x) / w;
    if (search[node] !== 0 || !checkStartElevation(m, x, y, baseTerrain, base & 0xff, level.spacing & 0xff)) continue;
    removeAreaFromLists(m, stack, x, y, area);
    m.setHeight(node, target);
    const head = heads[clump]!;
    if (x > 0) stack.push(head, x - 1, y, 0, 0);
    if (y > 0) stack.push(head, x, y - 1, 0, 0);
    if (x < maxX) stack.push(head, x + 1, y, 0, 0);
    if (y < maxY) stack.push(head, x, y + 1, 0, 0);
    raised++;
    clump++;
  }
  let done: boolean;
  do {
    done = true;
    for (let i = 0; i < level.clumps; i++) {
      if (raised >= level.size) continue;
      const node = stack.pop(heads[i]!);
      if (node === NONE) continue;
      done = false;
      const x = node % w;
      const y = (node - x) / w;
      if (search[node]! > Math.trunc((rng.rand() * 100) / 0x7fff)) {
        search[node] = 101;
        continue;
      }
      const count = checkElevation(m, target, x, y, level.spacing, baseTerrain, base & 0xff);
      if (m.height[node] !== base || count === 0) continue;
      const chance = f32(250 - count * 15);
      m.setHeight(node, target);
      const grow = (nx: number, ny: number) => {
        stack.push(heads[i]!, nx, ny, 0, f32(Math.trunc((rng.rand() * 100) / 0x7fff) + chance));
      };
      if (x > 0 && m.height[node - 1] === base) grow(x - 1, y);
      if (x < maxX && m.height[node + 1] === base) grow(x + 1, y);
      if (y > 0 && m.height[node - w] === base) grow(x, y - 1);
      if (y < maxY && m.height[node + w] === base) grow(x, y + 1);
      raised++;
    }
  } while (!done);
  for (const head of heads) stack.deinit(head);
}
