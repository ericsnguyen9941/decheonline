import type { UnitType } from '@aoe/sim';

/**
 * `tribe_group_properties` (src/tplayer.cpp:176) bit 1, read by `TRIBE_Player::analyize_selected_objects`: own object
 * groups whose selection can attack. Towers (69, 79, 199, 278) add the bit by master id.
 */
const ATTACKER_GROUPS = new Set([0, 4, 6, 12, 13, 22, 23, 24, 25, 26, 28, 35, 36, 39]);
const TOWERS = new Set([69, 79, 199, 278]);

/**
 * Object groups whose enemy action in the right-click tables (`Tribe1btn`/`Tribe2btnMouseRightClickTable`,
 * src/game_globals.cpp:696, :762; both agree on the actions) is 1 or 8: the attack cursor (`mcursors` facet 4).
 */
const ATTACKABLE_GROUPS = new Set([0, 2, 3, 4, 6, 12, 13, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 35, 36, 39]);

/** Frame of mcursors.slp shown over an object the selection can attack (`get_mouse_pointer_action_vars` facet 4). */
export const ATTACK_CURSOR_FRAME = 4;

/** Can a selection holding an own object of type `t` attack (`sel_object_properties & 1`)? */
export function canAttack(t: UnitType): boolean {
  return ATTACKER_GROUPS.has(t.group) || TOWERS.has(t.id);
}

/** Does the right-click table give an enemy object of type `t` the attack action? */
export function isAttackable(t: UnitType): boolean {
  return ATTACKABLE_GROUPS.has(t.group);
}
