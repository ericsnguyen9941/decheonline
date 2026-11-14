// The asset pack written by `npm run assets:import` and read by the client. Types only plus
// the path helper both sides share, so the client can import this file without Node.

export const PACK_VERSION = 1;

/** Which DRS archive an SLP came from. `data2` archives (Rise of Rome) merge into the same name. */
export type SlpSource = 'graphics' | 'terrain' | 'border';

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
}

export interface PackTerrain {
  name: string;
  slp: string | null;
}

export interface PackUnit {
  name: string;
  standingGraphic: number;
}

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
  /** Keyed by unit id; the first playable civ's table (the sprites are shared across civs). */
  units: Record<string, PackUnit>;
}

export const slpKey = (source: SlpSource, id: number): string => `${source}/${id}`;

/** Pack-relative path of an SLP atlas image; `owner` is required exactly when the SLP has player colour. */
export function slpImagePath(slp: Pick<PackSlp, 'source' | 'id' | 'playerColour'>, owner = 1): string {
  return slp.playerColour
    ? `sprites/${slp.source}/${slp.id}.o${owner}.png`
    : `sprites/${slp.source}/${slp.id}.png`;
}
