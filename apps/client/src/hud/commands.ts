// What the command button grid holds, from TRIBE_Screen_Game::setup_buttons (src/scr_game.cpp:2409) and
// TRIBE_Player::interface_item_avail (src/tplayer.cpp:731), for the commands the sim has: the villager's build menu, the
// buildings' train and research buttons with their queue counts, stop, and cancelling a foundation (docs/spec/hud.md).
// Every master is the player's own (`player->master_objects`), so ages and techs change what the grid offers.
import {
  ACTION_BUILD,
  BUILDER,
  isEnabled,
  master,
  ObjectState,
  TECH_AVAILABLE,
  TECH_DISABLED,
  TECH_DONE,
  TECH_RESEARCHING,
  TECHS,
  TOWN_CENTER,
  typeOf,
  UNIT_TYPES,
  unitType,
  type Entity,
  type UnitType,
  type World,
} from '@aoe/sim';

/** `game_mode`: normal, the villager's build menu (`TRIBE_GAME_MODE_BUILD_MENU`), placing a building. */
export type CommandMode = 'normal' | 'build-menu' | 'place';

export type CommandButton =
  /** `TRIBE_UI_COMMAND_BUILD`: opens the build menu. */
  | { kind: 'build'; slot: number }
  /** `TRIBE_UI_COMMAND_PLACE_BUILDING`: places building `unit`. */
  | { kind: 'place'; slot: number; unit: number }
  /** `TRIBE_UI_COMMAND_TRAIN`: left click queues one `unit`, right click takes one off; `count` units are queued. */
  | { kind: 'train'; slot: number; unit: number; count: number }
  /**
   * `TRIBE_UI_COMMAND_RESEARCH`: researches `tech`. `disabled`: the Town Center's next age while it cannot be researched
   * yet, drawn dithered and deaf to the mouse.
   */
  | { kind: 'research'; slot: number; tech: number; disabled: boolean }
  /** `TRIBE_UI_COMMAND_STOP`: the building stops its research, or empties its queue (refunded). */
  | { kind: 'stop'; slot: number }
  /** `TRIBE_UI_COMMAND_CANCEL_CONSTRUCTION`. */
  | { kind: 'cancel-construction'; slot: number }
  /** `TRIBE_UI_COMMAND_MORE`: the build menu's other page. */
  | { kind: 'more'; slot: number }
  /** `TRIBE_UI_COMMAND_CANCEL`: back to the normal mode. */
  | { kind: 'cancel'; slot: number }
  /** `TRIBE_UI_COMMAND_UNSELECT`. */
  | { kind: 'unselect'; slot: number }
  /** `TRIBE_UI_COMMAND_GROUP`: the selection becomes a group (`group_objects(-1)`). */
  | { kind: 'group'; slot: number }
  /** `TRIBE_UI_COMMAND_UNGROUP`: the selected objects leave their groups (`ungroup_objects`). */
  | { kind: 'ungroup'; slot: number };

/** btncmd.shp (interface SLP 50721) frames the grid uses at 800x600 and up. */
export const COMMAND_FRAME = { build: 2, stop: 3, 'cancel-construction': 3, group: 7, ungroup: 8, cancel: 10, unselect: 10, more: 11 } as const;

/** The grid's last slot: cancel or unselect (hotkey Esc). */
export const FINAL_SLOT = 11;
const MORE_SLOT = 5;
/** Stop's slot on a building with a queue; a researching building has it in slot 0. */
const STOP_QUEUE_SLOT = 6;
/** `MASTER_OBJECT_RANGE`: with none in the build list, the Town Center's button moves to location 6. */
const RANGE = 87;
/** `attributes[0x30]`: 0 lets a player with no Town Center build one. */
const ATTR_TOWN_CENTER_ALLOWED = 48;
/** `PLAYER_ATTRIBUTE_CURRENT_AGE`: 1 Stone .. 4 Iron; tech `age + 100` is the next age. */
const ATTR_CURRENT_AGE = 6;
const IRON_AGE = 4;
const MASTER_TYPE_COMBAT = 70;
const MASTER_TYPE_BUILDING = 80;
/** `unit_level`s with a branch of their own in `setup_buttons`: building, villager, and the other units. */
const LEVEL_BUILDING = 2;
const LEVEL_VILLAGER = 3;
const UNIT_LEVELS = new Set([4, 5, 6, 7, 9]);
/** `is_group_selected(4)`: the object group of the Villagers, which gives a mixed selection the build button. */
const GROUP_VILLAGER = 4;

