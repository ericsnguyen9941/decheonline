// Which sound the original plays for what (docs/spec/sounds.md): the dat sound of a master's slot, a sprite's frame
// sounds, and the game's own wavs. Pure functions over the pack's sound table, so the mapping is testable without audio.
import type { SoundTable } from '../assets';

/** Slots of a master's sounds in `SoundTable.unitSounds`. */
export const UnitSound = {
  /** `selected_sound`: an own or Gaia object selected with a click (`RGE_Player::select_one_object`, play_sound 1). */
  Selected: 0,
  /** `created_sound` (the dat's train sound): an own object made (`RGE_Static_Object::init`, src/stat_obj.cpp:173). */
  Created: 1,
  /** `death_sound`: an own object starts dying (src/stat_obj.cpp:1196). */
  Death: 2,
  /** `command_sound` (the dat's attack sound): an order acknowledged (`RGE_Master_Action_Object::play_command_sound`). */
  Command: 3,
  /** `move_sound`: a move order acknowledged (`RGE_Player::command_make_move`, src/player.cpp:1772). */
  Move: 4,
  /** `construction_sound`: an own building finished (`TRIBE_Building_Object::set_object_state`, src/t_b_obj.cpp:239). */
  Construction: 5,
} as const;
export type UnitSound = (typeof UnitSound)[keyof typeof UnitSound];

/** `TRIBE_Game::sounds` indices (src/tribegam.cpp:646-682); the wav is `GAME_SOUND_IDS[index]`. */
export const GameSound = {
  /** button2.wav: the game screen's buttons (`TRIBE_Screen_Game` makes them with `get_sound(1)`, src/scr_game.cpp:227). */
  Button: 1,
  /** cantdo.wav: an order mode's click on nothing it can take (`error_a`, src/tvw_main.cpp:420), and a refusal the game tells (`CANT_DO_NOTIFICATIONS`). */
  CantDo: 3,
  /**
   * convwarn.wav: one of the player's objects was converted by another player (`GAME_NOTIFY_CONVERSION_SUCCEEDED`,
   * src/tribegam.cpp:2134-2138; the converter hears nothing, convdone.wav (14) is never played).
   */
  Converted: 13,
  /** resdone.wav: an age reached (`TRIBE_Game::notification`, research completed, tech 101-103). */
  AgeDone: 5,
  /** res.wav: any other research completed. */
  ResearchDone: 15,
  /** farmdie.wav: an own Farm used up (`GAME_NOTIFY_OBJECT_DEPLETED`, src/tribegam.cpp:1728-1733). */
  FarmDied: 16,
} as const;

/** Tool, Bronze and Iron Age: their completion plays `GameSound.AgeDone` (src/tribegam.cpp:1753). */
export const AGE_TECHS: ReadonlySet<number> = new Set([101, 102, 103]);
/** `PLAYER_ATTRIBUTE_ATTACK_WARNING_SOUND`: the world sound of the under-attack alert (include/player.h:43). */
export const ATTR_ATTACK_WARNING_SOUND = 26;

/**
 * `RGE_Sound::play`'s pick (src/Sound.cpp:146-190): `rand * 100 / 0x7fff` (integer), then each wav's percent off in
 * turn; the first that takes it to 0 or below plays. Null when the percents run out first (nothing plays).
 */
export function pickWav(items: readonly (readonly [number, number])[], rand: number): number | null {
  const i = pickItem(items, rand);
  return i === null ? null : items[i]![0];
}

/** `pickWav`'s pick as an index into `items` (`RGE_Sound::get_file_name` picks a file name the same way, src/Sound.cpp:192). */
export function pickItem(items: readonly (readonly [number, number])[], rand: number): number | null {
  let r = Math.trunc((rand * 100) / 0x7fff);
  for (let i = 0; i < items.length; i++) {
    r -= items[i]![1];
    if (r <= 0) return i;
  }
  return null;
}

