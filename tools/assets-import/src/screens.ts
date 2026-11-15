// The info files of the screens and dialogs the client draws (`TEasy_Panel::setup`, src/Panel_ez.cpp:150-212): text
// `bina` resources of interfac.drs naming each one's background SLPs, palette and colours.
import type { Palette } from '@aoe/formats';
import type { PackScreen } from './manifest';

/**
 * In-game dialogs `dlg6_<culture>` (50006 + culture, src/scr_game.cpp:2163) and the achievements screens `scr7` (won),
 * `scr8` (lost) and `scr10` (during the game) (src/scr_ach.cpp:62-73).
 */
export const SCREEN_IDS = [50006, 50007, 50008, 50009, 50057, 50058, 50061] as const;

/** `viccheck.slp` and `defcheck.slp` (0xCB21, 0xCB22): the achievements screen's winner mark, drawn on `scr7` / `scr8`. */
export const DECAL_SCREENS: Record<number, number> = { 52001: 50057, 52002: 50058 };

/** One info file as read: palette indices for the colours, SLP and palette resource ids. */
export interface ScreenInfo {
  backgrounds: [number, number, number];
  palette: number;
  position: number;
  shade: number;
  backgroundColour: number;
  bevels: number[];
  text: [number, number, number][];
  focus: [number, number, number][];
  state: [number, number, number][];
}

/** Parses an info file; null when a line is missing. */
export function parseScreenInfo(bytes: Uint8Array): ScreenInfo | null {
  const lines = new Map<string, number[]>();
  for (const line of new TextDecoder('latin1').decode(bytes).split(/\r?\n/)) {
    const [key, ...rest] = line.trim().split(/\s+/);
    if (key) lines.set(key, rest.map(Number).filter((n) => !Number.isNaN(n)));
  }
  const at = (key: string, n: number): number[] | null => {
    const v = lines.get(key);
    return v && v.length >= n ? v : null;
  };
  const backgrounds = [1, 2, 3].map((i) => at(`background${i}_files`, 1)?.[0]);
  const palette = at('palette_file', 1)?.[0];
  const position = at('background_position', 1)?.[0];
  const shade = at('shade_amount', 1)?.[0];
  const backgroundColour = at('background_color', 1)?.[0];
  const bevels = at('bevel_colors', 6);
  const rgb = (key: string): [number, number, number] | null => {
    const v = at(key, 3);
    return v ? [v[0]!, v[1]!, v[2]!] : null;
  };
  const colours = ['text', 'focus', 'state'].map((k) => [rgb(`${k}_color1`), rgb(`${k}_color2`)]);
  if (backgrounds.some((b) => b === undefined) || palette === undefined || position === undefined || shade === undefined) return null;
  if (backgroundColour === undefined || !bevels || colours.flat().some((c) => c === null)) return null;
  const [text, focus, state] = colours as [number, number, number][][];
  return {
    backgrounds: backgrounds as [number, number, number],
    palette,
    position,
    shade,
    backgroundColour,
    bevels: bevels.slice(0, 6),
    text: text!,
    focus: focus!,
    state: state!,
  };
}

const hex = ([r, g, b]: readonly number[]): number => ((r! & 0xff) << 16) | ((g! & 0xff) << 8) | (b! & 0xff);

/** The info file with its palette indices as 0xRRGGBB. */
export function packScreen(info: ScreenInfo, palette: Palette): PackScreen {
  const index = (i: number) => hex([palette[i * 3]!, palette[i * 3 + 1]!, palette[i * 3 + 2]!]);
  return {
    backgrounds: info.backgrounds,
    position: info.position,
    shade: info.shade,
    background: index(info.backgroundColour),
    bevels: info.bevels.map(index),
    text: [hex(info.text[0]!), hex(info.text[1]!)],
    focus: [hex(info.focus[0]!), hex(info.focus[1]!)],
    state: [hex(info.state[0]!), hex(info.state[1]!)],
  };
}