/** `calc_button_loc`: a dat `button_location` (1-5, 6-10 on the first page; 11-15, 16-20 on the second) to a grid slot. */
export function buttonSlot(location: number): number {
  if (location >= 1 && location <= 5) return location - 1;
  if (location >= 6 && location <= 10) return location;
  if (location >= 11 && location <= 15) return location - 11;
  if (location >= 16 && location <= 20) return location - 10;
  return 0;
}

/**
 * Villager-class units (the original's `unit_level` 3) get the build button. In the sim's table they are the units
 * whose task swap group holds a unit with a build task (the Builder).
 */
export function canBuild(t: UnitType): boolean {
  const builds = (o: UnitType) => o.action?.tasks.some((k) => k.actionType === ACTION_BUILD) ?? false;
  if (builds(t)) return true;
  const group = t.action?.taskSwapGroup ?? 0;
  if (group === 0) return false;
  for (const o of UNIT_TYPES.values()) if (o.masterType === t.masterType && o.action?.taskSwapGroup === group && builds(o)) return true;
  return false;
}

/**
 * `interface_item_avail(obj_cat)`: the player's available masters made at `location` (a building's id, or the Builder
 * for the build menu), in id order. A player without a Town Center may build one while attribute 48 is 0.
 */
export function itemsMadeAt(world: World, player: number, location: number): number[] {
  const ids = Object.values(world.masters[player] ?? {})
    .filter((t) => t.masterType >= MASTER_TYPE_COMBAT && t.creatable?.trainLocationId === location && isEnabled(world, player, t.id))
    .map((t) => t.id)
    .sort((a, b) => a - b);
  if (location === BUILDER && world.attributes[player]![ATTR_TOWN_CENTER_ALLOWED] === 0 && !isEnabled(world, player, TOWN_CENTER)) {
    const hasTownCenter = [...world.entities.ofPlayer(player)].some((e) => e.type === TOWN_CENTER);
    if (!hasTownCenter) ids.push(TOWN_CENTER);
  }
  return ids;
}

/** `interface_tech_avail(obj_cat)`: the player's available techs researched at building `location`, in id order. */
export function techsAt(world: World, player: number, location: number): number[] {
  const states = world.techs[player] ?? [];
  return TECHS.flatMap((t, id) => (states[id] === TECH_AVAILABLE && t.location === location ? [id] : []));
}

export interface CommandContext {
  world: World;
  /** Sim player number of this client. */
  player: number;
  /** The object the panel shows (the player's `selected_obj`), if any. */
  object: Entity | undefined;
  /** Every selected object (`sel_list`); the panel's object alone when not given. */
  selected?: readonly Entity[];
  /** Is the panel's object in a group (`selected_group` != 0)? */
  grouped?: boolean;
  /** The dat's `unit_level` of a master; null when the pack does not have it. */
  levelOf?: (unit: number) => number | null;
  mode: CommandMode;
  /** Build menu page (`start_item`): 0 the first, 1 the second. */
  page: number;
  /** The dat's `button_location` of a master; null when the pack does not have it (then the list order is used). */
  buttonOf: (unit: number) => number | null;
  /** The dat's `button_location` of a tech; null when unknown (then the list order is used). */
  techButtonOf?: (tech: number) => number | null;
}

/** Each item's `button_location`, or 1, 2, ... in list order when one is unknown. */
function locations(known: (number | null)[]): number[] {
  return known.every((b) => b !== null && b > 0) ? (known as number[]) : known.map((_, i) => i + 1);
}

