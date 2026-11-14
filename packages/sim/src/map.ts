import type { Hasher } from './hash';

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
