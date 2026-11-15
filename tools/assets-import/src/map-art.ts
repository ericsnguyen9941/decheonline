// The minimap's shape (map.bmp) and the fog's tile edge spans (TILEEDGE.DAT, BLKEDGE.DAT), read for the pack.
// docs/spec/hud.md "Fog of war" and "Minimap".
import type { PackMinimap, PackTileEdges, TileSpan } from './manifest';

/** `map.bmp`: interfac.drs bina 50401 (`TRIBE_Screen_Game` calls `set_bitmap("map.bmp", 0xc4e1)`). */
export const MINIMAP_BMP_ID = 50401;
/** Tile types in the edge files (`Init_Tile_Edge_Tables` reads 0x11) and edge numbers per type (0x2f). */
const TILE_TYPES = 17;
export const EDGE_COUNT = 47;

/**
 * `RGE_Diamond_Map::set_bitmap` (src/diam_map.cpp:66): each picture row's first run of palette index 0xFF is a line of
 * the minimap; rows without one are skipped, and the first row with one is `map_image_start_y`. 8-bit BMPs only.
 */
export function parseMinimapShape(bmp: Uint8Array): PackMinimap {
  const view = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength);
  if (view.getUint16(0, true) !== 0x4d42) throw new Error('map.bmp: not a BMP');
  const bits = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  if (view.getUint16(28, true) !== 8) throw new Error('map.bmp: not 8 bits per pixel');
  const height = Math.abs(rawHeight);
  const pitch = (width + 3) & ~3;
  const lines: [number, number][] = [];
  let startY = -1;
  for (let y = 0; y < height; y++) {
    // A positive height stores the rows bottom up (`Orien` != 1).
    const row = bits + (rawHeight > 0 ? height - 1 - y : y) * pitch;
    let x = 0;
    while (x < width && bmp[row + x] !== 0xff) x++;
    if (x === width) continue;
    const start = x;
    while (x < width && bmp[row + x] === 0xff) x++;
    lines.push([start, x - start]);
    if (startY === -1) startY = y;
  }
  return { width, height, startY, lines };
}

/**
 * Every tile type's tables of `RGE_View::Init_Tile_Edge_Tables` (src/view.cpp:277): each file starts with 17
 * offsets, one table per tile type; a TILEEDGE table holds 47 pairs of offsets (`normal_draw`, `fog_draw`), a BLKEDGE
 * table 47 offsets (`black_UNdraw`); each points at 3-byte spans `(Y_delta, X_start, X_end)` ended by `Y_delta` 0xFF,
 * and 0 is no list (drawn as an empty one). `Y_delta` runs over the type's box (`tilesizes[type].height` + 1 rows).
 */
export function parseTileEdges(tileEdge: Uint8Array, blackEdge: Uint8Array): PackTileEdges[] {
  return Array.from({ length: TILE_TYPES }, (_, type) => parseTypeEdges(tileEdge, blackEdge, type));
}

function parseTypeEdges(tileEdge: Uint8Array, blackEdge: Uint8Array, type: number): PackTileEdges {
  const tables = (file: Uint8Array, perEdge: number): TileSpan[][][] => {
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    if (file.byteLength < TILE_TYPES * 4) throw new Error('tile edge file too short');
    const table = view.getUint32(type * 4, true);
    return Array.from({ length: perEdge }, (_, k) =>
      Array.from({ length: EDGE_COUNT }, (_, edge) => {
        let p = view.getUint32(table + (edge * perEdge + k) * 4, true);
        const spans: TileSpan[] = [];
        if (p === 0) return spans;
        for (; file[p] !== 0xff; p += 3) spans.push([file[p]!, file[p + 1]!, file[p + 2]!]);
        return spans;
      }),
    );
  };
  const [normal, fog] = tables(tileEdge, 2) as [TileSpan[][], TileSpan[][]];
  const [black] = tables(blackEdge, 1) as [TileSpan[][]];
  return { normal, fog, black };
}

/** An edge file with every tile type's table: `lists[k][edge]` for k < `perEdge`; the inverse of `parseTileEdges`. */
export function buildTileEdgeFile(lists: TileSpan[][][]): Uint8Array {
  const perEdge = lists.length;
  const header = TILE_TYPES * 4;
  const table = EDGE_COUNT * perEdge * 4;
  const data: number[] = [];
  const offsets: number[] = [];
  for (let edge = 0; edge < EDGE_COUNT; edge++) {
    for (let k = 0; k < perEdge; k++) {
      offsets.push(header + table + data.length);
      for (const s of lists[k]![edge] ?? []) data.push(...s);
      data.push(0xff, 0, 0);
    }
  }
  const out = new Uint8Array(header + table + data.length);
  const view = new DataView(out.buffer);
  // Every tile type shares one table.
  for (let t = 0; t < TILE_TYPES; t++) view.setUint32(t * 4, header, true);
  offsets.forEach((o, i) => view.setUint32(header + i * 4, o, true));
  out.set(data, header + table);
  return out;
}

/** An 8-bit BMP (bottom-up) whose pixels are `pixel(x, y)`, for the synthetic install. */
export function buildBmp8(width: number, height: number, pixel: (x: number, y: number) => number): Uint8Array {
  const pitch = (width + 3) & ~3;
  const bits = 14 + 40 + 256 * 4;
  const out = new Uint8Array(bits + pitch * height);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0x4d42, true);
  view.setUint32(2, out.length, true);
  view.setUint32(10, bits, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 8, true);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[bits + (height - 1 - y) * pitch + x] = pixel(x, y);
  return out;
}
