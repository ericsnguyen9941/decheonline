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
