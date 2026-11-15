// The letters of the original's hotkeys. `TRIBE_Screen_Game` reads them from the language strings (`*get_string(id)`, the
// first character as a virtual key code, i.e. the upper case letter): the grid commands' ids are `STRING_ID_HOTKEY_*`
// (include/resource_ids.h:712), a unit's or building's is its dat `hotkey_id` (src/scr_game.cpp:3085 `set_button`).
import { master, type World } from '@aoe/sim';
import type { AssetProvider } from '../assets';
import type { CommandButton } from './commands';
import { infoOf } from './records';

/** `STRING_ID_HOTKEY_*`: the command buttons' key strings, and the bases of the select-building and view keys. */
export const HOTKEY_STRING = {
  build: 0x1037,
  stop: 0x1038,
  group: 0x1039,
  ungroup: 0x103a,
  more: 0x103b,
  'stand-ground': 0x103d,
  viewTownCenter: 0x103f,
  /** `STRING_ID_HOTKEY_SELECT_BUILDING_BASE` + 0..7. */
  selectBuilding: 0x1040,
  move: 0x104a,
  repair: 0x104d,
} as const;

/** The key a string names: its first character in upper case (`*get_string(id)`); null for an id with no text. */
export function hotkeyLetter(provider: AssetProvider, id: number): string | null {
  if (id <= 0) return null;
  const letter = provider.string(id)?.charAt(0).toUpperCase();
  return letter ? letter : null;
}

/** The character key of a key press as the original reads it (a letter's virtual key is its upper case); null for any other key. */
export function pressedLetter(e: Pick<KeyboardEvent, 'key'>): string | null {
  return e.key.length === 1 ? e.key.toUpperCase() : null;
}

/**
 * The key of a grid button (`TRIBE_Screen_Game::set_button`): the command's `STRING_ID_HOTKEY_*`, or for a unit or
 * building the master's `hotkey_id`. Research and Cancel Construction have none (the dat's tech `hotkey_id` is 0 for
 * all of them; the call passes 0); Cancel and Unselect are Esc (`VK_ESCAPE`), handled apart.
 */
export function buttonLetter(provider: AssetProvider, b: CommandButton, world: World, player: number): string | null {
  switch (b.kind) {
    case 'build':
    case 'stop':
    case 'group':
    case 'ungroup':
    case 'more':
    case 'stand-ground':
    case 'repair':
      return hotkeyLetter(provider, HOTKEY_STRING[b.kind]);
    case 'place':
    case 'train':
      return unitLetter(provider, world, player, b.unit);
    default:
      return null;
  }
}

/** The key that builds or trains master `unit` of `player` (`master->hotkey_id`). */
export function unitLetter(provider: AssetProvider, world: World, player: number, unit: number): string | null {
  const info = infoOf(provider, master(world, player, unit));
  return info ? hotkeyLetter(provider, info.hotkeyId) : null;
}
