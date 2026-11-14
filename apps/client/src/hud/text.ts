// The game's text for the HUD from the language strings (language.dll, languagex.dll over it) the pack carries:
// object and civilization names (TRIBE_Panel_Object::draw), the object panel's stat rows (draw_item) and the command
// buttons' messages (TRIBE_Screen_Game::set_button, calc_text_msg), the age, the top strip's buttons, refusals and the
// attack rollover. Without strings the dat's names and English stand in for names and commands; the rest is left empty,
// as `get_string` leaves it for an id it does not have.
import { unitType, type CombatInfo, type Storage } from '@aoe/sim';
import type { AssetProvider } from '../assets';
import type { CommandButton } from './commands';

/** `STRING_ID_CIVILIZATION_EGYPTIAN` .. : civilization `id` (1 Egyptian .. 12 Choson) is string `10230 + id`. */
const STRING_CIVILIZATION_BASE = 10230;
/** `STRING_ID_CIVILIZATION_ROMAN` .. `_MACEDONIAN` (civilizations 13-16; Palmyran 15 and Macedonian 16 swap). */
const STRING_CIVILIZATION_ROR: Record<number, number> = { 13: 10246, 14: 10247, 15: 10249, 16: 10248 };
/** `STRING_ID_CIVILIZATION_UNKNOWN`. */
const STRING_CIVILIZATION_UNKNOWN = 10244;
/** `STRING_ID_RESOURCE_FOOD/WOOD/STONE/GOLD`, by resource type 0-3 (`get_string2(RGE_STRING_TYPE_INVENTORY)`). */
const STRING_RESOURCE = [4301, 4302, 4303, 4304] as const;
const RESOURCE_FALLBACK = ['Food', 'Wood', 'Stone', 'Gold'] as const;
/** `get_string2(RGE_STRING_TYPE_COMMAND)` for the commands that are not an item: the button's text and its message. */
const STRING_COMMAND = {
  build: [4103, 'Build'],
  'cancel-construction': [4120, 'Cancel construction'],
  more: [4112, 'More'],
  cancel: [4111, 'Cancel'],
  unselect: [4106, 'Unselect'],
  group: [4108, 'Group'],
  ungroup: [4109, 'Ungroup'],
} as const;
/** `get_string2(RGE_STRING_TYPE_AGE, age)`: `STRING_ID_AGE_STONE` .. `_IRON` for ages 1-4 (tribegam.cpp:778). */
const STRING_AGE_BASE = 4200;
/** `STRING_ID_COMMAND_CHAT`, `_DIPLOMACY`, `_MENU`: the top strip's buttons (scr_game.cpp:252, tribegam.cpp:871). */
export const STRING_TOP_BUTTONS = [4113, 4114, 4115] as const;
/**
 * `get_string2(RGE_STRING_TYPE_ATTRIBUTE, 1, attribute)` (tribegam.cpp:930): what `command_building` says when
 * `check_obj_cost` names the attribute that falls short. `STRING_ID_ERROR_NOT_ENOUGH_FOOD` .. `_GOLD`, `_NEED_MORE_HOUSES`
 * (headroom, 4) and `_POPULATION_LIMIT` (32).
 */
const STRING_SHORT: Record<number, number> = { 0: 3001, 1: 3002, 2: 3003, 3: 3004, 4: 3005, 32: 3046 };
/**
 * `enemy_text_id` of the right-click table (`Tribe1btnMouseRightClickTable`, src/game_globals.cpp:762) by object group,
 * shown with the attack cursor: 3704 for groups 2, 20-22, 3702 for 3, 3703 for 27, else 3701.
 */
const STRING_ATTACK: Record<number, number> = { 2: 3704, 3: 3702, 20: 3704, 21: 3704, 22: 3704, 27: 3703 };
const STRING_ATTACK_DEFAULT = 3701;
/** `g_trade_display_range_threshold`: a soldier's range row shows from this range up. */
const RANGE_THRESHOLD = 0.99;
/** `TRIBE_Combat_Object::get_armor` / `get_pierce_armor` count the armours of these classes. */
const ARMOUR_MELEE = 4;
const ARMOUR_PIERCE = 3;
/** `unit_level`s: building, villager, soldier, priest-like (no panel row of its own here). */
const LEVEL_BUILDING = 2;
const LEVEL_VILLAGER = 3;
const LEVEL_SOLDIER = 4;
const LEVEL_RANGED = 6;
const UNIT_LEVELS = new Set([3, 4, 5, 6, 7, 9]);

/** itemicon.shp (50731) frames of the stat rows. */
export const ITEM_ICON = { range: 6, attack: 7, armor: 8, pierceArmor: 10 } as const;

export type StatKind = keyof typeof ITEM_ICON;

export interface StatRow {
  kind: StatKind;
  icon: number;
  text: string;
}

/** `TRIBE_Panel_Object::get_string` with the panel's fallback: the dat's internal name when the id has no text. */
export function objectName(provider: AssetProvider, unit: number): string {
  const id = provider.unitInfo(unit)?.nameId ?? 0;
  return (id >= 1 && provider.string(id)) || unitType(unit).name;
}

/** `get_string2(RGE_STRING_TYPE_CIVILIZATION, civ)`; empty when the pack has no strings. */
export function civilizationName(provider: AssetProvider, civ: number): string {
  const id = civ >= 1 && civ <= 12 ? STRING_CIVILIZATION_BASE + civ : (STRING_CIVILIZATION_ROR[civ] ?? STRING_CIVILIZATION_UNKNOWN);
  return provider.string(id) ?? '';
}

