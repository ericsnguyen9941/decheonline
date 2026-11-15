// Where a building being placed goes: `TRIBE_Master_Building_Object::alignment` (src/tm_b_obj.cpp:245) runs
// `RGE_Master_Static_Object::alignment` (src/m_s_obj.cpp:1058) with its centre flag set, in float32 as the original.

const f = Math.fround;
/** The map's far edge is pulled in by this much (`map_width - 0.00001f`). */
const EDGE = f(0.00001);

/**
 * Keeps a building of radius (rx, ry) centred on map point (col, row) inside the map, then moves the point so the
 * footprint's edges fall on tile edges (a whole radius centres on a tile corner, a half one on a tile's middle).
 */
export function alignBuilding(rx: number, ry: number, col: number, row: number, mapWidth: number, mapHeight: number): { x: number; y: number } {
  col = f(col);
  row = f(row);
  rx = f(rx);
  ry = f(ry);
  let dx1 = f(col - rx);
  let dy1 = f(row - ry);
  let dx2 = f(col + rx);
  let dy2 = f(row + ry);
  const mapW = f(f(mapWidth) - EDGE);
  const mapH = f(f(mapHeight) - EDGE);
  if (dx1 < 0) {
    dx1 = -dx1;
    dx2 = f(dx2 + dx1);
    col = f(col + dx1);
    dx1 = 0;
  }
  if (dy1 < 0) {
    dy1 = -dy1;
    dy2 = f(dy2 + dy1);
    row = f(row + dy1);
    dy1 = 0;
  }
  if (dx2 >= mapW) {
    dx1 = f(dx1 + f(mapW - dx2));
    col = f(col + f(mapW - dx2));
    dx2 = mapW;
  }
  if (dy2 >= mapH) {
    dy1 = f(dy1 + f(mapH - dy2));
    row = f(row + f(mapH - dy2));
    dy2 = mapH;
  }
  dx1 = Math.abs(dx1);
  dy1 = Math.abs(dy1);
  dx2 = Math.abs(dx2);
  dy2 = Math.abs(dy2);
  // `(short)` truncates: the fraction past the tile edge on the low side, and the part short of it on the high side.
  dx1 = f(dx1 - Math.trunc(dx1));
  dy1 = f(dy1 - Math.trunc(dy1));
  dx2 = f(1 - f(dx2 - Math.trunc(dx2)));
  dy2 = f(1 - f(dy2 - Math.trunc(dy2)));
  const x = f(dx1 + dx2) >= 1 ? (dx1 > dx2 ? f(col + f(1 - dx1)) : f(col - f(1 - dx2))) : col;
  const y = f(dy1 + dy2) >= 1 ? (dy1 > dy2 ? f(row + f(1 - dy1)) : f(row - f(1 - dy2))) : row;
  return { x, y };
}

/** One wall segment of the placement outline: its tile and the facet it is drawn with. */
export interface WallTile {
  col: number;
  row: number;
  /** 0 west-east, 1 north-south, 2 an end, a corner or a diagonal (the facets `connect` gives built walls). */
  facet: number;
}

/**
 * The wall segments `TRIBE_Main_View::draw_multi_object_outline` (src/tvw_main.cpp:21) outlines for a drag from tile
 * (col1, row1) to (col2, row2), the tiles `do_command_build_wall` walks (economy.md §4.8.1): a 45° line or one tile, else
 * an L down the start column (or along the start row) to the far end of the longer axis, then along the end row (or
 * down the end column). The two ends and the corner show facet 2, a leg's middle its direction's facet; a 45° line all 2.
 */
export function wallOutline(col1: number, row1: number, col2: number, row2: number): WallTile[] {
  const out: WallTile[] = [];
  const dx = Math.abs(col2 - col1);
  const dy = Math.abs(row2 - row1);
  const sx = Math.sign(col2 - col1);
  const sy = Math.sign(row2 - row1);
  if (dx === dy) {
    for (let i = 0; i <= dx; i++) out.push({ col: col1 + i * sx, row: row1 + i * sy, facet: 2 });
  } else if (dy > dx) {
    for (let i = 0; i <= dy; i++) {
      const row = row1 + i * sy;
      out.push({ col: col1, row, facet: row === row1 || row === row2 ? 2 : 1 });
    }
    for (let i = 1; i <= dx; i++) {
      const col = col1 + i * sx;
      out.push({ col, row: row2, facet: col === col2 ? 2 : 0 });
    }
  } else {
    for (let i = 0; i <= dx; i++) {
      const col = col1 + i * sx;
      out.push({ col, row: row1, facet: col === col1 || col === col2 ? 2 : 0 });
    }
    for (let i = 1; i <= dy; i++) {
      const row = row1 + i * sy;
      out.push({ col: col2, row, facet: row === row2 ? 2 : 1 });
    }
  }
  return out;
}
