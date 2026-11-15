/**
 * The random map terrain module (`RGE_RMM_Terrain_Generator`, src/rmm_terr.cpp; docs/spec/random-maps.md §5.7):
 * per terrain row, seed clumps on the row's base terrain away from the hot spots, grow them by a priority list, fill
 * horizontal one-tile gaps; then every land tile next to water becomes beach.
 *
 * The original's terrain writes here go to the 5-bit `terrain_type` field of `RGE_Tile` (include/map.h:32), so the
 * tile's height bits are kept; `RmmMap` keeps height apart, so a plain write to `terrain` is the same. These writes
 * bypass `set_terrain`: no terrain objects are made here (the object module makes them).
 */
import { MapStack, NONE } from './rmm-base';
import type { RmmMap } from './rmm-map';
import { isWater, type ZoneMap } from './rmm-map';
import { f32 } from './num';

const TERRAIN_BEACH = 2;
/** The grow cost base (`fig_chance`, src/rmm_terr.cpp). */
const GROW_COST = 250;
/** `base_terrain_generate`'s fixed stack array: at most this many clumps per row. */
const MAX_CLUMPS = 99;
/** Fairness seeds (avoid 2) accept a modifier below this. */
const FAIR_MODIFIER = 30;

/** One `RGE_Terrain_Info_Line`. */
export interface TerrainRow {
  /** `terrain_size`: tiles to grow (seeds included). */
  size: number;
  terrain: number;
  clumps: number;
  /** `spacing`: half-size of the square that must be base, its impassable twin or this terrain. */
  spacing: number;
  /** `base_terrain_type`: the terrain this row paints over. */
  base: number;
  clumpiness: number;
  /** `avoid_hot_spots`: 0 ignore, 1 avoid, 2 avoid and seed one clump in each hot spot's zone. */
  avoid: number;
}

/** One `RGE_Terrain_Hot_Spots`. */
export interface HotSpot {
  x: number;
  y: number;
  radius: number;
  fade: number;
}

/** `RGE_Terrain_Info`. */
export interface TerrainInfo {
  rows: TerrainRow[];
  hotSpots: HotSpot[];
}

/**
 * `generate_modifiers` (shared with the elevation module, src/rmm_terr.cpp, src/rmm_elev.cpp): per tile the sum of
 * `fade × (radius − trunc(distance))` over the hot spots it is inside, 101 when above 100.
 */
export function hotSpotModifiers(search: Uint8Array, w: number, h: number, hotSpots: readonly HotSpot[]): void {
  search.fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let modifier = 0;
      for (const s of hotSpots) {
        const dx = x - s.x;
        const dy = y - s.y;
        const contribution = s.radius - Math.trunc(Math.sqrt(dx * dx + dy * dy));
        if (contribution > 0) modifier += s.fade * contribution;
      }
      search[y * w + x] = modifier > 100 ? 101 : modifier;
    }
  }
}

export class TerrainGenerator {
  private readonly w: number;
  private readonly h: number;
  private zones!: ZoneMap;

  /** The module copies its info at construction (`this->info = *in_info`). */
  private readonly info: TerrainInfo;

  constructor(
    private readonly map: RmmMap,
    private readonly stack: MapStack,
    private readonly search: Uint8Array,
    info: TerrainInfo,
  ) {
    this.w = map.w;
    this.h = map.h;
    this.info = { rows: info.rows.map((r) => ({ ...r })), hotSpots: info.hotSpots.map((s) => ({ ...s })) };
  }

  /** `generate` (src/rmm_terr.cpp:24): modifiers, the grass/other zone map, each row in order, then beaches. */
  generate(): void {
    hotSpotModifiers(this.search, this.w, this.h, this.info.hotSpots);
    this.zones = this.map.terrainZoneMap();
    for (const row of this.info.rows) this.generateRow(row);
    this.checkBorders();
  }

  private terrainAt(x: number, y: number): number {
    return this.map.terrain[y * this.w + x]!;
  }

