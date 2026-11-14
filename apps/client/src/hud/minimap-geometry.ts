// Where the minimap puts each tile, ported from RGE_Diamond_Map (src/diam_map.cpp): map.bmp's lines are the picture
// rows, and each map diagonal (col - row) maps to one line. Float math is float32 as in the original.
import type { PackMinimap } from '@aoe/assets-import/manifest';

const f = Math.fround;

/** `RGE_Map_Tile_Row`: one diagonal of the map (the tiles with the same `width + row - col - 1`). */
interface TileRow {
  imageLine: number;
  /** Set only for the rows a line was computed for; tiles of the others are not drawn (`draw_tile`). */
  draw: boolean;
  colStep: number;
  drawWid: number;
  drawStep: number;
  ratio: number;
  colExtra: number;
  mapRow: number;
  mapCol: number;
}

export interface MinimapGeometry {
  readonly shape: PackMinimap;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly rows: TileRow[];
  /** The image line each picture line's diagonal is (`map_image_lines[i].tile_row`). */
  readonly lineRows: number[];
  /** `map_tile_draw_hgt`: pixel rows each tile fills. */
  readonly tileDrawHeight: number;
  /** `map_col_ratio`, `map_row_ratio`: picture pixels per tile across and down, for the view frame. */
  readonly colRatio: number;
  readonly rowRatio: number;
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `RGE_Diamond_Map::set_world` (src/diam_map.cpp:152). */
export function minimapGeometry(shape: PackMinimap, mapWidth: number, mapHeight: number): MinimapGeometry {
  const lines = shape.lines.length;
  const rowCount = mapWidth + mapHeight - 1;
  const rows: TileRow[] = Array.from({ length: rowCount }, () => ({
    imageLine: 0,
    draw: false,
    colStep: 0,
    drawWid: 0,
    drawStep: 0,
    ratio: 0,
    colExtra: 0,
    mapRow: 0,
    mapCol: 0,
  }));
  const lineRows: number[] = [];
  const rowStep = f(rowCount / lines);
  let tileRow = rowCount > lines ? f(f(rowCount / lines) * 0.5) : 0;
  let ratioSum = 0;
  for (let line = 0; line < lines; line++) {
    const lineLen = shape.lines[line]![1];
    const row = Math.min(Math.trunc(tileRow), rowCount - 1);
    lineRows.push(row);
    const rowLen = row < mapWidth ? Math.min(mapHeight, row + 1) : mapHeight - row - 1 + mapWidth;
    const colStep = f(rowLen / lineLen);
    const drawStep = f(1 / colStep);
    let drawWid = Math.trunc(drawStep);
    if (drawWid !== drawStep) drawWid++;
    const ratio = f(lineLen / rowLen);
    Object.assign(rows[row]!, {
      imageLine: line,
      draw: true,
      colStep,
      drawWid,
      drawStep,
      ratio,
      colExtra: ratio < 1 ? f(colStep * 0.5) : 0,
      mapRow: row < mapWidth ? 0 : row - mapWidth + 1,
      mapCol: row < mapWidth ? mapWidth - row - 1 : 0,
    });
    ratioSum = f(ratioSum + ratio);
    tileRow = f(tileRow + rowStep);
  }
  const drawHeight = f(1 / rowStep);
  let tileDrawHeight = Math.trunc(drawHeight);
  if (tileDrawHeight !== drawHeight) tileDrawHeight++;
  // A row without a line takes the last computed one's numbers, but stays undrawn.
  let source = 0;
  rows.forEach((r, i) => {
    if (r.draw) source = i;
    else {
      const s = rows[source]!;
      Object.assign(r, { imageLine: s.imageLine, colStep: s.colStep, drawWid: s.drawWid, drawStep: s.drawStep, ratio: s.ratio, colExtra: s.colExtra });
    }
  });
  return { shape, mapWidth, mapHeight, rows, lineRows, tileDrawHeight, colRatio: f(ratioSum / lines), rowRatio: f(lines / rowCount) };
}

/** The picture point of tile (col, row) and its row, as `draw_tile` and `draw_object` place it; `drawn` is `draw_tile`'s test. */
function tilePoint(g: MinimapGeometry, col: number, row: number): { x: number; y: number; r: TileRow; drawn: boolean } {
  const r = g.rows[g.mapWidth + row - col - 1]!;
  const min = Math.min(row, col);
  let offset: number;
  let drawn = true;
  if (r.ratio < 1) {
    const position = f(min * r.ratio);
    offset = Math.trunc(position);
    drawn = f(position - offset) < r.ratio;
  } else offset = Math.trunc(f(min * r.drawStep));
  return { x: g.shape.lines[r.imageLine]![0] + offset, y: g.shape.startY + r.imageLine, r, drawn };
}

/** `draw_tile` (src/diam_map.cpp:459): the pixels tile (col, row) fills, or null when it draws none. */
export function tileRect(g: MinimapGeometry, col: number, row: number): PixelRect | null {
  const p = tilePoint(g, col, row);
  if (!p.r.draw || !p.drawn) return null;
  return { x: p.x, y: p.y, w: p.r.drawWid, h: g.tileDrawHeight };
}

/** `draw_object` (src/diam_map.cpp:771): the picture point of an object on tile (col, row). */
export function objectPoint(g: MinimapGeometry, col: number, row: number): { x: number; y: number } {
  const p = tilePoint(g, col, row);
  return { x: p.x, y: p.y };
}

/** `pick_tile` (src/diam_map.cpp:904): the tile under picture pixel (x, y), or null outside the lines. */
export function pickTile(g: MinimapGeometry, x: number, y: number): { col: number; row: number } | null {
  const line = y - g.shape.startY;
  if (line < 0 || line >= g.shape.lines.length) return null;
  const [start, len] = g.shape.lines[line]!;
  if (x < start || x > start + len - 1) return null;
  const r = g.rows[g.lineRows[line]!]!;
  const offset = Math.trunc(f(f((x - start) * r.colStep) + r.colExtra));
  return { col: r.mapCol + offset, row: r.mapRow + offset };
}

/**
 * `draw_view_rect` (src/diam_map.cpp:826): the frame around the main view centred on tile (col, row), `cols` x `rows`
 * tiles big (`get_max_size`); null when the centre is off the map.
 */
export function viewRect(g: MinimapGeometry, col: number, row: number, cols: number, rows: number): { left: number; top: number; right: number; bottom: number } | null {
  if (col < 0 || col >= g.mapWidth || row < 0 || row >= g.mapHeight) return null;
  const p = tilePoint(g, col, row);
  const half = Math.trunc(cols / 2);
  return {
    left: Math.trunc(f(p.x - f(half * g.colRatio))),
    top: Math.trunc(f(p.y - f(rows * g.rowRatio))),
    right: Math.trunc(f(p.x + f((half + 2) * g.colRatio))),
    bottom: Math.trunc(f(p.y + f((rows + 4) * g.rowRatio))),
  };
}

/** A minimap shape without map.bmp: a centred diamond of `width` x `height` (the real one is 220x114). */
export function plainMinimapShape(width = 220, height = 114): PackMinimap {
  const lines: [number, number][] = [];
  const mid = Math.floor(height / 2);
  for (let y = 1; y < height; y++) {
    const half = Math.round((width / 2) * (1 - Math.abs(y - mid) / mid));
    if (half > 0) lines.push([width / 2 - half, half * 2]);
  }
  return { width, height, startY: 1, lines };
}