/** The buttons in the grid, in the order `setup_buttons` sets them (a later one in the same slot replaces an earlier). */
export function commandButtons(c: CommandContext): CommandButton[] {
  const { world, player, object } = c;
  if (!object) return [];
  if (c.mode === 'place') return [{ kind: 'cancel', slot: FINAL_SLOT }];
  if (c.mode === 'build-menu') {
    const out: CommandButton[] = [];
    const ids = itemsMadeAt(world, player, BUILDER);
    const locs = locations(ids.map(c.buttonOf));
    const hasRange = ids.includes(RANGE);
    let anyMore = false;
    ids.forEach((unit, i) => {
      const loc = unit === TOWN_CENTER && !hasRange ? 6 : locs[i]!;
      if ((c.page === 0) !== loc <= 10) {
        anyMore = true;
        return;
      }
      out.push({ kind: 'place', slot: buttonSlot(loc), unit });
    });
    if (anyMore) out.push({ kind: 'more', slot: MORE_SLOT });
    out.push({ kind: 'cancel', slot: FINAL_SLOT });
    return out;
  }
  const unselect: CommandButton = { kind: 'unselect', slot: FINAL_SLOT };
  if (object.owner !== player) return [unselect];
  const selected = c.selected?.length ? c.selected : [object];
  // Group (slot 6) and Ungroup (7) for several objects, or Ungroup alone (6) for one in a group.
  const grouping: CommandButton[] =
    selected.length > 1 ? [{ kind: 'group', slot: 6 }, { kind: 'ungroup', slot: 7 }] : c.grouped ? [{ kind: 'ungroup', slot: 6 }] : [];
  const level = levelSelected(selected, c.levelOf);
  const t = typeOf(world, object);
  if (level === LEVEL_VILLAGER) return [{ kind: 'build', slot: 0 }, ...grouping, unselect];
  if (UNIT_LEVELS.has(level)) return [...grouping, unselect];
  if (level === LEVEL_BUILDING && t.masterType === MASTER_TYPE_BUILDING) {
    if (object.state < ObjectState.Active) return [{ kind: 'cancel-construction', slot: 0 }, unselect];
    if (object.state > ObjectState.Active) return [unselect];
    // `work_status`: a research short of 100% leaves Stop alone.
    const research = researchStatus(world, object);
    if (research && research.progress < 100) return [{ kind: 'stop', slot: 0 }, unselect];
    const queue = object.queue ?? [];
    const queueActive = queue.length > 0;
    const out: CommandButton[] = queueActive ? [{ kind: 'stop', slot: STOP_QUEUE_SLOT }] : [];
    const ids = itemsMadeAt(world, player, object.type);
    let techs = techsAt(world, player, object.type);
    let disabled = false;
    // A Town Center with no tech to offer shows the next age, disabled, unless the age is disabled.
    const age = Math.trunc(world.attributes[player]![ATTR_CURRENT_AGE]!);
    if (!queueActive && object.type === TOWN_CENTER && techs.length === 0 && age < IRON_AGE && world.techs[player]![age + 100] !== TECH_DISABLED) {
      techs = [age + 100];
      disabled = true;
    }
    const techButtonOf = c.techButtonOf ?? (() => null);
    const locs = locations([...ids.map(c.buttonOf), ...techs.map(techButtonOf)]);
    ids.forEach((unit, i) => {
      const count = queue.reduce((n, r) => (r.unit === unit ? n + r.count : n), 0);
      if (!queueActive || count > 0) out.push({ kind: 'train', slot: buttonSlot(locs[i]!), unit, count });
    });
    if (!queueActive) {
      techs.forEach((tech, i) => out.push({ kind: 'research', slot: buttonSlot(locs[ids.length + i]!), tech, disabled }));
      // Grouping only shows on a building with nothing to make or research.
      if (ids.length === 0 && techs.length === 0) out.push(...grouping);
    }
    out.push(unselect);
    return out;
  }
  // Mixed levels (0) and the rest: Build when a Villager is among them; the last button is Unselect when every one is
  // a unit, else Cancel (which unselects in the normal mode).
  const units = selected.length > 1 && level === 0 && selected.every((e) => isUnitLevel(levelOf(e.type, c.levelOf)));
  const build: CommandButton[] = selected.some((e) => typeOf(world, e).group === GROUP_VILLAGER) ? [{ kind: 'build', slot: 0 }] : [];
  return [...build, ...grouping, units ? unselect : { kind: 'cancel', slot: FINAL_SLOT }];
}

