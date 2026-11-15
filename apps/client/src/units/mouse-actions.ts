import { ObjectState, type UnitType } from '@aoe/sim';

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

/** Frame of mcursors.slp shown over an object a priest selection can heal or convert (facet 5, the ring). */
export const TARGET_CURSOR_FRAME = 5;

/** The same tables' own and ally action 4 (heal, needs `sel_object_properties & 0x10`): the units. */
const HEAL_GROUPS = new Set([0, 4, 6, 12, 13, 17, 18, 23, 24, 25, 26, 28, 35, 36, 39]);
/** Gaia's action 3 (needs bit 4, which a priest gives). */
const GAIA_GROUPS = new Set([0, 1, 2, 3, 4, 6, 12, 13, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 35, 36, 39]);
/** Enemy and neutral action 8: the sword for a selection that can attack, else convert (action 7, needs bit 0x80). */
const CONVERT_GROUPS = new Set([0, 2, 3, 4, 6, 12, 13, 17, 18, 20, 21, 22, 23, 24, 25, 26, 28, 35, 36, 39]);
/** `OBJECT_GROUP_ARTIFACT` (action 3 for an ally, a neutral and an enemy) and `_TRADE_BOAT` (own and ally action 2). */
const GROUP_ARTIFACT = 1;
const GROUP_TRADE_BOAT = 20;
const GROUP_BUILDING = 3;
const GROUP_PRIEST = 18;
/** Masters no priest converts, so no ring over them: Town_Center1, the Wonder. */
const TOWN_CENTER = 109;
const WONDER = 276;

/** Can a selection holding an own object of type `t` attack (`sel_object_properties & 1`)? */
export function canAttack(t: UnitType): boolean {
  return ATTACKER_GROUPS.has(t.group) || TOWERS.has(t.id);
}

/** Does the right-click table give an enemy object of type `t` the attack action? */
export function isAttackable(t: UnitType): boolean {
  return ATTACKABLE_GROUPS.has(t.group);
}

/** What `analyize_selected_objects` finds in a selection with an own priest (which gives bits 2, 4 and 0x10). */
export interface PriestSelection {
  /** Bit 1: an own object of the selection can attack. */
  attack: boolean;
  /** Bit 0x80: a selected own priest has full faith (100). */
  faith: boolean;
  /** The priest when it is the only one selected (`selectedObjectCount` 1, `selectedObjectId`), else -1. */
  single: number;
  /** The owner's attributes 27 and 28: Monotheism lets it convert priests and buildings. */
  priestConversion: boolean;
  buildingConversion: boolean;
}

/** The object under the pointer, as `get_mouse_pointer_action_vars` reads it. */
export interface CursorTarget {
  id: number;
  /** Master id and object group. */
  type: number;
  group: number;
  hp: number;
  /** The master's hit points. */
  maxHp: number;
  state: number;
}

/** `unitDiplomacy[owner]` of the player looking: its own, Gaia's, an ally's, a neutral's or an enemy's. */
export type Stance = 'self' | 'gaia' | 'ally' | 'neutral' | 'enemy';

/**
 * `TRIBE_Player::get_mouse_pointer_action_vars` (src/tplayer.cpp) for a selection with an own priest: true where it
 * gives facet 5, the ring. Own and ally units short of hit points (heal; not the priest itself when it is the only one),
 * an enemy's or a neutral's convertible object while a priest has full faith and the selection cannot attack it,
 * Gaia's objects, artifacts and trade boats (actions 2 and 3, which a priest's bits pass).
 */
export function priestCursor(sel: PriestSelection, target: CursorTarget, stance: Stance): boolean {
  const g = target.group;
  if (stance === 'gaia') return GAIA_GROUPS.has(g);
  if (stance === 'self' || stance === 'ally') {
    if (g === GROUP_TRADE_BOAT || (stance === 'ally' && g === GROUP_ARTIFACT)) return true;
    if (!HEAL_GROUPS.has(g) || sel.single === target.id) return false;
    const hp = Math.trunc(target.hp);
    return hp > 0 && hp < target.maxHp;
  }
  if (g === GROUP_ARTIFACT) return true;
  if (!CONVERT_GROUPS.has(g) || (sel.attack && target.state <= ObjectState.Active) || !sel.faith) return false;
  if (g === GROUP_PRIEST && !sel.priestConversion) return false;
  if (g === GROUP_BUILDING && (!sel.buildingConversion || target.type === TOWN_CENTER || target.type === WONDER)) return false;
  return true;
}
