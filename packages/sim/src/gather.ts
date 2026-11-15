/**
 * Gathering and hunting (docs/spec/economy.md §3): the work order (`work2`, task choice and the villager's task swap),
 * `RGE_Action_Gather` (action 5) and `TRIBE_Action_Hunt` (action 110). Every float store is rounded to float32.
 * Only human players exist so far: the computer-player branches are not ported.
 */
import { ACTION_ARTIFACT, artifactMoveTo, artifactWork, startArtifact, updateArtifact } from './artifact';
import { ACTION_BUILD, buildFirstInStack, buildMoveTo, buildWork, updateBuild } from './build';
import { ACTION_REPAIR, repairMoveTo, repairTaskFor, repairWork, startRepair, updateRepair } from './repair';
import { ACTION_CONVERT, ACTION_HEAL, GROUP_PRIEST, priestWork, startPriestAction, updateConvert, updateHeal } from './priest';
import { ACTION_ENTER, ACTION_TRANSPORT, enterTaskFor, startEnter, startTransport, transportMoveTo, transportWork, updateEnter, updateTransport } from './transport';
import { ACTION_TRADE, startTrade, tradeMoveTo, tradeWork, updateTrade } from './trade';
import { attackWork, distanceToObject, startAttack, turnTowards, updateAttack } from './combat';
import type { GameContext } from './context';
import type { TileMap } from './map';
import { isAlly, relation, RELATION_ALLY, type DiplomacyContext } from './diplomacy';
import { ObjectState, type Entity } from './entities';
import { typeOf, type PlayerMasters } from './masters';
import { ActionResult, currentSprite, endAction, facetOf, lookupZone, MOVE_RANGE, startMoveTo, updateMover } from './movement';
import { add32, div32, f32, mul32, sub32, toInt } from './num';
import { dropResearch } from './research';
import { newSprite } from './sprites';
import { AI_ACTION_GATHER, AI_ACTION_HUNT, aiStateForAction, NOTIFY_REQUEST_TASK, notifyObject, setAiState } from './unit-ai';
import type { SpriteInfo, Task, UnitType } from './units';
import { exploreObject, unexploreObject } from './visibility';
import { endWonder } from './wonder';

export const ACTION_GATHER = 5;
export const ACTION_HUNT = 110;
/** `RGE_Action_Attack` and the task that makes one (`create_task_action` case 7, src/act_list.cpp:137). */
export const ACTION_ATTACK = 9;
const TASK_ATTACK = 7;
/** `RGE_Action_Move_To`. */
export const ACTION_MOVE = 1;

/** Gather/hunt states (economy.md §3.2, §3.6). */
export const WORK_DONE = 1;
export const WORK_IDLE = 2;
export const WORK_WAITING = 3;
export const WORK_TO_TARGET = 4;
export const WORK_TURNING = 6;
export const WORK_WORKING = 7;
export const WORK_DROP_OFF = 8;
export const WORK_TO_POINT = 11;
export const WORK_KILLING = 12;
export const WORK_FAILED = 13;
export const WORK_MOVE_ORDER = 15;

/** A gather or hunt action. `task` indexes the unit type's task list. */
export interface WorkAction {
  type: number;
  task: number;
  state: number;
  timer: number;
  /** Resource object, -1 none. */
  target: number;
  /** Drop site, -1 none. */
  target2: number;
  /** Remembered point, -1 none. */
  x: number;
  y: number;
  z: number;
  /** Gather and hunt: `targetType`, the master id of the object the action was made for (-1 or absent: a point). */
  targetType?: number;
  /** Convert: `requiredRange`, the approach range (1 for a building, else the priest's weapon range). */
  range?: number;
  /** Repair: `save_target_command_flag`, the boat's command count when the repairer called it (naval.md §6.1). */
  commandFlag?: number;
  /** Trade: `pick_up_x`, `pick_up_y`, where the cargo was loaded (-1 none; support-actions.md §7.2). */
  pickUpX?: number;
  pickUpY?: number;
}

/** `g_gather_dropoff_distance_threshold` / `g_hunt_drop_distance_threshold`, compared squared. */
const DROP_DISTANCE = 1;
/** `PLAYER_ATTRIBUTE_GOLD` and gold earned (`src/tplayer.cpp:3661-3664`). */
const ATTR_GOLD = 3;
const ATTR_GOLD_EARNED = 49;
/** Drop-off sites per carried type for civilians (`TRIBE_Task_List::get_target_task`, `src/ttsk_lst.cpp:15`). */
const TOWN_CENTER = 109;
const STORAGE_PIT = 103;
const GRANARY = 68;
/** `MASTER_OBJECT_DOCK_1`: the fishing boat's drop site in the task pass. */
const DOCK = 45;
const GROUP_CIVILIAN = 4;
const GROUP_TRADE_BOAT = 2;
const GROUP_FISHING_BOAT = 21;

function taskOf(ctx: PlayerMasters, e: Entity, a: WorkAction): Task {
  return typeOf(ctx, e).action!.tasks[a.task]!;
}

