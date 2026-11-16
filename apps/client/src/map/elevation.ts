// Hills on the map view, as the original draws them (docs/spec/hud.md "Elevation"): each tile's `tile_type` (a slope
// shape, from which neighbours are one level higher), its box raised by its height, objects at their `world_z`, and the
// map point under a screen pixel on the drawn surface.
import type { TileMap } from '@aoe/sim';
import type { TerrainLayout } from '../assets/provider';
import { pixelToTileCoords, TILE_H, TILE_W, tileCoordsToPixel, tileOrigin } from './iso';

/** `elev_height` (the dat's terrain block, `init_tile_sizes`): pixels per height level; equal to `tile_half_height`. */
export const ELEV_H = 16;
/** Tile types the edge files and terrain tables have entries for (`get_tile_type` makes 0-16). */
export const TILE_TYPES = 17;

/** Corners of a tile: left (rx 0, ry 0), top (1, 0), bottom (0, 1), right (1, 1), in map units within the tile. */
const L = 1;
const T = 2;
const B = 4;
const R = 8;
/** The corners' map units within the tile, in `tileCorners` order. */
const CORNER_MAP: readonly Point[] = [[0, 0], [1, 0], [0, 1], [1, 1]];

type Point = readonly [number, number];

/**
 * Per tile type: the corners raised one level, and whether the surface folds along the left-right diagonal (rx = ry)
 * instead of the top-bottom one (rx + ry = 1). Read off `RGE_Static_Object::teleport`'s height table (src/stat_obj.cpp:
 * 1539-1616), which is planar on each half; types 1-4 are 9-12 folded the other way (a lower neighbour on the far side).
 */
const SHAPES: readonly (readonly [number, boolean])[] = [
  [0, false],
  [B, false],
  [T, false],
  [L, true],
  [R, true],
  [L | B, false],
  [L | T, false],
  [B | R, false],
  [T | R, false],
  [B, true],
  [T, true],
  [L, false],
  [R, false],
  [L | B | R, false],
  [L | T | R, false],
  [T | B | R, true],
  [L | T | B, true],
];

/** `tilesizes[type].y_delta` (`init_tile_sizes`, src/map.cpp:175): -8 or 8 on a slope, read only by `get_tile_screen_coords`. */
const Y_DELTA = [0, -8, 8, -8, -8, -8, 8, -8, 8, -8, 8, -8, -8, -8, 8, 8, 8];
/** The tile types `get_tile_screen_coords` drops by a further `elev_height` (src/view.cpp:1452-1459). */
const DROPPED = [3, 5, 6, 11];

/** Whether a tile type has its top corner raised: its box starts `ELEV_H` higher (`coordinate_map`, src/map.cpp:428). */
export function raisedTop(type: number): boolean {
  return ((SHAPES[type]?.[0] ?? 0) & T) !== 0;
}

/** `tilesizes[type].height` (`init_tile_sizes`, src/map.cpp:175): the box height, 16, 32 or 48; frames are one more. */
export function tileBoxHeight(type: number): number {
  const raised = SHAPES[type]?.[0] ?? 0;
  const top = raised & T ? -ELEV_H : 0;
  const bottom = raised & B ? TILE_H - ELEV_H : TILE_H;
  const side = (c: number) => (raised & c ? TILE_H / 2 - ELEV_H : TILE_H / 2);
  return Math.max(bottom, side(L), side(R)) - Math.min(top, side(L), side(R));
}

/**
 * Which of a terrain's minimap colours a tile type uses (`RGE_Diamond_Map`, src/diam_map.cpp:530-557): 1 `map_hi_color`
 * (types 2, 3, 6, 10, 11, 14, 16), 0 `map_med_color` (flat), -1 `map_low_color` (the other slopes).
 */
export function tileShade(type: number): -1 | 0 | 1 {
  if (type === 0) return 0;
  return [2, 3, 6, 10, 11, 14, 16].includes(type) ? 1 : -1;
}

/**
 * The corners of a tile type's surface in its box (box top-left at 0, 0): left, top, bottom, right, as [x, y]. A flat
 * tile is the 64x32 diamond; a raised corner is `ELEV_H` higher, and a raised top moves the whole box up.
 */
export function tileCorners(type: number): Point[] {
  const raised = SHAPES[type]?.[0] ?? 0;
  const shift = raised & T ? ELEV_H : 0;
  const y = (c: number, flat: number) => flat - (raised & c ? ELEV_H : 0) + shift;
  return [
    [0, y(L, TILE_H / 2)],
    [TILE_W / 2, y(T, 0)],
    [TILE_W / 2, y(B, TILE_H)],
    [TILE_W, y(R, TILE_H / 2)],
  ];
}

