// The asset pack written by `npm run assets:import` and read by the client. Types only plus
// the path helper both sides share, so the client can import this file without Node.

export const PACK_VERSION = 10;

/** Which DRS archive an SLP came from. `data2` archives (Rise of Rome) merge into the same name. */
export type SlpSource = 'graphics' | 'terrain' | 'border' | 'interface';

/** Owners with a recoloured image: 1 = blue ... 8 = orange (palette 50500 ramps). */
export const PLAYER_OWNERS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export interface PackFrame {
  /** Rectangle in the atlas image. */
  x: number;
  y: number;
  w: number;
  h: number;
  hotspotX: number;
  hotspotY: number;
}

export interface PackSlp {
  source: SlpSource;
  /** Resource id inside the DRS. */
  id: number;
  atlasWidth: number;
  atlasHeight: number;
  frames: PackFrame[];
  /** True when the SLP has player-colour pixels: one image per owner in PLAYER_OWNERS, not one shared image. */
  playerColour: boolean;
}

export interface PackGraphic {
  name: string;
  /** Key into `slps`; null when the dat names no SLP or the install does not contain it. */
  slp: string | null;
  frameCount: number;
  angleCount: number;
  mirroringMode: number;
  frameDuration: number;
  /** `draw_level` (the dat's layer): parts at 10 or below draw at the object's shadow point, on the ground (`RGE_Sprite::draw`). */
  layer: number;
  /**
   * The draw list (`RGE_Sprite::draw_list`): `[graphic, offsetX, offsetY, angle]` per part, drawn in order instead of
   * the graphic's own SLP; graphic -1 is the graphic itself, angle -1 shows the part at every angle. Empty: just the SLP.
   */
  deltas: [number, number, number, number][];
  /** `main_sound`: the dat sound played as the animation leaves frame 0 or wraps (`RGE_Sprite::play_sound`); -1 none. */
  sound: number;
  /** The per-facet frame sounds (`sound_list`): `[frame, sound]` pairs, at most 3 per facet; null when it has none. */
  frameSounds: [number, number][][] | null;
}

export interface PackTerrain {
  name: string;
  slp: string | null;
  /**
   * Flat-tile variants form a `rows` x `cols` grid at the start of the SLP; the tile at map row r, column c
   * uses frame `(r % rows) * cols + (c % cols)` (RGE_View::get_tile_picture, src/view.cpp:3535).
   */
  rows: number;
  cols: number;
  /** `map_hi_color`, `map_med_color`, `map_low_color`: the minimap's palette indices (a flat tile uses the middle one). */
  minimap: [number, number, number];
}

export interface PackUnit {
  name: string;
  standingGraphic: number;
  /** `button_pict`: frame of the unit's icon in btnunit.shp (interface SLP 50730), or in btnbldg for buildings; -1 none. */
  icon: number;
  /** Hit points of the object when new (the panel's `x/y`). */
  hitPoints: number;
  /** `button_location`: where its train or build button sits in the command grid (1-5, 6-10 first page; 11-20 second); 0 none. */
  button: number;
  /** `outline_radius_x/y/z`: the selection diamond, in tiles (z: height of the health bar). */
  outline: [number, number, number];
  /** `string_id`: the name's id in the language strings (`PackManifest.strings`); 0 or less: use `name`. */
  nameId: number;
  /** `string_id2`: the train or build button's text ("Create Villager (C)"). */
  creationId: number;
  /** `hotkey_id`: the string id of the key that trains or builds it (`PackManifest.strings`; its first letter); 0 or less: none (pack version 10). */
  hotkeyId: number;
  /** `unit_level` (the dat's interface kind): which rows the object panel shows (2 building, 3 villager, 4 soldier...). */
  level: number;
  /** `orig_weapon`, `orig_armor`, `orig_pierce_armor`, `orig_weapon_range`: the panel's base values; zeros without combat. */
  displayed: [number, number, number, number];
  /** `select_level` (the dat's interaction mode): a click selects from 2 up, a box only 4 (units). */
  selectLevel: number;
  /** `map_draw_level` (the dat's minimap mode: 0 none, 1 a 3x3 square, 2 a cross in the owner's colour, 3 a cross in `map_color`, 4 tints its tiles) and `map_color` (a palette index). */
  minimap: [number, number];
  /** `create_doppleganger_on_death`: 1 remembered when removed unseen, 2 when it dies unseen (trees). */
  doppelganger: number;
}