function object(ctx: GameContext, id: number): Entity | undefined {
  return id === -1 ? undefined : ctx.entities.get(id);
}

/** `RGE_Task_List::check_task` (src/task_lst.cpp:177), its owner types by stance (src/task_lst.cpp:186-226, diplomacy.md §2). */
function checkTask(ctx: PlayerMasters & DiplomacyContext, task: Task, e: Entity, target: Entity): boolean {
  if (task.carryCheck === 1 && (target.heldType === -1 || target.heldAmount <= 0)) return false;
  switch (task.diplomacy) {
    case 1:
      if (target.owner !== e.owner) return false;
      break;
    case 2:
      // Another player's object that the unit's owner does not call an ally. Gaia's never passes.
      if (target.owner === 0 || target.owner === e.owner || relation(ctx, e.owner, target.owner) === RELATION_ALLY) return false;
      break;
    case 3:
      if (target.owner !== 0) return false;
      break;
    case 4:
      // Its own, or a mutual ally's.
      return target.owner === e.owner || (target.owner !== 0 && isAlly(ctx, e.owner, target.owner) && isAlly(ctx, target.owner, e.owner));
    case 5:
      if (target.owner === e.owner) return false;
      if (target.owner !== 0 && relation(ctx, e.owner, target.owner) === RELATION_ALLY) return false;
      if (target.owner === 0 && typeOf(ctx, e).combatLevel === 0) return false;
      break;
  }
  return e !== target;
}

/** `TRIBE_Task_List::get_target_task` then `RGE_Task_List::get_target_task` (src/task_lst.cpp:107): task index or -1. */
function targetTask(ctx: PlayerMasters & DiplomacyContext & { readonly map?: TileMap }, t: UnitType, e: Entity, target: Entity | undefined, x = -1, y = -1): number {
  const tasks = t.action?.tasks ?? [];
  if (tasks.length === 0) return -1;
  if (!target) return terrainTask(ctx, tasks, x, y);
  const tt = typeOf(ctx, target);
  const self = typeOf(ctx, e);
  const carrier = self.group === GROUP_CIVILIAN || self.group === GROUP_FISHING_BOAT;
  if (e.heldType !== -1 && e.heldAmount > 0 && target.state === ObjectState.Active && carrier && target.owner === e.owner) {
    let site = -1;
    let alternate = -1;
    if (self.group === GROUP_FISHING_BOAT) {
      // A fishing boat holding trade goods (9) or fish (17) delivers to a Dock (src/ttsk_lst.cpp:44-46).
      if (e.heldType === 9 || e.heldType === 17) site = DOCK;
    } else if ([1, 2, 3, 15, 17].includes(e.heldType)) [site, alternate] = [TOWN_CENTER, STORAGE_PIT];
    else if (e.heldType === 16) [site, alternate] = [TOWN_CENTER, GRANARY];
    if (target.type === site || target.type === alternate) {
      const i = tasks.findIndex((k) => k.resourceIn === e.heldType && (k.actionType === ACTION_GATHER || k.actionType === ACTION_HUNT || k.actionType === ACTION_TRADE));
      if (i !== -1) return i;
    }
  }
  if (target.state === ObjectState.Unbuilt) {
    if (target.owner === e.owner && tt.masterType === 80) return tasks.findIndex((k) => k.actionType === 101);
    const i = tasks.findIndex((k) => k.building === 1 && checkTask(ctx, k, e, target));
    if (i !== -1) return i;
  }
  const enter = enterTaskFor(ctx, t, e, target);
  if (enter !== null) return enter;
  const repair = repairTaskFor(ctx, t, e, target);
  if (repair !== null) return repair;
  if (self.group === GROUP_PRIEST) return priestTask(ctx, tasks, e, target, tt);
  let i = tasks.findIndex((k) => k.unitId === target.type && checkTask(ctx, k, e, target));
  if (i !== -1) return i;
  i = tasks.findIndex((k) => k.group === tt.group && checkTask(ctx, k, e, target));
  if (i !== -1) return i;
  if (target.state < ObjectState.Dying && tt.combatLevel > 0) i = tasks.findIndex((k) => k.combatLevel > 0 && checkTask(ctx, k, e, target));
  return i !== -1 ? i : terrainTask(ctx, tasks, x, y);
}

/**
 * The terrain pass of `RGE_Task_List::get_target_task` (src/task_lst.cpp:147-160): the first task naming the terrain of
 * the point's tile (a point of -1 skips it). The transport's task 0 names the beach (naval.md §7.4).
 */
function terrainTask(ctx: { readonly map?: TileMap }, tasks: readonly Task[], x: number, y: number): number {
  if (!ctx.map || x === -1 || y === -1) return -1;
  const tx = toInt(x);
  const ty = toInt(y);
  if (tx < 0 || tx >= ctx.map.width || ty < 0 || ty >= ctx.map.height) return -1;
  const terrain = ctx.map.terrainAt(tx, ty);
  return tasks.findIndex((k) => k.terrainId === terrain);
}