/** `RGE_Map::get_tile_type`: the sim's (`TileMap.tileType`), which `teleport`'s heights read too. */
export function tileType(map: TileMap, col: number, row: number): number {
  return map.tileType(col, row);
}

/**
 * `RGE_View::get_tile_picture` (src/view.cpp:3535): the frame of tile type `type` at (col, row), from the terrain's
 * `tiles[type]` (`[count, animations, shapeIndex]`); a type the layout lacks uses the flat tile's.
 */
export function tilePicture(art: TerrainLayout, type: number, col: number, row: number): number {
  const [count, animations, shapeIndex] = art.tiles[type] ?? art.tiles[0] ?? [art.rows * art.cols, 1, 0];
  let variant = 0;
  if (count > 1 && (art.rows > 1 || art.cols > 1)) variant = (row % art.rows) * art.cols + (col % art.cols);
  if (variant > count - 1) variant = 0;
  return animations * variant + shapeIndex;
}

/**
 * The map's ground as drawn: tile types, box positions, heights of points, and screen pixel to map point. Built once
 * per map (the map does not change in a game). On a map without elevation everything is the flat projection.
 */
export class Ground {
  readonly types: Uint8Array;
  /** Highest level on the map. */
  readonly maxHeight: number;
  /** Draw order of each tile (`RGE_View::draw` scans the screen top to bottom, then left to right). */
  readonly rank: Uint32Array;

