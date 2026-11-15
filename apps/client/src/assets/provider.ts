import type { Texture } from 'pixi.js';
import type { PackMinimap, PackScreen, PackTileEdges } from '@aoe/assets-import/manifest';

export interface SpriteFrame {
  texture: Texture;
  /** Pixel inside the frame that sits on the object's map position. */
  hotspotX: number;
  hotspotY: number;
  /** A baked composite frame's parts, each picked on its own as the original does; absent for a plain frame. */
  parts?: FramePart[];
}

/** One drawn part of a baked frame: its own frame's texture, where its left and top edges lie in the baked texture. */
export interface FramePart {
  texture: Texture;
  x: number;
  y: number;
  /** Drawn mirrored: baked column `x + width - 1` shows the texture's column 0. */
  flipped: boolean;
  /** The part graphic's `draw_level`. */
  layer: number;
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
  /** `draw_level` (the dat's layer): at 10 or below the graphic draws at the object's shadow point, on the ground. */
  layer: number;
  /** Parts drawn instead of the graphic's own frames (`RGE_Sprite::draw_list`); empty for a plain graphic. */
  deltas: GraphicDelta[];
}

/** One part of a composite graphic: another graphic's frame at an offset (graphic -1: this graphic's own SLP). */
export interface GraphicDelta {
  graphic: number;
  offsetX: number;
  offsetY: number;
  /** The only angle the part shows at; -1 every angle. */
  angle: number;
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
  /** `button_location` in the command grid (1-20); 0 none. */
  button: number;
  /** `outline_radius_x/y/z` in tiles. */
  outline: [number, number, number];
  /** `string_id`: the name in the language strings; 0 or less, none. */
  nameId: number;
  /** `string_id2`: the train or build button's text. */
  creationId: number;
  /** `hotkey_id`: the string id of the key that trains or builds it; 0 or less, none. */
  hotkeyId: number;
  /** `unit_level` (the dat's interface kind): 2 building, 3 villager, 4 soldier, ... */
  level: number;
  /** `orig_weapon`, `orig_armor`, `orig_pierce_armor`, `orig_weapon_range`: the object panel's base values. */
  displayed: [number, number, number, number];
  /** `select_level` (the dat's interaction mode): a left click selects from 2 up, a selection box takes 4 (units). */
  selectLevel: number;
}

/** What the research buttons read about a tech from the dat. */
export interface TechInfo {
  /** The dat's internal name. */
  name: string;
  /** `string_id`: the name in the language strings; 0 or less, none. */
  nameId: number;
  /** `string_id2`: the research button's text. */
  creationId: number;
  /** `icon`: frame of the tech's button in btntech; -1 none. */
  icon: number;
  /** `button_location` in the command grid (1-20); 0 none. */
  button: number;
}

/** What the fog and the minimap read from the pack (pack version 8; docs/spec/hud.md "Fog of war", "Minimap"). */
export interface MapArt {
  /** Colour of palette 50500 index `index`, as 0xRRGGBB. */
  rgb(index: number): number;
  /** `map_hi_color`, `map_med_color`, `map_low_color` of a terrain (palette indices); null when unknown. */
  terrainColours(terrainId: number): readonly [number, number, number] | null;
  /** `map_draw_level` and `map_color` of a unit (the first playable civ's record, Gaia's for its own); null when unknown. */
  unitMinimap(unitId: number): readonly [number, number] | null;
  /** `create_doppleganger_on_death` of a unit; 0 when unknown. */
  doppelganger(unitId: number): number;
  /** `map_color` of player `player`'s colour table (player n uses table n - 1); null when unknown. */
  playerColour(player: number): number | null;
  /** map.bmp's lines; null when the pack has none. */
  readonly minimap: PackMinimap | null;
  /** The fog edge spans of each tile type (0-16); null when the pack has none. */
  readonly tileEdges: readonly PackTileEdges[] | null;
}

/** What the sounds read from the pack (pack version 9; docs/spec/sounds.md). */
export interface SoundTable {
  /** `[wav resource id, percent]` of each wav of dat sound `id`; null when unknown. */
  sound(id: number): readonly (readonly [number, number])[] | null;
  /** A unit's `[selected, created, death, command, move, construction]` dat sound ids; null when unknown. */
  unitSounds(unitId: number): readonly number[] | null;
  /** A graphic's `main_sound` and per-facet `[frame, sound]` lists; null when unknown. */
  graphicSounds(graphicId: number): { sound: number; frameSounds: readonly (readonly (readonly [number, number])[])[] | null } | null;
  /** URL of wav resource `id`; null when the pack does not have it. */
  wavUrl(id: number): string | null;
}

/**
 * A terrain's tile pictures: flat-tile variants form a `rows` x `cols` grid; `tiles[type]` is `[count, animations,
 * shapeIndex]` per tile type (slopes), and an entry it lacks is the flat tile's.
 */
export interface TerrainLayout {
  rows: number;
  cols: number;
  tiles: readonly (readonly [number, number, number])[];
}

/** How a terrain is drawn (pack version 13): `terrain_to_draw` (-1: its own art) and its border per neighbouring terrain. */
export interface TerrainRules {
  draw: number;
  borders: readonly number[];
}

/**
 * A border between terrains (`RGE_Border_Set`): `style` 0 one picture per tile, 1 edge pictures over the terrain;
 * `drawTile` whether a style 0 picture has the terrain drawn under it; `pictures[type][shape - 1]` is `[count,
 * animations, shapeIndex]`.
 */
export interface BorderLayout {
  style: number;
  drawTile: number;
  pictures: readonly (readonly (readonly [number, number, number])[])[];
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
  /** Dat numbers of a tech; null when unknown. */
  techInfo(techId: number): TechInfo | null;
  /** Text of a language string id (language.dll, languagex.dll over it); null when the pack has none. */
  string(id: number): string | null;
  /** Palette, minimap colours and shape and fog edges; null without a pack. */
  mapArt(): MapArt | null;
  /** Where a terrain's tile pictures are in its frames (RGE_View::get_tile_picture). */
  terrainLayout(terrainId: number): TerrainLayout;
  /** `terrain_to_draw` and the border table of a terrain; null without a pack. */
  terrainRules(terrainId: number): TerrainRules | null;
  /** A loaded border (enabled, its SLP in the pack); null when unknown. */
  border(borderId: number): BorderLayout | null;
  /** Every frame of a border's SLP. */
  borderFrames(borderId: number): Promise<SpriteFrame[]>;
  /** The dat's sounds and the wavs; null without a pack. */
  soundTable(): SoundTable | null;
  /** The look of a screen or dialog by its info file's interfac.drs id (pack version 11); null when unknown. */
  screen(id: number): PackScreen | null;
}