/** Boats, artifacts, walls and buildings: a priest heals none of them (src/ttsk_lst.cpp:127-130). */
const NO_HEAL_GROUPS = [21, 2, 20, 22, 1, 27, 3];

/**
 * The priest's pass of `TRIBE_Task_List::get_target_task` (src/ttsk_lst.cpp:113-143), which ends the search: a living
 * object of another player (not Gaia's, not an ally's, not an artifact) takes the convert task; its owner's or an ally's
 * short of hit points, not a boat, artifact, wall or building, takes the heal task; anything else has none.
 */
function priestTask(ctx: PlayerMasters & DiplomacyContext, tasks: readonly Task[], e: Entity, target: Entity, tt: UnitType): number {
  if (target.owner !== e.owner && target.state < ObjectState.Dying && target.owner > 0 && !isAlly(ctx, e.owner, target.owner) && tt.group !== 1) {
    return tasks.findIndex((k) => k.actionType === ACTION_CONVERT);
  }
  if (isAlly(ctx, e.owner, target.owner) && target.hp < f32(tt.hitPoints) && target.state < ObjectState.Dying && !NO_HEAL_GROUPS.includes(tt.group)) {
    return tasks.findIndex((k) => k.actionType === ACTION_HEAL);
  }
  return -1;
}

/**
 * `transform` (src/stat_obj.cpp:1778, src/move_obj.cpp:318, src/act_obj.cpp:91): the unit becomes `next`. Line of
 * sight and footprint re-done, standing sprite, hp scaled to the new maximum, active again, turning state reset, actions deleted.
 */
export function transform(ctx: GameContext, e: Entity, next: UnitType): void {
  const old = typeOf(ctx, e);
  const ratio = div32(e.hp, old.hitPoints);
  // The line of sight moves to the new master's, active or not (src/stat_obj.cpp:1782-1793).
  unexploreObject(ctx, e, old, false);
  ctx.pathing.unstamp(e, old);
  e.type = next.id;
  // `TRIBE_Combat_Object::transform` frees a private master (src/t_c_obj.cpp:178-186): the unit reads its owner's again.
  if (e.ownMaster) delete e.ownMaster;
  exploreObject(ctx, e, next, false);
  ctx.pathing.stamp(e, next);
  newSprite(ctx, e, next.standing);
  e.hp = mul32(next.hitPoints, ratio);
  e.state = ObjectState.Active;
  const m = e.mover!;
  m.collisionAvoidanceDistance = 0;
  m.turnTimer = 0;
  e.turnTowardsTime = 0;
  // `set_angle`: the facet follows the angle on the new main sprite.
  m.facet = facetOf(m.angle, currentSprite(e, typeOf(ctx, e)));
  deleteActions(ctx, e);
}

/** `set_only_action` / `delete_list`: drop every action and sub-action; the move's destructor stops the unit. */
export function deleteActions(ctx: GameContext, e: Entity): void {
  e.work = null;
  e.attack = null;
  e.make = null;
  endWonder(ctx, e);
  if (e.mover) endAction(e.mover);
  dropResearch(ctx, e);
}

/**
 * `RGE_Action_Object::work2` (src/act_obj.cpp:147, economy.md §3.1): pick the unit's task for `target`, swapping to
 * another unit type of the same task group when its own list has none; then start that task, or just walk to the
 * target.
 */
export function orderWork(ctx: GameContext, e: Entity, target: Entity | undefined, x: number, y: number): void {
  if (target === e || !e.mover) return;
  let t = typeOf(ctx, e);
  let task = targetTask(ctx, t, e, target, f32(x), f32(y));
  if (task === -1 && t.action && t.action.taskSwapGroup !== 0) {
    for (const other of swapTypes(ctx, e.owner, t)) {
      const i = targetTask(ctx, other, e, target, f32(x), f32(y));
      if (i !== -1) {
        transform(ctx, e, other);
        t = other;
        task = i;
        break;
      }
    }
  }
  const action = startTask(ctx, e, t, task, target, f32(x), f32(y));
  // `setCurrentOrder` / `setCurrentAction` / `setCurrentTarget` with the clicked point, then `setTaskedByPlayer`.
  const [order, aiAction] = aiStateForAction(action);
  setAiState(e, order, aiAction, target ? target.id : -1, target ? typeOf(ctx, target).group : -1, x, y, 0);
  if (e.ai) e.ai.notes = [];
}

/**
 * The action part of `work2`: the current action takes the order when it runs the same task (`action_work`) or
 * attacks the same target; otherwise the task's action replaces every action, and without one the unit walks there.
 * Returns the action type now at the top.
 */