  /**
   * `boxTerrains`: the terrains with no SLP of their own (`terrain_types[t].shape` is null: Beach, Forest, Shallows, ...), which
   * `hit_tile` hits anywhere in the tile's box; every other terrain is hit where its drawn shape is.
   */
  constructor(
    readonly map: TileMap,
    private readonly boxTerrains: ReadonlySet<number> = new Set(),
  ) {
    const { width, height } = map;
    this.types = new Uint8Array(width * height);
    let max = 0;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        this.types[row * width + col] = tileType(map, col, row);
        max = Math.max(max, map.elevationAt(col, row));
      }
    }
    this.maxHeight = max;
    this.rank = new Uint32Array(width * height);
    let next = 0;
    for (let d = -(width - 1); d < height; d++) {
      for (let col = Math.max(0, -d); col < width && col + d < height; col++) this.rank[(col + d) * width + col] = next++;
    }
  }

  get flat(): boolean {
    return this.maxHeight === 0;
  }

  type(col: number, row: number): number {
    return this.types[row * this.map.width + col]!;
  }

  /** Top-left of tile (col, row)'s box in map pixels, and the box height: where its frame is drawn. */
  tileBox(col: number, row: number): { x: number; y: number; h: number } {
    const o = tileOrigin(col, row, this.map.width);
    const type = this.type(col, row);
    return { x: o.x, y: o.y - this.map.elevationAt(col, row) * ELEV_H - (raisedTop(type) ? ELEV_H : 0), h: tileBoxHeight(type) };
  }

  /**
   * `world_z` of the ground at map point (x, y): the tile's height plus its slope there (`teleport`'s `rz`), from the
   * sim's own `TileMap.groundZ`, so a ground object's sim `z` is exactly the height it is drawn at.
   */
  z(x: number, y: number): number {
    if (this.flat) return 0;
    return this.map.groundZ(x, y);
  }

  /** Map pixel of map point (x, y) at `lift` levels above the ground there (`get_point` with `world_z`). */
  pixel(x: number, y: number, lift = 0): { x: number; y: number } {
    const p = tileCoordsToPixel(x, y, this.map.width);
    return { x: p.x, y: p.y - (this.z(x, y) + lift) * ELEV_H };
  }

  /**
   * Map pixel the view centres on when it looks at map point (x, y) (`RGE_View::update`, src/view.cpp:1061-1093): the
   * point, kept on the map (`RGE_Player::set_view_loc`, src/player.cpp:993), at its flat place (the view adds the centre
   * tile's `height * elev_hgt` back to its `screen_ypos`, and the fraction is truncated to whole pixels), `ELEV_H` higher
   * when the centre tile's top corner is raised (`coordinate_map`'s shift stays in `screen_ypos`). Not the drawn height.
   */
  viewPixel(x: number, y: number): { x: number; y: number } {
    const { width, height } = this.map;
    const vx = Math.min(Math.max(x, 0), width - 1);
    const vy = Math.min(Math.max(y, 0), height - 1);
    const col = Math.trunc(vx);
    const row = Math.trunc(vy);
    const o = tileOrigin(col, row, width);
    const fx = vx - col;
    const fy = vy - row;
    return {
      x: o.x + Math.trunc((fx + fy) * (TILE_W / 2)),
      y: o.y + TILE_H / 2 + Math.trunc((fy - fx) * (TILE_H / 2)) - (raisedTop(this.type(col, row)) ? ELEV_H : 0),
    };
  }

  /**
   * The point `viewPixel` puts at map pixel (px, py): the view's centre point (`RGE_Player::view_x`, `view_y`, which the
   * minimap's frame is drawn from, `RGE_Diamond_Map::draw_view_rect`, src/diam_map.cpp:826). On a flat map that is the flat
   * projection; the centre tile's raised top moves the pixel 16 higher, so a pixel that is the shifted flat place of a
   * raised-top tile belongs to that tile.
   */
  viewPoint(px: number, py: number): { col: number; row: number } {
    const flat = pixelToTileCoords(px, py, this.map.width);
    if (this.flat) return flat;
    const shifted = pixelToTileCoords(px, py + ELEV_H, this.map.width);
    const { width, height } = this.map;
    const col = Math.trunc(shifted.col);
    const row = Math.trunc(shifted.row);
    return col >= 0 && row >= 0 && col < width && row < height && raisedTop(this.type(col, row)) ? shifted : flat;
  }

  /**
   * Map pixel where the building being placed is drawn when aligned at map point (x, y) (`draw_place_object`, src/
   * view.cpp:1160): the tile's box (`get_tile_screen_coords` with `drop`, view.cpp:1430: plus its type's `y_delta`, 8
   * lower on any slope and `ELEV_H` higher on types 3, 5, 6 and 11) and the middle of `alignment_box`'s corners (src/
   * m_s_obj.cpp:1132), which is the point's flat place in the tile. On flat ground that is `pixel(x, y)`. A wall
   * outline's segment (`draw_wall_outline`, src/tvw_main.cpp:204) passes `drop` 0: no slope or dropped-type shift.
   */
  placePixel(x: number, y: number, radiusX: number, radiusY: number, drop = true): { x: number; y: number } {
    const col = Math.trunc(x);
    const row = Math.trunc(y);
    const box = this.tileBox(col, row);
    const type = this.type(col, row);
    let top = box.y + Y_DELTA[type]!;
    if (drop && type !== 0) top += ELEV_H / 2;
    if (drop && DROPPED.includes(type)) top -= ELEV_H;
    let tx = x - col + radiusX;
    let ty = y - row + radiusY;
    const x1 = Math.trunc((tx + ty) * (TILE_W / 2));
    tx -= 2 * radiusX;
    const y2 = Math.trunc((ty + 1 - tx) * (TILE_H / 2));
    ty -= 2 * radiusY;
    const x3 = Math.trunc((tx + ty) * (TILE_W / 2));
    tx += 2 * radiusX;
    const y4 = Math.trunc((ty + 1 - tx) * (TILE_H / 2));
    return { x: box.x + Math.trunc((x1 - x3) / 2) + x3, y: top + Math.trunc((y2 - y4) / 2) + y4 };
  }

  /**
   * The map point drawn at map pixel (px, py): the last tile in draw order that `hit_tile` hits (`view_function` mode 0x28,
   * src/view.cpp:1781), at the fraction `tile_map_coords` gives for the pixel in its box. Off the drawn map, the flat
   * projection's point, which may lie off the map.
   */
  pointAt(px: number, py: number): { col: number; row: number } {
    if (this.flat) return pixelToTileCoords(px, py, this.map.width);
    const { width, height } = this.map;
    let best: { col: number; row: number; rank: number } | null = null;
    const seen = new Set<number>();
    const reach = (this.maxHeight + 1) * ELEV_H;
    // A tile's box is its flat box raised by its height (and 16 for a raised top): the tiles that can hold the pixel are those
    // around the flat tile at the pixel lowered by each of those.
    for (let dy = 0; dy <= reach; dy += ELEV_H) {
      const t = pixelToTileCoords(px, py + dy, width);
      const c0 = Math.floor(t.col);
      const r0 = Math.floor(t.row);
      for (let row = r0 - 1; row <= r0 + 1; row++) {
        for (let col = c0 - 1; col <= c0 + 1; col++) {
          if (col < 0 || row < 0 || col >= width || row >= height) continue;
          const index = row * width + col;
          if (seen.has(index)) continue;
          seen.add(index);
          if (best && this.rank[index]! < best.rank) continue;
          const hit = this.hitTile(col, row, px, py);
          if (hit) best = { col: col + hit[0], row: row + hit[1], rank: this.rank[index]! };
        }
      }
    }
    return best ? { col: best.col, row: best.row } : pixelToTileCoords(px, py, width);
  }

  /**
   * `RGE_View::hit_tile` (src/view.cpp:3624): the pixel must lie in the tile's box (its type's `tilesizes` width and height),
   * and, when the terrain has an SLP of its own, on its drawn shape (`shape_check`: an opaque pixel of the frame, which the
   * two planar halves of the surface stand for); a terrain without one is hit anywhere in the box. Returns the offset (rx, ry)
   * within the tile: on the surface, where the pixel lies on the planar halves; off it (only a box-hit terrain), the offset
   * `tile_map_coords` gives for the pixel, which may lie outside the tile. Null when not hit.
   */
  private hitTile(col: number, row: number, px: number, py: number): [number, number] | null {
    const box = this.tileBox(col, row);
    const x = px - box.x;
    const y = py - box.y;
    if (x < 0 || x >= TILE_W || y < 0 || y >= box.h) return null;
    const type = this.type(col, row);
    const c = tileCorners(type);
    // The two planar halves, as corner indices (left, top, bottom, right).
    const halves = SHAPES[type]![1] ? [[0, 2, 3], [0, 1, 3]] : [[0, 1, 2], [1, 2, 3]];
    for (const [i0, i1, i2] of halves as [number, number, number][]) {
      const [p0, p1, p2] = [c[i0]!, c[i1]!, c[i2]!];
      const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
      const u = ((x - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (y - p0[1])) / det;
      const v = ((p1[0] - p0[0]) * (y - p0[1]) - (x - p0[0]) * (p1[1] - p0[1])) / det;
      if (!(u >= 0 && v >= 0 && u + v <= 1)) continue;
      const [m0, m1, m2] = [CORNER_MAP[i0]!, CORNER_MAP[i1]!, CORNER_MAP[i2]!];
      return [m0[0] + (m1[0] - m0[0]) * u + (m2[0] - m0[0]) * v, m0[1] + (m1[1] - m0[1]) * u + (m2[1] - m0[1]) * v];
    }
    return this.boxTerrains.has(this.map.terrainAt(col, row)) ? tileMapCoords(type, x, y) : null;
  }
}

