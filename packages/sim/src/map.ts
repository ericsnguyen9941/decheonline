import type { Hasher } from './hash';
import { add32, f32, sub32, toInt } from './num';

/** Terrain ids are the dat's terrain ids (`empires.dat` terrain block), always below 32 (src/map.cpp:1397). */
export const TERRAIN_GRASS = 0;
export const TERRAIN_WATER = 1;
export const TERRAIN_DESERT = 6;
export const TERRAIN_WATER_DARK = 22;

/** Plain JSON-safe copy of a `TileMap`. */
export interface MapSnapshot {
  width: number;
  height: number;
  terrain: number[];
  elevation: number[];
}

/**
 * The tile grid: `RGE_Map` in the original. Tile `(x, y)` is column `x`, row `y`; `x` grows up-right on screen and
 * `y` down-right (src/map.cpp:2584 `get_point`). Each tile has a terrain id and an elevation level (0 = flat). Part
 * of the simulation state: snapshotted and hashed.
 */
export class TileMap {
  readonly terrain: Uint8Array;
  readonly elevation: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    terrain: ArrayLike<number> | null = null,
    elevation: ArrayLike<number> | null = null,
  ) {
    const size = width * height;
    this.terrain = new Uint8Array(size);
    this.elevation = new Uint8Array(size);
    if (terrain) this.terrain.set(terrain);
    if (elevation) this.elevation.set(elevation);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  terrainAt(x: number, y: number): number {
    return this.terrain[y * this.width + x]!;
  }

  elevationAt(x: number, y: number): number {
    return this.elevation[y * this.width + x]!;
  }

  /**
   * `RGE_Map::get_tile_type` (src/map.cpp:2268; docs/spec/hud.md "Elevation"): the slope shape 0-16 of tile (col, row)
   * from which of its neighbours are one level higher; off-map neighbours count as level with it. The decomp's names,
   * in map terms: n (row - 1), e (col + 1), w (col - 1), s (row + 1), nw (row - 1, col + 1), sw (row + 1, col - 1),
   * ne (row - 1, col - 1), se (row + 1, col + 1). The original keeps it per tile, recomputed when a height changes.
   */
  tileType(col: number, row: number): number {
    const { width, height } = this;
    if (col < 0 || row < 0 || col >= width || row >= height) return 0;
    const c = this.elevationAt(col, row);
    const at = (dc: number, dr: number) => {
      const x = col + dc;
      const y = row + dr;
      return x >= 0 && y >= 0 && x < width && y < height ? this.elevationAt(x, y) : c;
    };
    const up = c + 1;
    const down = c - 1;
    const n = at(0, -1);
    const e = at(1, 0);
    const w = at(-1, 0);
    const s = at(0, 1);
    if (n === up && e === up) return 14;
    if (w === up && s === up) return 13;
    if (n === up && w === up) return 16;
    if (e === up && s === up) return 15;
    if (n === up) return 6;
    if (e === up) return 8;
    if (w === up) return 5;
    if (s === up) return 7;
    if (at(1, -1) === up) return w === down && s === down ? 2 : 10;
    if (at(-1, 1) === up) return n === down && e === down ? 1 : 9;
    if (at(-1, -1) === up) return e === down && s === down ? 3 : 11;
    if (at(1, 1) === up) return n === down && w === down ? 4 : 12;
    return 0;
  }

  /**
   * `teleport`'s `rz` (src/stat_obj.cpp:1484-1607; docs/spec/movement.md §4): the ground's `world_z` at map point
   * (x, y), clamped to the map as `teleport` clamps: the tile's height plus its slope at the fraction (rx, ry) of the
   * tile, in float32 as the original computes it.
   */
  groundZ(x: number, y: number): number {
    let px = f32(x);
    let py = f32(y);
    if (px < 0) px = 0;
    if (px >= this.width) px = sub32(this.width, EDGE);
    if (py < 0) py = 0;
    if (py >= this.height) py = sub32(this.height, EDGE);
    const tx = Math.min(Math.max(toInt(px), 0), this.width - 1);
    const ty = Math.min(Math.max(toInt(py), 0), this.height - 1);
    const rx = sub32(px, toInt(px));
    const ry = sub32(py, toInt(py));
    return add32(slopeZ(this.tileType(tx, ty), rx, ry), this.elevationAt(tx, ty));
  }

  setTile(x: number, y: number, terrain: number, elevation = 0): void {
    this.terrain[y * this.width + x] = terrain;
    this.elevation[y * this.width + x] = elevation;
  }

  hashInto(h: Hasher): void {
    h.u32(this.width).u32(this.height);
    for (let i = 0; i < this.terrain.length; i++) h.u32(this.terrain[i]! | (this.elevation[i]! << 8));
  }

  toJSON(): MapSnapshot {
    return {
      width: this.width,
      height: this.height,
      terrain: Array.from(this.terrain),
      elevation: Array.from(this.elevation),
    };
  }

  static fromJSON(s: MapSnapshot): TileMap {
    return new TileMap(s.width, s.height, s.terrain, s.elevation);
  }
}

/** `teleport`'s clamp below the map's far edges (`map_width - 0.001f`). */
const EDGE = f32(0.001);

/** `teleport`'s per-type height of the slope at (rx, ry) within a tile, 0-1 (src/stat_obj.cpp:1539-1607). */
function slopeZ(type: number, rx: number, ry: number): number {
  switch (type) {
    case 1:
      return add32(rx, ry) < 1 ? ry : sub32(1, rx);
    case 2:
      return add32(rx, ry) < 1 ? rx : sub32(1, ry);
    case 3:
      return rx <= ry ? sub32(1, ry) : sub32(1, rx);
    case 4:
      return rx <= ry ? rx : ry;
    case 5:
      return sub32(1, rx);
    case 6:
      return sub32(1, ry);
    case 7:
      return ry;
    case 8:
      return rx;
    case 9: {
      const d = sub32(rx, ry);
      return d < 0 ? -d : 0;
    }
    case 10: {
      const d = sub32(rx, ry);
      return d <= 0 ? 0 : d;
    }
    case 11: {
      const d = add32(rx, ry);
      return d < 1 ? sub32(1, d) : 0;
    }
    case 12: {
      const d = add32(rx, ry);
      return d > 1 ? sub32(d, 1) : 0;
    }
    case 13:
      return add32(rx, ry) < 1 ? sub32(1, rx) : ry;
    case 14:
      return add32(rx, ry) < 1 ? sub32(1, ry) : rx;
    case 15:
      return rx <= ry ? ry : rx;
    case 16:
      return rx <= ry ? sub32(1, rx) : sub32(1, ry);
    default:
      return 0;
  }
}

export const TEST_MAP_SIZE = 48;

/**
 * The fixed map used until the random map generator exists: grass with a desert strip along the east edge and
 * a lake (dark water at its centre). Integer arithmetic only, so every peer builds the same map.
 */
export function createTestMap(): TileMap {
  const map = new TileMap(TEST_MAP_SIZE, TEST_MAP_SIZE);
  for (let y = 0; y < TEST_MAP_SIZE; y++) {
    for (let x = 0; x < TEST_MAP_SIZE; x++) {
      const lakeDist = (x - 16) * (x - 16) + (y - 28) * (y - 28);
      let terrain = TERRAIN_GRASS;
      if (x + (y >> 1) >= 52) terrain = TERRAIN_DESERT;
      if (lakeDist <= 36) terrain = TERRAIN_WATER;
      if (lakeDist <= 9) terrain = TERRAIN_WATER_DARK;
      map.setTile(x, y, terrain);
    }
  }
  return map;
}