function startTask(ctx: GameContext, e: Entity, t: UnitType, task: number, target: Entity | undefined, x: number, y: number): number {
  const w = e.work;
  if (w && task !== -1 && w.task === task) {
    if (w.type === ACTION_BUILD) {
      buildWork(ctx, e, w, target, x, y);
      return w.type;
    }
    if (w.type === ACTION_REPAIR) {
      repairWork(ctx, e, w, target, x, y);
      return w.type;
    }
    if (w.type === ACTION_ARTIFACT) {
      artifactWork(ctx, e, w, target, x, y);
      return w.type;
    }
    if (w.type === ACTION_TRANSPORT) {
      transportWork(ctx, e, w, target, x, y);
      return w.type;
    }
    if (w.type === ACTION_TRADE) {
      tradeWork(ctx, e, w, target, x, y);
      return w.type;
    }
    if (w.type === ACTION_CONVERT || w.type === ACTION_HEAL) {
      if (priestWork(ctx, e, w, target)) return w.type;
    } else if (workRetarget(ctx, e, w, target, x, y)) return w.type;
  }
  if (e.attack && !e.work && target && e.attack.target === target.id && attackWork(ctx, e, target)) return ACTION_ATTACK;
  const kind = task === -1 ? -1 : t.action!.tasks[task]!.actionType;
  if (kind === ACTION_REPAIR) {
    startRepair(ctx, e, task, target, x, y);
    return kind;
  }
  if (kind === ACTION_ARTIFACT) {
    startArtifact(ctx, e, task, target, x, y);
    return kind;
  }
  if (kind === ACTION_CONVERT || kind === ACTION_HEAL) {
    startPriestAction(ctx, e, kind, task, target, x, y);
    return kind;
  }
  if (kind === ACTION_ENTER && target) {
    startEnter(ctx, e, task, target);
    return kind;
  }
  if (kind === ACTION_TRANSPORT) {
    startTransport(ctx, e, task, x, y);
    return kind;
  }
  if (kind === ACTION_TRADE) {
    startTrade(ctx, e, task, target, x, y);
    return kind;
  }
  deleteActions(ctx, e);
  if (kind === ACTION_BUILD || kind === ACTION_GATHER || kind === ACTION_HUNT) {
    const a: WorkAction = { type: kind, task, state: 0, timer: 0, target: target ? target.id : -1, target2: -1, x, y, z: 0 };
    if (kind !== ACTION_BUILD) a.targetType = target ? target.type : -1;
    e.work = a;
    if (kind === ACTION_BUILD) buildFirstInStack(ctx, e, a);
    else firstInStack(ctx, e, a);
    return kind;
  }
  if (kind === TASK_ATTACK && target && t.combat) {
    // A task attack uses the task's sprites and work range (src/act_list.cpp:137-150).
    const k = t.action!.tasks[task]!;
    startAttack(ctx, e, target, k.moving, k.proceeding, k.workRange, false);
    return ACTION_ATTACK;
  }
  // No task, or one this port does not run yet: `move_to` the target or the point.
  startMoveTo(e, target ?? null, x, y, 0, MOVE_RANGE, null, false, ctx);
  return ACTION_MOVE;
}

/**
 * `gather` / `hunt` / `build` on the object for the unit AI (src/t_c_obj.cpp:498, 611): the current action of that kind
 * takes the new target; otherwise the unit's own task for the target, if it is of that kind, replaces every action.
 * The port does not swap the unit type here.
 */
export function aiWork(ctx: GameContext, e: Entity, target: Entity, kind: number): boolean {
  const w = e.work;
  if (w && w.type === kind) {
    if (kind === ACTION_BUILD) buildWork(ctx, e, w, target, target.x, target.y);
    else workRetarget(ctx, e, w, target, target.x, target.y);
    return true;
  }
  const t = typeOf(ctx, e);
  const task = targetTask(ctx, t, e, target);
  if (task === -1 || t.action!.tasks[task]!.actionType !== kind) return false;
  startTask(ctx, e, t, task, target, target.x, target.y);
  return true;
}

/**
 * `move_to` on a unit: its current gather/hunt action takes the order when it has one (`RGE_Action_List::
 * action_move_to`); returns false when there is none.
 */
export function workMoveTo(ctx: GameContext, e: Entity, x: number, y: number): boolean {
  const a = e.work;
  if (!a) return false;
  if (a.type === ACTION_BUILD) {
    buildMoveTo(ctx, e, a, x, y);
    return true;
  }
  if (a.type === ACTION_REPAIR) {
    repairMoveTo(ctx, e, a, x, y);
    return true;
  }
  if (a.type === ACTION_ARTIFACT) {
    artifactMoveTo(ctx, e, a, x, y);
    return true;
  }
  if (a.type === ACTION_TRANSPORT) {
    transportMoveTo(ctx, e, a, x, y);
    return true;
  }
  if (a.type === ACTION_TRADE) {
    tradeMoveTo(ctx, e, a, x, y);
    return true;
  }
  // `RGE_Action::move_to`: the convert, the heal and the enter do not take a walk.
  if (a.type === ACTION_CONVERT || a.type === ACTION_HEAL || a.type === ACTION_ENTER) return false;
  a.x = f32(x);
  a.y = f32(y);
  a.z = 0;
  a.target = -1;
  setState(ctx, e, a, WORK_MOVE_ORDER);
  return true;
}

function isDropSite(t: UnitType, target: Entity): boolean {
  const [site, backup] = t.action!.dropSites;
  return target.type === site || target.type === backup;
}

