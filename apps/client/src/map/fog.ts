// Fog of war on the map view, as RGE_View::view_function_terrain draws it (src/view.cpp:1866-2190): unexplored tiles
// are not drawn (black), fogged tiles are drawn with every other pixel black, and the edges between them follow the
// tile edge spans of TILEEDGE.DAT and BLKEDGE.DAT. docs/spec/hud.md "Fog of war".
import { TILE_BLACK, TILE_FOGGED, TILE_VISIBLE } from '@aoe/sim';
import type { PackTileEdges, TileSpan } from '@aoe/assets-import/manifest';
import { TILE_TYPES, tileBoxHeight, tileCorners } from './elevation';

export { TILE_BLACK, TILE_FOGGED, TILE_VISIBLE };

/** A tile's drawn box: the 64x32 diamond plus its shared right and bottom edge pixel (a slope's box is 17 to 49 high). */
export const FOG_W = 65;
export const FOG_H = 33;

/** Rows of tile type `type`'s box (`tilesizes[type].height` + 1). */
export function fogHeight(type: number): number {
  return tileBoxHeight(type) + 1;
}

/**
 * `EdgeNumber` (`Init_Tile_Edge_Tables`, src/view.cpp:338-384): the 8 neighbour bits (0x80 up, 0x40 right, 0x20 down,
 * 0x10 left, 0x08 up-right, 0x04 down-right, 0x02 down-left, 0x01 up-left, in map rows and columns) to one of 47 edges.
 * A corner bit next to a set side bit adds nothing, so those masks share the number of the mask without it.
 */
export const EDGE_NUMBER: Uint8Array = (() => {
  const edge = new Uint8Array(256).fill(0xff);
  const covered = (i: number) => {
    let m = i;
    if (i & 0x80) m &= ~(0x01 | 0x08);
    if (i & 0x40) m &= ~(0x04 | 0x08);
    if (i & 0x20) m &= ~(0x02 | 0x04);
    if (i & 0x10) m &= ~(0x01 | 0x02);
    return m;
  };
  let count = 0;
  for (let i = 0; i < 256; i++) if (covered(i) === i) edge[i] = count++;
  for (let i = 0; i < 256; i++) if (edge[i] === 0xff) edge[i] = edge[covered(i)]!;
  return edge;
})();

/**
 * `get_tile_mask_num` (src/view.cpp:2799): the edge number of tile (col, row) from which of its 8 neighbours fail
 * `seen` (off the map counts as seen).
 */
export function edgeNumber(seen: (col: number, row: number) => boolean, col: number, row: number, width: number, height: number): number {
  const no = (c: number, r: number) => c >= 0 && r >= 0 && c < width && r < height && !seen(c, r);
  let mask = 0;
  if (no(col, row - 1)) mask |= 0x80;
  if (no(col + 1, row)) mask |= 0x40;
  if (no(col, row + 1)) mask |= 0x20;
  if (no(col - 1, row)) mask |= 0x10;
  if (no(col + 1, row - 1)) mask |= 0x08;
  if (no(col + 1, row + 1)) mask |= 0x04;
  if (no(col - 1, row + 1)) mask |= 0x02;
  if (no(col - 1, row - 1)) mask |= 0x01;
  return EDGE_NUMBER[mask]!;
}

/** The rows of tile type `type`'s outline (`tileCorners`) as spans, as the edge files' edge 0 holds them. */
export function tileSpans(type: number): TileSpan[] {
  const corners = tileCorners(type);
  const order = [corners[0]!, corners[1]!, corners[3]!, corners[2]!];
  return Array.from({ length: fogHeight(type) }, (_, dy): TileSpan => {
    let x0 = Infinity;
    let x1 = -Infinity;
    order.forEach(([ax, ay], i) => {
      const [bx, by] = order[(i + 1) % 4]!;
      if (dy < Math.min(ay, by) || dy > Math.max(ay, by)) return;
      const xs = ay === by ? [ax, bx] : [ax + ((bx - ax) * (dy - ay)) / (by - ay)];
      for (const x of xs) [x0, x1] = [Math.min(x0, Math.round(x)), Math.max(x1, Math.round(x))];
    });
    return [dy, x0, x1];
  });
}

/** Edge spans without a pack, per tile type: every edge draws the whole tile plain and leaves nothing black. */
export const PLAIN_EDGES: readonly PackTileEdges[] = Array.from({ length: TILE_TYPES }, (_, type) => {
  const whole = tileSpans(type);
  const none = Array.from({ length: 47 }, (): TileSpan[] => []);
  return { normal: none.map(() => whole), fog: none, black: none };
});

/**
 * The fog over one tile, `draw_this_tile`'s masks (src/view.cpp:2012-2110): a visible tile draws its `normal_draw`
 * plain and its `fog_draw` fogged by the edge of its non-visible neighbours; a fogged tile draws all of edge 0 fogged;
 * either leaves its `black_UNdraw` (by the edge of its unexplored neighbours) undrawn, so black. Fogged pixels are the
 * black dots of the shadowing mask (0x00FF00FF / 0xFF00FF00 on alternate rows, `ASMSet_Shadowing`, src/drawarea.cpp:67):
 * a pixel is black where `x + y + parity` is odd, x and y from the tile box's top left.
 * An unexplored tile is all black (its terrain is not drawn, so the objects of draw level 5 or lower under the overlay
 * do not show there either: `RGE_View::draw` clips them to the terrain, src/view.cpp:2335-2377). Its edge-0 diamond
 * only overlaps a neighbour's pixels that the neighbour's own `black_UNdraw` already leaves black.
 * `edges` are the tile type's tables (`Tile_Edge_Tables[tile_type]`, src/view.cpp:2013), whose box is `height` rows.
 * Returns the alpha of black over each pixel of the 65-wide box (row major), or null when the tile has no fog.
 */
export function fogPixels(edges: PackTileEdges, state: number, visibleEdge: number, exploredEdge: number, parity: number, height = FOG_H): Uint8Array | null {
  const unexplored = state === TILE_BLACK;
  const fog = unexplored ? [] : state === TILE_VISIBLE ? edges.fog[visibleEdge]! : edges.normal[0]!;
  const normal = state === TILE_VISIBLE ? edges.normal[visibleEdge]! : [];
  const black = unexplored ? edges.normal[0]! : exploredEdge > 0 ? edges.black[exploredEdge]! : [];
  if (fog.length === 0 && black.length === 0) return null;
  const out = new Uint8Array(FOG_W * height);
  const each = (spans: TileSpan[], fn: (i: number, x: number, y: number) => void) => {
    for (const [y, x0, x1] of spans) {
      if (y >= height) continue;
      for (let x = Math.max(0, x0); x <= Math.min(FOG_W - 1, x1); x++) fn(y * FOG_W + x, x, y);
    }
  };
  // The fogged pass draws first and the plain one over it (`draw_terrain_shape`); black is taken out of both.
  each(fog, (i, x, y) => (out[i] = (x + y + parity) & 1 ? 255 : 0));
  each(normal, (i) => (out[i] = 0));
  each(black, (i) => (out[i] = 255));
  return out;
}