/**
 * `RGE_Map::tile_map_coords` (src/map.cpp:1880): the offset (rx, ry) within a tile of the pixel (x, y) in its box (top-left 0, 0,
 * 64 wide, `tilesizes[type].height` tall), by the tile type's slope. A pixel off the surface gets the formula's extension, so
 * its point may lie outside the tile. On the surface it is exact on flat, 1, 5, 7, 10-13 and within 0.13 of the surface on
 * 2-4, 6, 8, 14 (the original's own approximation); the port uses it only off the surface. The decomp compares the pixel row `y` where the geometry wants the ratio (types 3, 4, 15,
 * 16): the comparison here is on the ratio, which is the line each slope folds along.
 */
export function tileMapCoords(type: number, x: number, y: number): [number, number] {
  const xr = x / TILE_W;
  const yr = y / TILE_H;
  let offset = 0;
  switch (type) {
    case 1:
      offset = 2 * yr - 2 * Math.abs(0.5 - xr);
      break;
    case 2:
      offset = xr > 0.5 ? -0.5 * xr - (yr - 0.5) : -0.5 * (1 - xr) - (yr - 0.5);
      break;
    case 3:
      offset = xr * 0.5 < yr ? (1 - xr) * 0.5 - (yr - 0.5) : 2 * (1 - xr) - 1 + 2 * yr;
      break;
    case 4:
      offset = (1 - xr) * 0.5 < yr ? xr * 0.5 - (yr - 0.5) : 2 * xr - 1 + 2 * yr;
      break;
    case 5:
      offset = 2 * yr + 1 - 2 * xr;
      break;
    case 6:
      offset = -0.5 * xr - (yr - 0.5);
      break;
    case 7:
      offset = 2 * xr - 1 + 2 * yr;
      break;
    case 8:
      offset = -0.5 * (1 - xr) - (yr - 0.5);
      break;
    case 10:
      offset = yr >= 1 ? -1 : -yr;
      break;
    case 11:
      offset = xr <= 0.5 ? 2 * (0.5 - xr) : 0;
      break;
    case 12:
      offset = xr > 0.5 ? 2 * (xr - 0.5) : 0;
      break;
    case 13:
      offset = 2 * (Math.abs(xr - 0.5) + yr);
      break;
    case 14:
      offset = xr <= 0.5 ? -0.5 * xr - (yr - 0.5) : -0.5 * (1 - xr) - (yr - 0.5);
      break;
    case 15:
      offset = yr <= 1 - xr * 0.5 ? 2 * xr - 1 + 2 * yr : -0.5 * (1 - xr) - (yr - 0.5);
      break;
    case 16:
      offset = 1 - (1 - xr) * 0.5 < yr ? -0.5 * xr - (yr - 0.5) : 2 * yr + 1 - 2 * xr;
      break;
  }
  const ry = (2 * xr - (1 - 2 * yr) + offset) * 0.5;
  return [2 * xr - ry, ry];
}