/** `RGE_Action_Gather::work` / `TRIBE_Action_Hunt::work` (src/act_gath.cpp:526, src/tact_hnt.cpp:554). */
function workRetarget(ctx: GameContext, e: Entity, a: WorkAction, target: Entity | undefined, x: number, y: number): boolean {
  if (!target) {
    a.x = x;
    a.y = y;
    a.z = 0;
    a.target = -1;
    setState(ctx, e, a, WORK_MOVE_ORDER);
    return true;
  }
  const gather = a.type === ACTION_GATHER;
  if (gather && target.id === a.target && (a.state === WORK_TO_TARGET || a.state === WORK_TURNING || a.state === WORK_WORKING)) return true;
  if (target.owner === e.owner && isDropSite(typeOf(ctx, e), target) && e.heldAmount > 0) {
    a.timer = 0;
    a.target = -1;
    a.x = a.y = a.z = -1;
    a.target2 = target.id;
    setState(ctx, e, a, WORK_DROP_OFF);
    return true;
  }
  a.target = target.id;
  if (gather) {
    a.x = target.x;
    a.y = target.y;
    a.z = target.z;
  }
  a.target2 = -1;
  setState(ctx, e, a, WORK_TO_TARGET);
  return true;
}

/** `first_in_stack(1)` (src/act_gath.cpp:57, src/tact_hnt.cpp:55). */
function firstInStack(ctx: GameContext, e: Entity, a: WorkAction): void {
  const task = taskOf(ctx, e, a);
  // Switching task throws the load away (economy.md §3.1).
  if (e.heldType !== task.resourceIn) setHeld(e, task.resourceIn, 0);
  const target = object(ctx, a.target);
  if (!target) return setState(ctx, e, a, WORK_WAITING);
  if (target.owner === e.owner && isDropSite(typeOf(ctx, e), target) && e.heldAmount > 0) {
    a.target2 = target.id;
    a.target = -1;
    a.x = a.y = a.z = -1;
    return setState(ctx, e, a, WORK_DROP_OFF);
  }
  setState(ctx, e, a, WORK_TO_TARGET);
}

function setHeld(e: Entity, type: number, amount: number): void {
  e.heldType = type;
  e.heldAmount = f32(amount);
}

/** `get_move_sprite`: the carry sprite while holding at least 1 of the task's type, else the task's move sprite. */
function moveSprite(e: Entity, task: Task): SpriteInfo | null {
  if (task.resourceIn !== -1 && e.heldType === task.resourceIn && Math.trunc(e.heldAmount) > 0 && task.carrying) return task.carrying;
  return task.moving;
}

/** `get_wait_sprite`: the carry sprite under the same test, else the standing sprite. */
function waitSprite(ctx: PlayerMasters, e: Entity, task: Task): SpriteInfo {
  if (task.resourceIn !== -1 && e.heldType === task.resourceIn && Math.trunc(e.heldAmount) > 0 && task.carrying) return task.carrying;
  return typeOf(ctx, e).standing;
}

/** Delete the sub-actions: the walk (its destructor stops the unit) and the attack. */
function deleteSubActions(e: Entity): void {
  e.attack = null;
  if (e.mover) endAction(e.mover);
}

/** `set_state` of both actions (src/act_gath.cpp:95, src/tact_hnt.cpp:88). */
function setState(ctx: GameContext, e: Entity, a: WorkAction, state: number): void {
  deleteSubActions(e);
  a.state = state;
  const task = taskOf(ctx, e, a);
  const hunt = a.type === ACTION_HUNT;
  switch (state) {
    case WORK_WAITING:
      requestTask(ctx, e, a);
      a.timer = f32(-10);
      newSprite(ctx, e, waitSprite(ctx, e, task));
      return;
    case WORK_IDLE:
      a.timer = 0;
      newSprite(ctx, e, waitSprite(ctx, e, task));
      a.target = -1;
      a.target2 = -1;
      a.x = a.y = a.z = -1;
      return;
    case WORK_TO_POINT:
    case WORK_MOVE_ORDER:
      a.timer = 0;
      startMoveTo(e, null, a.x, a.y, a.z, task.workRange, moveSprite(e, task), true, ctx);
      return;
    case WORK_TO_TARGET: {
      a.timer = 0;
      const target = object(ctx, a.target);
      if (!target) return setState(ctx, e, a, WORK_FAILED);
      a.x = target.x;
      a.y = target.y;
      a.z = target.z;
      if (hunt && target.state <= ObjectState.Active) return setState(ctx, e, a, WORK_KILLING);
      startMoveTo(e, target, 0, 0, 0, task.workRange, moveSprite(e, task), true, ctx);
      return;
    }
    case WORK_KILLING: {
      a.timer = 0;
      const target = object(ctx, a.target)!;
      startAttack(ctx, e, target, moveSprite(e, task), task.proceeding, task.workRange, true);
      return;
    }
    case WORK_TURNING:
      a.timer = 0;
      newSprite(ctx, e, moveSprite(e, task));
      return;
    case WORK_WORKING:
      a.timer = 0;
      if (e.heldType !== task.resourceIn) setHeld(e, task.resourceIn, 0);
      newSprite(ctx, e, hunt ? task.working : task.proceeding);
      return;
    case WORK_DROP_OFF: {
      if (e.heldAmount > 0) {
        if (a.target2 === -1) {
          const site = findDropSite(ctx, e);
          a.target2 = site ? site.id : -1;
        }
        const site = object(ctx, a.target2);
        if (site) {
          startMoveTo(e, site, 0, 0, 0, task.workRange, moveSprite(e, task), true, ctx);
          return;
        }
        // No drop site: a human player's gatherer fails (13), its hunter goes idle (2).
        return setState(ctx, e, a, hunt ? WORK_IDLE : WORK_FAILED);
      }
      const target = object(ctx, a.target);
      if (target && target.heldAmount <= 0 && (hunt || !keepsWorker(target))) a.target = -1;
      return setState(ctx, e, a, WORK_WAITING);
    }
    case WORK_DONE:
    case WORK_FAILED:
    case 14:
      a.timer = 0;
      newSprite(ctx, e, waitSprite(ctx, e, task));
      return;
  }
}