  /** `check_borders` (src/rmm_terr.cpp:65): a land tile with water among its 8 neighbours becomes beach. */
  checkBorders(): void {
    const { w, h } = this;
    const water = (x: number, y: number) => isWater(this.terrainAt(x, y));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (water(x, y)) continue;
        let border = (y > 0 && water(x, y - 1)) || (y < h - 1 && water(x, y + 1));
        for (const nx of [x - 1, x + 1]) {
          if (nx < 0 || nx >= w) continue;
          if (water(nx, y) || (y > 0 && water(nx, y - 1)) || (y < h - 1 && water(nx, y + 1))) border = true;
        }
        if (border) this.map.terrain[y * w + x] = TERRAIN_BEACH;
      }
    }
  }

  /**
   * `check_terrain` (src/rmm_terr.cpp:112, N): 0 when a tile of the clipped `spacing` square is not the base terrain,
   * its impassable twin or the target; else 1 plus the target tiles in the clipped 5×5 around (x, y).
   */
  checkTerrain(target: number, x: number, y: number, spacing: number, base: number): number {
    const twin = this.map.impassableTwin(base);
    if (spacing > 0) {
      const [x0, y0, x1, y1] = this.clip(x, y, spacing);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const t = this.terrainAt(tx, ty);
          if (t !== base && t !== twin && t !== target) return 0;
        }
      }
    }
    let count = 1;
    const [x0, y0, x1, y1] = this.clip(x, y, 2);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.terrainAt(tx, ty) === target) count++;
    return count;
  }

  private clip(x: number, y: number, r: number): [number, number, number, number] {
    return [Math.max(0, x - r), Math.max(0, y - r), Math.min(this.w - 1, x + r), Math.min(this.h - 1, y + r)];
  }

  /** `link_stack_randomly` (src/rmm_terr.cpp:259): every tile in row order, then `W·H/8` random tiles to the front. */
  private linkRandomly(head: number): void {
    const { stack, w, h } = this;
    const n = w * h;
    for (let i = 0; i < n; i++) {
      stack.next[i] = i + 1 < n ? i + 1 : NONE;
      stack.prev[i] = i > 0 ? i - 1 : head;
    }
    stack.next[head] = 0;
    const rng = this.map.rng;
    for (let k = Math.trunc(n / 8); k > 0; k--) {
      const x = Math.trunc((rng.rand() * (w - 1)) / 0x7fff);
      const y = Math.trunc((rng.rand() * (h - 1)) / 0x7fff);
      stack.add(head, stack.node(x, y));
    }
  }

  /** `remove_area_from_lists`: unlink the clipped square around (x, y) from whatever list holds it. */
  private removeArea(x: number, y: number, r: number): void {
    const [x0, y0, x1, y1] = this.clip(x, y, r);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) this.stack.remove(this.stack.node(tx, ty));
  }

  /** Paint a clump's seed and queue its 4 neighbours (left, up, right, down) at cost 0. */
  private seed(head: number, x: number, y: number, row: TerrainRow, baseArea: number): void {
    this.removeArea(x, y, baseArea);
    this.map.terrain[y * this.w + x] = row.terrain;
    if (x > 0) this.stack.push(head, x - 1, y, 0, 0);
    if (y > 0) this.stack.push(head, x, y - 1, 0, 0);
    if (x < this.w - 1) this.stack.push(head, x + 1, y, 0, 0);
    if (y < this.h - 1) this.stack.push(head, x, y + 1, 0, 0);
  }

  /** `base_terrain_generate` (src/rmm_terr.cpp:328): one row's clumps. */
  private generateRow(row: TerrainRow): void {
    const { stack, w, h, search } = this;
    const rng = this.map.rng;
    const hot = this.info.hotSpots;
    const fairZones: number[] = [];
    const visited: boolean[] = [];
    let visitedCount = 0;
    if (row.avoid === 2) {
      for (const s of hot) {
        fairZones.push(this.zones.at(w, s.x, s.y));
        visited.push(false);
      }
    }
    const heads = Array.from({ length: MAX_CLUMPS }, () => stack.head());
    const loc = stack.head();
    this.linkRandomly(loc);
    let baseArea = 2 * Math.trunc(Math.sqrt(row.size / row.clumps));
    if (!(baseArea >= 2)) baseArea = 2;

    const popXY = (head: number): [number, number] | null => {
      const node = stack.pop(head);
      return node === NONE ? null : [node % w, Math.trunc(node / w)];
    };
    const fits = (x: number, y: number) =>
      this.terrainAt(x, y) === row.base && this.checkTerrain(row.terrain, x, y, row.spacing, row.base) > 0;

    let clumps = 0;
    let grown = 0;
    while (clumps < row.clumps) {
      const p = popXY(loc);
      if (!p) break;
      const [x, y] = p;
      if (!fits(x, y) || (row.avoid !== 0 && search[y * w + x] !== 0)) continue;
      this.seed(heads[clumps]!, x, y, row, baseArea);
      grown++;
      clumps++;
      if (row.avoid === 2) {
        const zone = this.zones.at(w, x, y);
        for (let i = 0; i < hot.length; i++) {
          if (fairZones[i] === zone && !visited[i]) {
            visited[i] = true;
            visitedCount++;
          }
        }
      }
    }
    // Fairness (avoid 2): one more clump in each hot spot's zone that has none yet.
    if (row.avoid === 2) {
      while (visitedCount < hot.length) {
        const p = popXY(loc);
        if (!p) break;
        const [x, y] = p;
        if (!fits(x, y) || !(search[y * w + x]! < FAIR_MODIFIER)) continue;
        const zone = this.zones.at(w, x, y);
        const i = fairZones.findIndex((z, k) => z === zone && !visited[k]);
        if (i === -1) continue;
        visitedCount++;
        visited[i] = true;
        this.seed(heads[clumps]!, x, y, row, baseArea);
        grown++;
        clumps++;
      }
    }

    // Growth: each clump in turn takes its cheapest tile until the row's size is reached or every list is empty.
    let done: boolean;
    do {
      done = true;
      for (let k = 0; k < clumps; k++) {
        if (!(grown < row.size)) continue;
        const p = popXY(heads[k]!);
        if (!p) continue;
        done = false;
        const [x, y] = p;
        const i = y * w + x;
        if (row.avoid !== 0 && !(search[i]! <= Math.trunc((rng.rand() * 100) / 0x7fff))) continue;
        const count = this.checkTerrain(row.terrain, x, y, row.spacing, row.base);
        if (this.terrainAt(x, y) !== row.base || !(count > 0)) continue;
        let score = f32(GROW_COST - row.clumpiness * count);
        if (row.avoid !== 0) score = f32(score + search[i]!);
        this.map.terrain[i] = row.terrain;
        const grow = (nx: number, ny: number) => {
          const r = Math.trunc((rng.rand() * 100) / 0x7fff);
          stack.push(heads[k]!, nx, ny, 0, f32(r + score));
        };
        if (x > 0 && this.terrainAt(x - 1, y) === row.base) grow(x - 1, y);
        if (x < w - 1 && this.terrainAt(x + 1, y) === row.base) grow(x + 1, y);
        if (y > 0 && this.terrainAt(x, y - 1) === row.base) grow(x, y - 1);
        if (y < h - 1 && this.terrainAt(x, y + 1) === row.base) grow(x, y + 1);
        grown++;
      }
    } while (!done);

    // Leftovers of the first `clumps` lists fill one-tile gaps. The vertical test compares `y > h − 1`, never true,
    // so only gaps between a left and a right neighbour fill (src/rmm_terr.cpp, the last loop).
    for (let k = 0; k < row.clumps && k < MAX_CLUMPS; k++) {
      for (let p = popXY(heads[k]!); p; p = popXY(heads[k]!)) {
        const [x, y] = p;
        if (x > 0 && x < w - 1 && this.terrainAt(x - 1, y) === row.terrain && this.terrainAt(x + 1, y) === row.terrain) {
          this.map.terrain[y * w + x] = row.terrain;
        }
      }
    }
    for (const head of heads) stack.deinit(head);
  }
}
