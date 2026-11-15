/** What a digit key does with a numbered group (`TRIBE_Screen_Game::key_down_action`, src/scr_game.cpp:1466-1545, :1778-1793). */
export interface GroupKey {
  /** The group, 1-10 (digit 0 is group 10: `command_group_by_number`, `command_select_group`). */
  id: number;
  /** `assign`: Ctrl+digit puts the selected own objects in the group; `select`: the group becomes the selection. */
  action: 'assign' | 'select';
  /** Shift+digit adds the group to the selection instead of replacing it (`command_select_group(id, 0)`). */
  add: boolean;
  /** Alt+digit also scrolls the view to `selected_obj` (`command_view_selected`). */
  centre: boolean;
}

/**
 * The group command of a key press, or null. The original tests Ctrl first, then Shift, then Alt, and takes the
 * first that is held; it reads the virtual key '0'-'9', which is the digit row (`code` `Digit0`-`Digit9`), not the numpad.
 */
export function groupKey(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey'>): GroupKey | null {
  const digit = /^Digit([0-9])$/.exec(e.code)?.[1];
  if (digit === undefined) return null;
  const id = digit === '0' ? 10 : Number(digit);
  if (e.ctrlKey) return { id, action: 'assign', add: false, centre: false };
  if (e.shiftKey) return { id, action: 'select', add: true, centre: false };
  if (e.altKey) return { id, action: 'select', add: false, centre: true };
  return { id, action: 'select', add: false, centre: false };
}