/** Waiting asks the unit AI for a task (`UNIT_AI_NOTIFY_REQUEST_TASK`, src/act_gath.cpp:98-101, :252-257, src/tact_hnt.cpp:102, :270). */
function requestTask(ctx: GameContext, e: Entity, a: WorkAction): void {
  notifyObject(ctx, e, e.id, NOTIFY_REQUEST_TASK, a.type === ACTION_HUNT ? AI_ACTION_HUNT : AI_ACTION_GATHER, a.targetType ?? -1);
}

/** `keepGatheringWhenObjectIsOut` (src/t_c_obj.cpp:665): farms (50) and docks (45). */
export function keepsWorker(target: Entity): boolean {
  return target.type === 50 || target.type === 45;
}

/**
 * `find_by_master_ids(drop_site, backup, x, y, 1, active, zone_obj)` (src/obj_list.cpp:452) over the owner's object list:
 * the active drop site with the smallest squared centre distance; ties keep the earlier object in the list. A land
 * gatherer passes itself as the zone object, so only a drop site whose tile is in its own zone counts; fishing and trade
 * boats pass none (`useSameZoneDropsite`, src/t_c_obj.cpp:685-690, src/act_gath.cpp:173; naval.md §2.2).
 */
export function findDropSite(ctx: GameContext, e: Entity): Entity | undefined {
  const t = typeOf(ctx, e);
  const [site, backup] = t.action!.dropSites;
  if (site === -1) return undefined;
  const zone = t.group === GROUP_FISHING_BOAT || t.group === GROUP_TRADE_BOAT ? -1 : lookupZone(ctx, e, toInt(e.x), toInt(e.y));
  let best: Entity | undefined;
  let bestDistance = 0;
  for (const o of ctx.objectsOf(e.owner)) {
    if ((o.type !== site && o.type !== backup) || o.state !== ObjectState.Active) continue;
    if (zone !== -1 && lookupZone(ctx, e, toInt(o.x), toInt(o.y)) !== zone) continue;
    const dx = sub32(o.x, e.x);
    const dy = sub32(o.y, e.y);
    const d = add32(mul32(dx, dx), mul32(dy, dy));
    if (!best || bestDistance > d) {
      best = o;
      bestDistance = d;
    }
  }
  return best;
}

/** Edge-to-edge distance above the drop threshold, compared squared (economy.md §3.5). */
function tooFarToDrop(ctx: PlayerMasters, e: Entity, site: Entity): boolean {
  const d = distanceToObject(ctx, e, site);
  return mul32(d, d) > DROP_DISTANCE;
}

/** The sub-action's update: the attack in state 12, else the walk (an empty list answers Remove). */
function updateSub(ctx: GameContext, e: Entity): ActionResult {
  if (e.attack) {
    const r = updateAttack(ctx, e);
    if (r === ActionResult.Remove) e.attack = null;
    return r;
  }
  const r = updateMover(ctx, e);
  if (r === ActionResult.Remove && e.mover) endAction(e.mover);
  return r;
}