/**
 * `TRIBE_Screen_Game::handle_terrain_sound` (src/scr_game.cpp:3571-3633): every `TERRAIN_SOUND_INTERVAL` ms, the sound of
 * the terrain with the most tiles drawn plays as a stream; it is checked every `TERRAIN_SOUND_CHECK` ms and cut once
 * it has played `TERRAIN_SOUND_LENGTH` ms. The interval counts from the last check.
 */
export const TERRAIN_SOUND_INTERVAL = 20000;
export const TERRAIN_SOUND_CHECK = 1000;
export const TERRAIN_SOUND_LENGTH = 6000;

/**
 * The terrain sound of the view (`handle_terrain_sound`): of the terrains with a sound, the one with the most tiles
 * drawn (`drawn`, by terrain id), the lowest id on a tie; -1 when no drawn terrain has one.
 */
export function terrainSound(table: SoundTable, drawn: ReadonlyMap<number, number>): number {
  let best = -1;
  let bestDrawn = 0;
  for (const id of [...drawn.keys()].sort((a, b) => a - b)) {
    const count = drawn.get(id)!;
    const sound = table.terrainSound(id);
    if (count > bestDrawn && sound >= 0) {
      best = sound;
      bestDrawn = count;
    }
  }
  return best;
}

/** Dat sound id in slot `slot` of master `unit`'s sounds, or -1. */
export function unitSound(table: SoundTable, unit: number, slot: UnitSound): number {
  return table.unitSounds(unit)?.[slot] ?? -1;
}

/**
 * `RGE_Player::select_one_object` with play_sound (src/player.cpp:1359-1364): the object's `selected_sound` when the
 * player or Gaia owns it; another player's object is selected without a sound.
 */
export function selectSound(table: SoundTable, unit: number, owner: number, player: number): number {
  return owner === player || owner === 0 ? unitSound(table, unit, UnitSound.Selected) : -1;
}

/**
 * The dat sounds a sprite plays when its drawn frame goes from `from` to `to` (`RGE_Sprite::play_sound`,
 * src/sprite.cpp:372-409): its main sound on leaving frame 0 or wrapping past the end (not onto frame 0), and the
 * facet's frame sounds whose frame was passed: `[from, to)`, or across the wrap.
 */
export function spriteSounds(table: SoundTable, graphic: number, from: number, to: number, facet: number): number[] {
  const g = table.graphicSounds(graphic);
  if (!g || from === to) return [];
  const out: number[] = [];
  if (g.sound >= 0 && (from === 0 || (to < from && to !== 0))) out.push(g.sound);
  const facets = g.frameSounds;
  if (facets && facets.length > 0) {
    for (const [frame, sound] of facets[facet < facets.length ? facet : 0]!) {
      const passed = from < to ? frame >= from && frame < to : frame >= from || frame < to;
      if (passed && sound >= 0) out.push(sound);
    }
  }
  return out;
}

/** Does graphic `graphic` play any sound? (Saves the on-screen test for the many that do not.) */
export function hasSpriteSounds(table: SoundTable, graphic: number): boolean {
  const g = table.graphicSounds(graphic);
  return !!g && (g.sound >= 0 || (g.frameSounds?.some((f) => f.length > 0) ?? false));
}

/** The game sound a completed research plays (`GAME_NOTIFY_RESEARCH_COMPLETED`, src/tribegam.cpp:1751-1761). */
export function researchSound(tech: number): number {
  return AGE_TECHS.has(tech) ? GameSound.AgeDone : GameSound.ResearchDone;
}

/**
 * `TTaunt::GetTauntNo` (src/taunt.cpp): a chat line's taunt number, `atoi` of the text after an optional "!"; 0 (none)
 * for a line that does not start with a number or for one above 999.
 */
export function tauntNumber(text: string): number {
  // `atoi`: leading white space, a sign, digits.
  const m = /^[ \t\n\v\f\r]*([+-]?)(\d+)/.exec(text.startsWith('!') ? text.slice(1) : text);
  if (!m) return 0;
  const value = Number(m[2]!.slice(0, 10)) * (m[1] === '-' ? -1 : 1);
  return value > 999 ? 0 : value;
}
