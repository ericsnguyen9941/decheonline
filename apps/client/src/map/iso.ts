// Isometric projection of the tile grid. Tile (col, row): col grows up-right, row down-right (RGE_Map::get_point,
// src/map.cpp:2584). Map pixel space has the map's bounding box at the origin.

/** Tile box size from the dat's terrain block (tileWidth, tileHeight). The tile SLP frames are one pixel larger. */
export const TILE_W = 64;
export const TILE_H = 32;
const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;
/** Size of a drawn terrain frame: the diamond plus its shared right and bottom edge pixel. */
const FRAME_W = TILE_W + 1;
const FRAME_H = TILE_H + 1;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TileRange {
  col0: number;
  col1: number;
  row0: number;
  row1: number;
}

/** Top-left of the tile box in map pixels. */
export function tileOrigin(col: number, row: number, mapWidth: number): { x: number; y: number } {
  return { x: (col + row) * HALF_W, y: (row - col + mapWidth - 1) * HALF_H };
}

export function mapPixelSize(mapWidth: number, mapHeight: number): { w: number; h: number } {
  return { w: (mapWidth + mapHeight) * HALF_W, h: (mapWidth + mapHeight) * HALF_H };
}

/** Continuous tile coordinates of a map pixel: tile (c, r) spans [c, c + 1] x [r, r + 1]. */
export function pixelToTileCoords(x: number, y: number, mapWidth: number): { col: number; row: number } {
  const s = x / HALF_W;
  const d = y / HALF_H - mapWidth;
  return { col: (s - d) / 2, row: (s + d) / 2 };
}

export function tileCoordsToPixel(col: number, row: number, mapWidth: number): { x: number; y: number } {
  return { x: (col + row) * HALF_W, y: (row - col + mapWidth) * HALF_H };
}

/** Tile under a map pixel, or null when the pixel is outside the map. */
export function tileAtPixel(x: number, y: number, mapWidth: number, mapHeight: number): { col: number; row: number } | null {
  const t = pixelToTileCoords(x, y, mapWidth);
  const col = Math.floor(t.col);
  const row = Math.floor(t.row);
  return col >= 0 && row >= 0 && col < mapWidth && row < mapHeight ? { col, row } : null;
}

/** Tiles whose frame touches `view`, as a bounding box of columns and rows (a superset; see `tileTouches`). */
export function visibleRange(view: Rect, mapWidth: number, mapHeight: number): TileRange | null {
  // A tile is visible when its origin lies in the view grown by one frame to the left and top.
  const x0 = view.x - FRAME_W;
  const y0 = view.y - FRAME_H;
  const x1 = view.x + view.w;
  const y1 = view.y + view.h;
  let col0 = Infinity;
  let col1 = -Infinity;
  let row0 = Infinity;
  let row1 = -Infinity;
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const) {
    const s = x / HALF_W;
    const d = y / HALF_H - (mapWidth - 1);
    col0 = Math.min(col0, (s - d) / 2);
    col1 = Math.max(col1, (s - d) / 2);
    row0 = Math.min(row0, (s + d) / 2);
    row1 = Math.max(row1, (s + d) / 2);
  }
  const range = {
    col0: Math.max(0, Math.floor(col0)),
    col1: Math.min(mapWidth - 1, Math.ceil(col1)),
    row0: Math.max(0, Math.floor(row0)),
    row1: Math.min(mapHeight - 1, Math.ceil(row1)),
  };
  return range.col0 > range.col1 || range.row0 > range.row1 ? null : range;
}

/** Whether the frame of tile (col, row) overlaps `view`. */
export function tileTouches(view: Rect, col: number, row: number, mapWidth: number): boolean {
  const { x, y } = tileOrigin(col, row, mapWidth);
  return x < view.x + view.w && x + FRAME_W > view.x && y < view.y + view.h && y + FRAME_H > view.y;
}