/** A master's `unit_level`, from the pack or, without one, guessed from the sim's table. */
function levelOf(unit: number, from?: (unit: number) => number | null): number {
  const known = from?.(unit);
  if (known !== null && known !== undefined) return known;
  const t = unitType(unit);
  if (t.masterType === MASTER_TYPE_BUILDING) return LEVEL_BUILDING;
  return canBuild(t) ? LEVEL_VILLAGER : 4;
}

/** The movable units' levels (the special selection's `all_moveable_units` test). */
function isUnitLevel(level: number): boolean {
  return level >= 3 && level <= 9;
}

/** `unit_level_selected`: the level the selected objects share, or 0 when they differ. */
export function levelSelected(selected: readonly Entity[], from?: (unit: number) => number | null): number {
  const levels = new Set(selected.map((e) => levelOf(e.type, from)));
  return levels.size === 1 ? [...levels][0]! : 0;
}

/** The grid by slot: the last button set in a slot wins, as in the original. */
export function bySlot(buttons: readonly CommandButton[]): (CommandButton | undefined)[] {
  const slots: (CommandButton | undefined)[] = new Array(12).fill(undefined);
  for (const b of buttons) slots[b.slot] = b;
  return slots;
}

/** `TRIBE_Building_Object::get_construction_progress`: whole percent of the build points (the owner's master). */
export function constructionProgress(world: World, e: Entity): number {
  if (e.state !== ObjectState.Unbuilt) return 100;
  const required = Math.trunc(typeOf(world, e).creatable?.trainTime ?? 0);
  if (required === 0) return 100;
  return Math.trunc(Math.fround(Math.fround((e.buildPoints ?? 0) / required) * 100));
}

/**
 * `production_queue_status`: the unit in training and its whole percent (`TRIBE_Action_Make_Obj::get_info`), or the
 * queue's first unit at 0 before it starts; null with an empty queue.
 */
export function trainingStatus(world: World, e: Entity): { unit: number; progress: number } | null {
  if (e.train) {
    const required = master(world, e.owner, e.train.unit).creatable?.trainTime ?? 0;
    const progress = e.train.state === 1 || required === 0 ? 100 : Math.trunc(Math.fround(Math.fround(e.train.workDone * 100) / required));
    return { unit: e.train.unit, progress };
  }
  const first = e.queue?.[0];
  return first ? { unit: first.unit, progress: 0 } : null;
}

/**
 * The research under way (`TRIBE_Action_Make_Tech::get_info`): the tech and its whole percent (`get_progress`:
 * `research_done * 100 / research`), 100 once the action is done; null when the building researches nothing.
 */
export function researchStatus(world: World, e: Entity): { tech: number; progress: number } | null {
  const a = e.research;
  if (!a) return null;
  if (a.state === 1) return { tech: a.tech, progress: 100 };
  const state = world.techs[e.owner]?.[a.tech];
  const time = Math.trunc(TECHS[a.tech]?.researchTime ?? 0);
  if (state === TECH_DONE) return { tech: a.tech, progress: 100 };
  if (state !== TECH_RESEARCHING || time === 0) return { tech: a.tech, progress: 0 };
  return { tech: a.tech, progress: Math.trunc(Math.fround(Math.fround(world.researchDone[e.owner]![a.tech]! * 100) / time)) };
}
