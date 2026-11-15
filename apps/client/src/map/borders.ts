// Terrain borders (shores, grass into desert) as the original draws them (docs/spec/hud.md "Terrain art and borders"):
// each tile's border type and shape from its neighbours' terrains, and the border pictures `draw_tile` draws for it.
import type { TileMap } from '@aoe/sim';
import type { BorderLayout, TerrainRules } from '../assets/provider';

/** Border slots in the dat's terrain block (`border_types[16]`). */
const BORDER_SLOTS = 16;
/** Shapes per tile type in a border's pictures (`RGE_Border_Set::borders[19][12]`). */
const SHAPES = 12;

/** Every tile's `border_type` (0: none) and `border_shape`, as `RGE_Map::get_border_type` leaves them. */
export interface TileBorders {
  type: Uint8Array;
  shape: Uint8Array;
}

/**
 * `RGE_Map::get_border_type` (src/map.cpp:2367) for every tile: the first neighbour of another terrain that the tile's
 * terrain has a loaded border against (top, bottom, left, right, then the corners) picks the border; its shape is which
 * sides (style 1: a bit per side) or which side or corner (style 0: 1-12) touch terrains with that same border.
 */
export function tileBorders(map: TileMap, rules: (terrain: number) => TerrainRules | null, loaded: (border: number) => BorderLayout | null): TileBorders {
  const { width, height } = map;
  const type = new Uint8Array(width * height);
  const shape = new Uint8Array(width * height);
  const terrainAt = (col: number, row: number, cur: number) =>
    col < 0 || row < 0 || col >= width || row >= height ? cur : map.terrain[row * width + col]! & 0x1f;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cur = map.terrain[row * width + col]! & 0x1f;
      const table = rules(cur)?.borders;
      if (!table) continue;
      const usable = (border: number | undefined): border is number => border !== undefined && border >= 0 && border < BORDER_SLOTS && loaded(border) !== null;
      // `check_for_border`: a neighbour this terrain has no border against counts as this terrain.
      const near = (dc: number, dr: number) => {
        const t = terrainAt(col + dc, row + dr, cur);
        return t === cur || usable(table[t]) ? t : cur;
      };
      const top = near(0, -1);
      const bot = near(0, 1);
      const lft = near(-1, 0);
      const rgt = near(1, 0);
      const topLft = near(-1, -1);
      const topRgt = near(1, -1);
      const botLft = near(-1, 1);
      const botRgt = near(1, 1);
      const other = [top, bot, lft, rgt, topLft, topRgt, botLft, botRgt].find((t) => t !== cur);
      if (other === undefined) continue;
      const border = table[other];
      if (!usable(border)) continue;
      const is = (t: number) => table[t] === border;
      let edge: number;
      if (loaded(border)!.style === 1) {
        edge = (is(top) ? 1 : 0) + (is(bot) ? 2 : 0) + (is(lft) ? 4 : 0) + (is(rgt) ? 8 : 0);
      } else if (is(top) && is(lft)) edge = 1;
      else if (is(top) && is(rgt)) edge = 2;
      else if (is(bot) && is(lft)) edge = 3;
      else if (is(bot) && is(rgt)) edge = 4;
      else if (is(top)) edge = 9;
      else if (is(bot)) edge = 10;
      else if (is(lft)) edge = 11;
      else if (is(rgt)) edge = 12;
      else if (is(topLft)) edge = 5;
      else if (is(topRgt)) edge = 6;
      else if (is(botLft)) edge = 7;
      else if (is(botRgt)) edge = 8;
      else continue;
      type[row * width + col] = border;
      shape[row * width + col] = edge;
    }
  }
  return { type, shape };
}

/**
 * `RGE_View::get_border_picture` (src/view.cpp:3563): the frame of shape `shape` on tile type `tileType`, -1 when the
 * border has none. The dat's `borders[tile_type - 1][shape + 11]` is entry `tileType * 12 + shape - 1` of the table.
 */
export function borderPicture(layout: BorderLayout, tileType: number, shape: number, col: number, row: number): number {
  const flat = tileType * SHAPES + shape - 1;
  const entry = layout.pictures[Math.floor(flat / SHAPES)]?.[flat % SHAPES];
  if (!entry || entry[0] === 0) return -1;
  const [count, animations, shapeIndex] = entry;
  let variant = 0;
  if (count > 1) {
    const s = layout.style;
    if ((s === 0 && (shape === 11 || shape === 12)) || (s === 1 && (shape === 3 || shape === 2))) variant = row % count;
    else if ((s === 0 && (shape === 9 || shape === 10)) || (s === 1 && (shape === 1 || shape === 4))) variant = col % count;
  }
  if (variant > count - 1) variant = 0;
  return animations * variant + shapeIndex;
}

/** What `draw_tile` draws on a tile: whether its terrain picture, and the border frames over it in draw order. */
export interface TileDraw {
  terrain: boolean;
  borders: number[];
}

/**
 * `RGE_View::draw_tile` (src/view.cpp:2845): a style 0 border draws its one picture, over the terrain only when the
 * border's `draw_tile` says so; a style 1 border draws the terrain and then the edge pictures of the sides its shape
 * names (`get_border_edge_pictures`, view.cpp:3593, in draw order: top 1, left 3, right 2, bottom 4). Without a border
 * picture for the tile's type the terrain is drawn alone.
 */
export function tileDraw(layout: BorderLayout | null, tileType: number, shape: number, col: number, row: number): TileDraw {
  if (!layout || shape === 0) return { terrain: true, borders: [] };
  if (layout.style === 0) {
    const frame = borderPicture(layout, tileType, shape, col, row);
    return frame === -1 ? { terrain: true, borders: [] } : { terrain: layout.drawTile !== 0, borders: [frame] };
  }
  const borders: number[] = [];
  for (const [bit, side] of [[1, 1], [4, 3], [8, 2], [2, 4]] as const) {
    if (!(shape & bit)) continue;
    const frame = borderPicture(layout, tileType, side, col, row);
    if (frame !== -1) borders.push(frame);
  }
  return { terrain: true, borders };
}
