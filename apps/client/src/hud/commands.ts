// What the command button grid holds, from TRIBE_Screen_Game::setup_buttons (src/scr_game.cpp:2409) and
// TRIBE_Player::interface_item_avail (src/tplayer.cpp:731), for the commands the sim has: the villager's build menu, the
// buildings' train buttons with their queue counts, and cancelling a foundation (docs/spec/hud.md).
import {
  ACTION_BUILD,
  BUILDER,
  isEnabled,
  ObjectState,
  TOWN_CENTER,
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
  /** `TRIBE_UI_COMMAND_CANCEL_CONSTRUCTION`. */
  | { kind: 'cancel-construction'; slot: number }
  /** `TRIBE_UI_COMMAND_MORE`: the build menu's other page. */
  | { kind: 'more'; slot: number }
  /** `TRIBE_UI_COMMAND_CANCEL`: back to the normal mode. */
  | { kind: 'cancel'; slot: number }
  /** `TRIBE_UI_COMMAND_UNSELECT`. */
  | { kind: 'unselect'; slot: number };

/** btncmd.shp (interface SLP 50721) frames the grid uses at 800x600 and up. */
export const COMMAND_FRAME = { build: 2, 'cancel-construction': 3, cancel: 10, unselect: 10, more: 11 } as const;

/** The grid's last slot: cancel or unselect (hotkey Esc). */
export const FINAL_SLOT = 11;
const MORE_SLOT = 5;
/** `MASTER_OBJECT_RANGE`: with none in the build list, the Town Center's button moves to location 6. */
const RANGE = 87;
/** `attributes[0x30]`: 0 lets a player with no Town Center build one. */
const ATTR_TOWN_CENTER_ALLOWED = 48;
const MASTER_TYPE_COMBAT = 70;
const MASTER_TYPE_BUILDING = 80;

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
  const ids = [...UNIT_TYPES.values()]
    .filter((t) => t.masterType >= MASTER_TYPE_COMBAT && t.creatable?.trainLocationId === location && isEnabled(world, player, t.id))
    .map((t) => t.id)
    .sort((a, b) => a - b);
  if (location === BUILDER && world.attributes[player]![ATTR_TOWN_CENTER_ALLOWED] === 0 && !isEnabled(world, player, TOWN_CENTER)) {
    const hasTownCenter = [...world.entities.ofPlayer(player)].some((e) => e.type === TOWN_CENTER);
    if (!hasTownCenter) ids.push(TOWN_CENTER);
  }
  return ids;
}

export interface CommandContext {
  world: World;
  /** Sim player number of this client. */
  player: number;
  /** The object the panel shows (the lowest selected id), if any. */
  object: Entity | undefined;
  mode: CommandMode;
  /** Build menu page (`start_item`): 0 the first, 1 the second. */
  page: number;
  /** The dat's `button_location` of a master; null when the pack does not have it (then the list order is used). */
  buttonOf: (unit: number) => number | null;
}

/** Each item's `button_location`, or 1, 2, ... in list order when one is unknown. */
function locations(ids: number[], buttonOf: (unit: number) => number | null): number[] {
  const known = ids.map(buttonOf);
  return known.every((b) => b !== null && b > 0) ? (known as number[]) : ids.map((_, i) => i + 1);
}

/** The buttons in the grid, in the order `setup_buttons` sets them (a later one in the same slot replaces an earlier). */
export function commandButtons(c: CommandContext): CommandButton[] {
  const { world, player, object } = c;
  if (!object) return [];
  if (c.mode === 'place') return [{ kind: 'cancel', slot: FINAL_SLOT }];
  if (c.mode === 'build-menu') {
    const out: CommandButton[] = [];
    const ids = itemsMadeAt(world, player, BUILDER);
    const locs = locations(ids, c.buttonOf);
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
  const t = unitType(object.type);
  if (t.masterType !== MASTER_TYPE_BUILDING) return canBuild(t) ? [{ kind: 'build', slot: 0 }, unselect] : [unselect];
  if (object.state < ObjectState.Active) return [{ kind: 'cancel-construction', slot: 0 }, unselect];
  if (object.state > ObjectState.Active) return [unselect];
  const queue = object.queue ?? [];
  const queueActive = queue.length > 0;
  const out: CommandButton[] = [];
  const ids = itemsMadeAt(world, player, object.type);
  const locs = locations(ids, c.buttonOf);
  ids.forEach((unit, i) => {
    const count = queue.reduce((n, r) => (r.unit === unit ? n + r.count : n), 0);
    if (!queueActive || count > 0) out.push({ kind: 'train', slot: buttonSlot(locs[i]!), unit, count });
  });
  out.push(unselect);
  return out;
}

/** The grid by slot: the last button set in a slot wins, as in the original. */
export function bySlot(buttons: readonly CommandButton[]): (CommandButton | undefined)[] {
  const slots: (CommandButton | undefined)[] = new Array(12).fill(undefined);
  for (const b of buttons) slots[b.slot] = b;
  return slots;
}

/** `TRIBE_Building_Object::get_construction_progress`: whole percent of the build points. */
export function constructionProgress(e: Entity): number {
  if (e.state !== ObjectState.Unbuilt) return 100;
  const required = Math.trunc(unitType(e.type).creatable?.trainTime ?? 0);
  if (required === 0) return 100;
  return Math.trunc(Math.fround(Math.fround((e.buildPoints ?? 0) / required) * 100));
}

/**
 * `production_queue_status`: the unit in training and its whole percent (`TRIBE_Action_Make_Obj::get_info`), or the
 * queue's first unit at 0 before it starts; null with an empty queue.
 */
export function trainingStatus(e: Entity): { unit: number; progress: number } | null {
  if (e.train) {
    const required = unitType(e.train.unit).creatable?.trainTime ?? 0;
    const progress = e.train.state === 1 || required === 0 ? 100 : Math.trunc(Math.fround(Math.fround(e.train.workDone * 100) / required));
    return { unit: e.train.unit, progress };
  }
  const first = e.queue?.[0];
  return first ? { unit: first.unit, progress: 0 } : null;
}