export interface PackTech {
  name: string;
  /** `string_id`: the tech's name in the language strings; 0 or less: use `name`. */
  nameId: number;
  /** `string_id2`: the research button's text ("Research Tool Age (T)"). */
  creationId: number;
  /** `icon`: frame of the tech's button in btntech.shp (interface SLP 50729); -1 none. */
  icon: number;
  /** `button_location`: where its research button sits in the command grid (1-20); 0 none. */
  button: number;
}

/** `(Y_delta, X_start, X_end)`: one row of pixels from the top-left of a tile's 65x33 box, ends included. */
export type TileSpan = [number, number, number];

/** The flat tile's fog edge spans by edge number (47 each; docs/spec/hud.md "Fog of war"). */
export interface PackTileEdges {
  /** TILEEDGE.DAT `normal_draw`: the part of a visible tile drawn plain. */
  normal: TileSpan[][];
  /** TILEEDGE.DAT `fog_draw`: the part of a visible tile drawn fogged, along its neighbours that are not visible. */
  fog: TileSpan[][];
  /** BLKEDGE.DAT `black_UNdraw`: the part of a tile left black, along its unexplored neighbours. */
  black: TileSpan[][];
}

/** map.bmp (interfac.drs bina 50401): the minimap's lines, as `RGE_Diamond_Map::set_bitmap` reads them. */
export interface PackMinimap {
  width: number;
  height: number;
  /** `map_image_start_y`: the first picture row with a line. */
  startY: number;
  /** `[start_x, line_len]` per line, top down. */
  lines: [number, number][];
}

/** A dat sound (`RGE_Sound`): one of its wavs plays, picked at random by percent. */
export interface PackSound {
  /** `[resource id, percent]` per wav; the wav is `soundPath(id)` when `PackManifest.wavs` has the id, else silent. */
  items: [number, number][];
}

/**
 * A master's sounds, dat sound ids (-1 none): `selected_sound`, `created_sound`, `death_sound`, `command_sound`,
 * `move_sound`, `construction_sound`.
 */
export type PackUnitSounds = [number, number, number, number, number, number];

/** `TRIBE_Game::sounds` (src/tribegam.cpp:646-682): the game's own wavs by index, interfac.drs ids 50300 up. */
export const GAME_SOUND_IDS = [50300, 50301, 50302, 50303, 50304, 50305, 50306, 50307, 50308, 50309, 50310, 50311, 50312, 50313, 50314, 50315, 50316] as const;

export interface PackManifest {
  version: number;
  /** Palette 50500 of interfac.drs: `{ rgb: number[768] }`. */
  palette: string;
  /** The dat the pack was built from, copied verbatim, for the client to parse. */
  dat: string;
  /** Keyed by `slpKey(source, id)`. */
  slps: Record<string, PackSlp>;
  /** Keyed by the dat's graphic id. */
  graphics: Record<string, PackGraphic>;
  /** Keyed by the dat's terrain id. */
  terrains: Record<string, PackTerrain>;
  /** Keyed by unit id; the first playable civ's table (the sprites are shared across civs), Gaia's for the ids it lacks. */
  units: Record<string, PackUnit>;
  /** Keyed by tech id: what the research buttons show (pack version 7). */
  techs: Record<string, PackTech>;
  /** `map_color` of each player colour table (the dat's player colours, in order; player n uses n - 1): a palette index. */
  playerColours: number[];
  /** The minimap's shape; null when the install has no map.bmp. */
  minimap: PackMinimap | null;
  /** The fog's tile edges; null when the install has no TILEEDGE.DAT and BLKEDGE.DAT. */
  tileEdges: PackTileEdges | null;
  /** The game's text by string id: language.dll's string tables with languagex.dll's (Rise of Rome) over them. */
  strings: Record<string, string>;
  /** Keyed by the dat's sound id (pack version 9). */
  sounds: Record<string, PackSound>;
  /** Keyed by unit id, the same table as `units` (pack version 9). */
  unitSounds: Record<string, PackUnitSounds>;
  /** Resource ids of the wavs in the pack: sounds.drs (data2 overriding data) and interfac.drs's (pack version 9). */
  wavs: number[];
}

/** Pack-relative path of wav resource `id`. */
export const soundPath = (id: number): string => `sounds/${id}.wav`;

export const slpKey = (source: SlpSource, id: number): string => `${source}/${id}`;

/** Pack-relative path of an SLP atlas image; `owner` is required exactly when the SLP has player colour. */
export function slpImagePath(slp: Pick<PackSlp, 'source' | 'id' | 'playerColour'>, owner = 1): string {
  return slp.playerColour
    ? `sprites/${slp.source}/${slp.id}.o${owner}.png`
    : `sprites/${slp.source}/${slp.id}.png`;
}