/** `ValueTypeBonus`: the base value, then `+bonus` when the current value is higher. */
function bonus(orig: number, cur: number): string {
  return cur > orig ? `${orig}+${cur - orig}` : `${orig}`;
}

/** `get_weapon`, `get_armor`, `get_pierce_armor` (TRIBE_Combat_Object): the current values from the sim's record. */
function current(c: CombatInfo): { attack: number; armor: number; pierceArmor: number } {
  const best = (from: number, entries: CombatInfo['attacks'], kind?: number) =>
    entries.reduce((m, w) => ((kind === undefined || w.group === kind) && w.amount > m ? w.amount : m), from);
  return { attack: best(0, c.attacks), armor: best(c.baseArmour, c.armours, ARMOUR_MELEE), pierceArmor: best(0, c.armours, ARMOUR_PIERCE) };
}

/**
 * The object panel's stat rows (tpnl_obj.cpp:256-300 for units, 440-451 for buildings), in order: attack for villagers
 * and soldiers, armour when above 0 (always for soldiers), pierce armour when above 0, range for soldiers past 0.99
 * tiles. A building shows attack and range when they are above 0, unless it is the player's own and busy (`busy`:
 * training, or not built yet), when its progress takes the panel.
 */
export function statRows(provider: AssetProvider, unit: number, busy: boolean): StatRow[] {
  const info = provider.unitInfo(unit);
  const combat = info && unitType(unit).combat;
  if (!info || !combat) return [];
  const [attack, armor, pierceArmor, range] = info.displayed;
  const cur = current(combat);
  const rows: StatRow[] = [];
  const row = (kind: StatKind, text: string) => rows.push({ kind, icon: ITEM_ICON[kind], text });
  const soldier = info.level === LEVEL_SOLDIER || info.level === LEVEL_RANGED;
  if (info.level === LEVEL_BUILDING) {
    if (busy) return rows;
    if (cur.attack > 0) row('attack', bonus(attack, cur.attack));
    if (Math.trunc(combat.range) > 0) row('range', bonus(Math.trunc(range), Math.trunc(combat.range)));
    return rows;
  }
  if (!UNIT_LEVELS.has(info.level)) return rows;
  if (info.level === LEVEL_VILLAGER || info.level === LEVEL_SOLDIER) row('attack', bonus(attack, cur.attack));
  if (cur.armor > 0 || soldier) row('armor', bonus(armor, cur.armor));
  if (cur.pierceArmor > 0) row('pierceArmor', bonus(pierceArmor, cur.pierceArmor));
  if (soldier && combat.range > RANGE_THRESHOLD) row('range', bonus(Math.trunc(range), Math.trunc(combat.range)));
  return rows;
}

/** The age text of the top strip (`get_string2(RGE_STRING_TYPE_AGE, current age)`); empty outside ages 1-4. */
export function ageName(provider: AssetProvider, age: number): string {
  const a = Math.trunc(age);
  return a >= 1 && a <= 4 ? (provider.string(STRING_AGE_BASE + a) ?? '') : '';
}

/** The chat, diplomacy and menu buttons' texts (`get_string2(RGE_STRING_TYPE_COMMAND, id)`). */
export function topButtonLabels(provider: AssetProvider): string[] {
  return STRING_TOP_BUTTONS.map((id) => provider.string(id) ?? '');
}

/** The refusal for the attribute `check_obj_cost` found short (3001 for food); empty for any other. */
export function shortMessage(provider: AssetProvider, attribute: number): string {
  const id = STRING_SHORT[attribute];
  return (id !== undefined && provider.string(id)) || '';
}

/** The rollover text with the attack cursor over an enemy object of `group` (`get_mouse_pointer_action_vars`). */
export function attackRollover(provider: AssetProvider, group: number): string {
  return provider.string(STRING_ATTACK[group] ?? STRING_ATTACK_DEFAULT) ?? '';
}

/** `calc_text_msg`: the item's text and what it costs, "Create Villager (C) (Food: 50)". */
function itemMessage(provider: AssetProvider, unit: number, verb: string): string {
  const id = provider.unitInfo(unit)?.creationId ?? 0;
  const command = (id >= 1 && provider.string(id)) || `${verb} ${objectName(provider, unit)}`;
  // `obj_cost`: the three build_inventory slots, each when paid (flag set) and food, wood, stone or gold; the second
  // and third start with two spaces even after an empty first.
  const costs = (unitType(unit).creatable?.costs ?? []).slice(0, 3);
  const parts = costs.map((c: Storage, i) => {
    if (c.flag === 0 || c.type < 0 || c.type > 3) return '';
    const name = provider.string(STRING_RESOURCE[c.type]!) ?? RESOURCE_FALLBACK[c.type]!;
    return `${i === 0 ? '' : '  '}${name}: ${Math.trunc(c.amount)}`;
  });
  const cost = parts.join('');
  return cost ? `${command} (${cost})` : command;
}

/** What the message line shows over a command button (`set_button`'s `text_msg`, or the command's text). */
export function commandMessage(provider: AssetProvider, b: CommandButton): string {
  switch (b.kind) {
    case 'place':
      return itemMessage(provider, b.unit, 'Build');
    case 'train':
      return itemMessage(provider, b.unit, 'Create');
    default: {
      const [id, fallback] = STRING_COMMAND[b.kind];
      return provider.string(id) ?? fallback;
    }
  }
}
