/**
 * `RGE_Zone_Map` and `RGE_Zone_Map_List` (src/zone_map.cpp; docs/spec/movement.md §10, docs/spec/naval.md §2): the map's
 * 4-connected areas of tiles one terrain restriction row can or cannot enter. The random map generator makes them over
 * its working map; the game makes one per passability pattern the first time an object asks (`get_zone_map`).
 */
import type { TileMap } from './map';
import { f32, sqrt32 } from './num';
import type { UnitType } from './units';

/** `RGE_Zone_Map` (src/zone_map.cpp:70-212): 4-connected areas of tiles of one passability, numbered in row order. */
export class ZoneMap {
  readonly zones: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
    terrain: Uint8Array,
    readonly passable: readonly boolean[],
  ) {
    this.zones = new Uint8Array(w * h).fill(0xff);
    let counter = 0;
    const queue: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (this.zones[y * w + x] !== 0xff) continue;
        // The label wraps: a map with more than 255 areas reuses labels (src/zone_map.cpp:139-140).
        if (counter >= 255) counter = 0;
        const group = this.pass(terrain[y * w + x]! & 0x1f);
        this.zones[y * w + x] = counter;
        queue.length = 0;
        queue.push(y * w + x);
        while (queue.length > 0) {
          const i = queue.pop()!;
          const cx = i % w;
          const cy = (i - cx) / w;
          const visit = (j: number) => {
            if (this.zones[j] === 0xff && this.pass(terrain[j]!) === group) {
              this.zones[j] = counter;
              queue.push(j);
            }
          };
          if (cx > 0) visit(i - 1);
          if (cy > 0) visit(i - w);
          if (cx < w - 1) visit(i + 1);
          if (cy < h - 1) visit(i + w);
        }
        counter++;
      }
    }
  }

  private pass(terrain: number): boolean {
    return this.passable[terrain] ?? false;
  }

  /** `get_zone_info(x, y)`; `w` is the map width (the generator's callers pass it). */
  at(w: number, x: number, y: number): number {
    return this.zones[y * w + x]!;
  }

  /**
   * `withinRange(start, goal, range)` (src/zone_map.cpp:243-276): some tile within Euclidean `range` of the goal tile
   * (the box `±(int)range`, clamped to the map) has the start tile's zone.
   */
  withinRange(sx: number, sy: number, gx: number, gy: number, range: number): boolean {
    const start = this.zones[sy * this.w + sx]!;
    const r = Math.trunc(range);
    const x0 = Math.max(gx - r, 0);
    const y0 = Math.max(gy - r, 0);
    const x1 = Math.min(gx + r, this.w - 1);
    const y1 = Math.min(gy + r, this.h - 1);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const dx = gx - x;
        const dy = gy - y;
        if (sqrt32(f32(dx * dx + dy * dy)) <= range && this.zones[y * this.w + x] === start) return true;
      }
    }
    return false;
  }
}

/** A terrain restriction row as `check_info` compares it: each terrain passable when its value is above 0. */
export function passability(terrainTable: readonly number[], size = 32): boolean[] {
  return Array.from({ length: size }, (_, i) => (terrainTable[i] ?? 0) > 0);
}

/**
 * The game's `RGE_Zone_Map_List` (`map_zones`, src/zone_map.cpp:214-232, :429-453): a zone map per passability pattern,
 * made the first time an object of that terrain restriction asks. Terrain does not change in a game, so a map is never
 * rebuilt; `clear` drops them after the random map generator has written the terrain.
 */
export class ZoneMaps {
  private maps: ZoneMap[] = [];

  constructor(private readonly map: TileMap) {}

  /** `get_zone_map(terrains[master.terrain], ...)` for the object type `t`. */
  of(t: UnitType): ZoneMap {
    const passable = passability(t.terrainTable);
    for (const z of this.maps) if (z.passable.every((p, i) => p === passable[i])) return z;
    const z = new ZoneMap(this.map.width, this.map.height, this.map.terrain, passable);
    this.maps.push(z);
    return z;
  }

  clear(): void {
    this.maps = [];
  }
}
