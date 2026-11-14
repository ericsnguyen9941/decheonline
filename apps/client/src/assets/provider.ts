import type { Texture } from 'pixi.js';

export interface SpriteFrame {
  texture: Texture;
  /** Pixel inside the frame that sits on the object's map position. */
  hotspotX: number;
  hotspotY: number;
}

/** Animation layout of a dat graphic. */
export interface GraphicInfo {
  /** Frames per angle. */
  frameCount: number;
  angleCount: number;
  /** The sprite's `mirror_flag`: 0 for none; else the stored angles are the middle ones and the rest are mirrored. */
  mirroringMode: number;
  /** Seconds per frame. */
  frameDuration: number;
}

/** A rectangle of a pack atlas image, for DOM use (CSS backgrounds, cursors). */
export interface ImageFrame {
  /** URL of the atlas PNG. */
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hotspotX: number;
  hotspotY: number;
}

/** What the HUD and the selection marker read about a unit type from the dat. */
export interface UnitInfo {
  /** `button_pict`: frame of the unit's icon (btnunit, or btnbldg for buildings); -1 none. */
  icon: number;
  hitPoints: number;
  /** `outline_radius_x/y/z` in tiles. */
  outline: [number, number, number];
}

/** Where the game's art comes from: the imported pack, or debug shapes when there is none. */
export interface AssetProvider {
  readonly kind: 'pack' | 'debug';
  /** Standing graphic id of a unit (the first playable civ's record); null when unknown. */
  unitStandingGraphic(unitId: number): number | null;
  /** Animation layout of a dat graphic; null when unknown. */
  graphicInfo(graphicId: number): GraphicInfo | null;
  /** Every frame of the SLP behind a dat graphic id; `owner` 1-8 picks the player colour. */
  graphicFrames(graphicId: number, owner?: number): Promise<SpriteFrame[]>;
  /** Every frame (tile variant) of a dat terrain's tile set. */
  terrainFrames(terrainId: number): Promise<SpriteFrame[]>;
  /** Frame `frame` of interface SLP `slp` (interfac.drs id); `owner` 1-8 picks the player colour. Null when unknown. */
  interfaceFrame(slp: number, frame: number, owner?: number): ImageFrame | null;
  /** Dat numbers of a unit type (the first playable civ's record); null when unknown. */
  unitInfo(unitId: number): UnitInfo | null;
  /** Flat-tile variants of a terrain: a `rows` x `cols` grid at the start of its frames (RGE_View::get_tile_picture). */
  terrainLayout(terrainId: number): { rows: number; cols: number };
}