/** `RGE_Action_Gather::update` / `TRIBE_Action_Hunt::update` (src/act_gath.cpp:227, src/tact_hnt.cpp:249). */
export function updateWork(ctx: GameContext, e: Entity): ActionResult {
  const a = e.work;
  if (!a) return ActionResult.Remove;
  if (a.type === ACTION_BUILD) return updateBuild(ctx, e, a);
  if (a.type === ACTION_REPAIR) return updateRepair(ctx, e, a);
  if (a.type === ACTION_ARTIFACT) return updateArtifact(ctx, e, a);
  if (a.type === ACTION_CONVERT) return updateConvert(ctx, e, a);
  if (a.type === ACTION_HEAL) return updateHeal(ctx, e, a);
  if (a.type === ACTION_ENTER) return updateEnter(ctx, e, a);
  if (a.type === ACTION_TRANSPORT) return updateTransport(ctx, e, a);
  if (a.type === ACTION_TRADE) return updateTrade(ctx, e, a);
  const hunt = a.type === ACTION_HUNT;
  const live = (id: number) => {
    const o = object(ctx, id);
    return o && o.state < ObjectState.PendingRemoval ? id : -1;
  };
  a.target = live(a.target);
  a.target2 = live(a.target2);
  const target = object(ctx, a.target);
  if (!hunt && target && target.owner !== 0 && target.owner !== e.owner) {
    setState(ctx, e, a, WORK_DONE);
    return ActionResult.TargetInvalid;
  }
  const task = taskOf(ctx, e, a);
  switch (a.state) {
    case WORK_WAITING:
      if (a.timer < 0) {
        a.timer = add32(a.timer, ctx.deltaSeconds);
        if (a.timer > 0) {
          a.timer = f32(-10);
          requestTask(ctx, e, a);
        }
      }
      return ActionResult.Continue;
    case WORK_TO_POINT:
    case WORK_MOVE_ORDER:
      switch (updateSub(ctx, e)) {
        case ActionResult.TargetInvalid:
          a.target = -1;
          setState(ctx, e, a, a.state);
          return ActionResult.Continue;
        case ActionResult.Remove:
        case ActionResult.Completed:
        case ActionResult.TargetLost:
          setState(ctx, e, a, a.state === WORK_TO_POINT ? WORK_WAITING : WORK_IDLE);
          return ActionResult.Continue;
        case ActionResult.Failed:
          setState(ctx, e, a, WORK_WAITING);
          return ActionResult.Continue;
      }
      return ActionResult.Continue;
    case WORK_TO_TARGET:
      switch (updateSub(ctx, e)) {
        case ActionResult.Failed:
          setState(ctx, e, a, WORK_WAITING);
          return ActionResult.Continue;
        case ActionResult.Remove:
        case ActionResult.Completed:
          setState(ctx, e, a, WORK_TURNING);
          return ActionResult.Continue;
        case ActionResult.TargetInvalid:
        case ActionResult.TargetLost:
          a.target = -1;
          setState(ctx, e, a, WORK_TO_POINT);
          return ActionResult.Continue;
      }
      return ActionResult.Continue;
    case WORK_KILLING:
      switch (updateSub(ctx, e)) {
        case ActionResult.TargetInvalid:
          a.target = -1;
          setState(ctx, e, a, WORK_TO_POINT);
          return ActionResult.Continue;
        case ActionResult.Remove:
        case ActionResult.Completed:
        case ActionResult.TargetLost:
          setState(ctx, e, a, object(ctx, a.target) ? WORK_TO_TARGET : WORK_WAITING);
          return ActionResult.Continue;
        case ActionResult.Failed:
          setState(ctx, e, a, WORK_WAITING);
          return ActionResult.Continue;
      }
      return ActionResult.Continue;
    case WORK_TURNING: {
      if (!target) {
        setState(ctx, e, a, WORK_WAITING);
        return ActionResult.Continue;
      }
      if (turnTowards(ctx, e, target.x, target.y)) {
        if (target.heldAmount > 0 || (!hunt && keepsWorker(target))) setState(ctx, e, a, WORK_WORKING);
        else {
          a.target = -1;
          setState(ctx, e, a, WORK_WAITING);
        }
      } else if (hunt) {
        // The hunt action gives up at once when the first turn does not face the target (src/tact_hnt.cpp:340-352).
        setState(ctx, e, a, WORK_WAITING);
      }
      return ActionResult.Continue;
    }
    case WORK_WORKING:
      if (!target) {
        setState(ctx, e, a, e.heldAmount > 0 ? WORK_DROP_OFF : WORK_WAITING);
        return ActionResult.Continue;
      }
      transfer(ctx, e, a, task, target);
      return ActionResult.Continue;
    case WORK_DROP_OFF:
      if (a.timer < 0) {
        a.timer = add32(a.timer, ctx.deltaSeconds);
        if (a.timer > 0) {
          a.timer = 0;
          if (hunt) a.target2 = -1;
          setState(ctx, e, a, WORK_DROP_OFF);
        }
        return ActionResult.Continue;
      }
      switch (updateSub(ctx, e)) {
        case ActionResult.Failed:
        case ActionResult.TargetInvalid:
        case ActionResult.TargetLost:
          a.timer = f32(-3);
          e.mover!.speed = 0;
          return ActionResult.Continue;
        case ActionResult.Remove:
        case ActionResult.Completed: {
          const site = object(ctx, a.target2);
          if (!site) {
            setState(ctx, e, a, WORK_DROP_OFF);
            return ActionResult.Continue;
          }
          if (tooFarToDrop(ctx, e, site)) {
            a.timer = f32(-3);
            e.mover!.speed = 0;
            return ActionResult.Continue;
          }
          deposit(ctx, e, task, !hunt);
          if (object(ctx, a.target)) {
            a.target2 = -1;
            setState(ctx, e, a, WORK_TO_TARGET);
          } else if (a.x !== -1 && a.y !== -1) setState(ctx, e, a, WORK_TO_POINT);
          else setState(ctx, e, a, WORK_IDLE);
          return ActionResult.Continue;
        }
      }
      return ActionResult.Continue;
    case WORK_DONE:
      if (hunt) setState(ctx, e, a, WORK_IDLE);
      return ActionResult.Remove;
    case WORK_FAILED:
      if (!hunt) setState(ctx, e, a, WORK_IDLE);
      return ActionResult.Failed;
  }
  return ActionResult.Continue;
}

