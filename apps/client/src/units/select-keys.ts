// The selection keys of `TRIBE_Screen_Game::key_down_action` (src/scr_game.cpp:1451-1780) that are not the digit groups.

/**
 * `command_select_building(i)` (:4177): the master id the Ctrl+hotkey `i` (`select_building_hotkey[i]`, from
 * `STRING_ID_HOTKEY_SELECT_BUILDING_BASE + i`) looks for: Town Center, Barracks, Dock, Range, Siege Workshop,
 * Stable, Temple, Academy. Hotkey 0 alone (no Ctrl) is the Town Center key `view_town_center_hotkey` (:1616).
 */
export const SELECT_BUILDING_MASTERS = [0x6d, 0x0c, 0x2d, 0x57, 0x31, 0x65, 0x68, 0] as const;

/** What a key press does besides the digit groups and the grid's own buttons. */
export type SelectKey =
  /** Ctrl+hotkey `index` of the eight, or (index -1) the Town Center view key. */
  | { kind: 'building'; master: number }
  /** `command_tab_selected(forward)` (:4376): `selected_obj` steps through the selection. */
  | { kind: 'tab'; forward: boolean }
  /** `ungroup_hotkey` (:1774). */
  | { kind: 'ungroup' }
  /** `move_hotkey` (:1764): the next left click moves the selection. */
  | { kind: 'move' };

/** The letters the keys read from the language strings (upper case; null when the string is missing). */
export interface SelectLetters {
  townCenter: string | null;
  /** `select_building_hotkey[0..7]`. */
  buildings: readonly (string | null)[];
  ungroup: string | null;
  move: string | null;
}

/**
 * The selection command of a key press, or null. The original tests Shift+Tab first, then Alt (which only has the digits
 * and developer keys, so a letter with Alt does nothing), then Ctrl+hotkey, then the Town Center key (with or without Ctrl),
 * then, without Ctrl, Move and Ungroup (not in the build menu), then Tab. `letter` is the upper case character key, or null.
 * The Work and Attack keys are 0 in the original, so they bind nothing.
 */
export function selectKey(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  letter: string | null,
  letters: SelectLetters,
  buildMenu: boolean,
): SelectKey | null {
  if (e.key === 'Tab') {
    if (e.shiftKey) return { kind: 'tab', forward: false };
    return e.altKey || e.ctrlKey ? null : { kind: 'tab', forward: true };
  }
  if (e.altKey || letter === null) return null;
  if (e.ctrlKey) {
    const i = letters.buildings.indexOf(letter);
    if (i >= 0) return { kind: 'building', master: SELECT_BUILDING_MASTERS[i]! };
  }
  if (letters.townCenter === letter) return { kind: 'building', master: SELECT_BUILDING_MASTERS[0] };
  if (e.ctrlKey || buildMenu) return null;
  if (letters.move === letter) return { kind: 'move' };
  if (letters.ungroup === letter) return { kind: 'ungroup' };
  return null;
}

/**
 * `command_tab_selected` (:4376): the object `selected_obj` becomes. Needs two or more selected; forward is the next one in
 * `sel_list` order, and the first after the last (or when `current` is not in it); backward the previous one, and the
 * last before the first.
 */
export function tabTarget(order: readonly number[], current: number | null, forward: boolean): number | null {
  if (order.length < 2) return null;
  const at = current === null ? -1 : order.indexOf(current);
  if (forward) return order[at + 1] ?? order[0]!;
  return at > 0 ? order[at - 1]! : order[order.length - 1]!;
}