/** State 7: one step's take (economy.md §3.3). */
function transfer(ctx: GameContext, e: Entity, a: WorkAction, task: Task, target: Entity): void {
  const t = typeOf(ctx, e);
  let give = mul32(mul32(task.workValue1, t.action!.workRate), ctx.deltaSeconds);
  if (give > target.heldAmount) give = target.heldAmount;
  const modifier = task.resourceMultiplier === -1 ? 1 : ctx.attributes[e.owner]![task.resourceMultiplier]!;
  let adjusted = mul32(modifier, give);
  const maxHold = mul32(t.resourceCapacity, modifier);
  const room = sub32(maxHold, e.heldAmount);
  if (adjusted > room) {
    const excess = sub32(adjusted, room);
    adjusted = sub32(adjusted, excess);
    give = sub32(give, div32(excess, modifier));
  }
  target.heldAmount = add32(-give, target.heldAmount);
  const cap = f32(Math.trunc(typeOf(ctx, target).resourceCapacity));
  if (cap < target.heldAmount) target.heldAmount = cap;
  e.heldAmount = add32(adjusted, e.heldAmount);
  const more = target.heldAmount > 0 || (a.type === ACTION_GATHER && keepsWorker(target));
  if (e.heldAmount < maxHold && more) return;
  setState(ctx, e, a, WORK_DROP_OFF);
}

/** Deposit (economy.md §3.5 step 4): the owner gains the load as a float; gold is also "earned" for gatherers. */
function deposit(ctx: GameContext, e: Entity, task: Task, earned: boolean): void {
  const attr = task.resourceOut === -1 ? e.heldType : task.resourceOut;
  const attrs = ctx.attributes[e.owner]!;
  attrs[attr] = add32(attrs[attr]!, e.heldAmount);
  if (earned && attr === ATTR_GOLD) attrs[ATTR_GOLD_EARNED] = add32(attrs[ATTR_GOLD_EARNED]!, e.heldAmount);
  setHeld(e, -1, 0);
}

/** For the client: the type a work order on `target` would make `e` (after any swap), or -1 when it has no task. */
export function workTaskType(ctx: PlayerMasters & DiplomacyContext, e: Entity, target: Entity): number {
  const t = typeOf(ctx, e);
  if (targetTask(ctx, t, e, target) !== -1) return t.id;
  if (!t.action || t.action.taskSwapGroup === 0) return -1;
  for (const other of swapTypes(ctx, e.owner, t)) if (targetTask(ctx, other, e, target) !== -1) return other.id;
  return -1;
}

/**
 * The action type of the task `e` would take for `target`: its own task list's, else one of its task group's (as
 * `workTaskType`); -1 when none has one. The check `RGE_Main_View::pick_best_target` makes for an order mode's action
 * type (src/vw_main.cpp:1117): Heal 105, Convert 104. A read for the client; it changes nothing.
 */
export function targetActionType(ctx: PlayerMasters & DiplomacyContext, e: Entity, target: Entity): number {
  const t = typeOf(ctx, e);
  for (const type of [t, ...(t.action && t.action.taskSwapGroup !== 0 ? swapTypes(ctx, e.owner, t) : [])]) {
    const i = targetTask(ctx, type, e, target);
    if (i !== -1) return type.action!.tasks[i]!.actionType;
  }
  return -1;
}

/**
 * `RGE_Action_Object::getTask` (src/act_obj.cpp:455): the unit's own task for `target`, else the first task of a type
 * of its task group (in id order), which the unit then becomes. -1 when none has one.
 */
export function getTask(ctx: GameContext, e: Entity, target: Entity): number {
  const t = typeOf(ctx, e);
  const own = targetTask(ctx, t, e, target);
  if (own !== -1 || !t.action || t.action.taskSwapGroup === 0) return own;
  for (const other of swapTypes(ctx, e.owner, t)) {
    const i = targetTask(ctx, other, e, target);
    if (i === -1) continue;
    transform(ctx, e, other);
    return i;
  }
  return -1;
}

/** Masters a unit of type `t` may become, in ascending id order (`master_objects`, src/act_obj.cpp:160-172). */
function swapTypes(ctx: PlayerMasters, owner: number, t: UnitType): UnitType[] {
  const group = t.action!.taskSwapGroup;
  return Object.values(ctx.masters[owner]!)
    .filter((o) => o.group === t.group && o.masterType === t.masterType && o.action?.taskSwapGroup === group)
    .sort((a, b) => a.id - b.id);
}
