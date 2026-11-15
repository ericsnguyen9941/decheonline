/**
 * `TRIBE_Action_Repair` (action 106, docs/spec/support-actions.md §6): walk to an own building, face it, heal it each
 * step, paying half its build cost over a full bar. It shares the gather action's record (`WorkAction`); `gather.ts`
 * routes orders and updates of type 106 here. Boats are not in the sim, so the boat rendezvous (`meet_target`, the
 * state 10 boat order) is not ported.
 */
import { payObjCost } from './buildings';
import { distanceToObject, turnTowards } from './combat';
import type { GameContext } from './context';
import { isAlly, type DiplomacyContext } from './diplomacy';
import { ObjectState, type Entity } from './entities';
import { deleteActions, getTask, transform, type WorkAction } from './gather';
import { master, typeOf, type PlayerMasters } from './masters';
import { ActionResult, endAction, startMoveTo, updateMover } from './movement';
import { add32, div32, f32, mul32, sub32 } from './num';
import { newSprite } from './sprites';
import { AI_ACTION_REPAIR, AI_ORDER_REPAIR, NOTIFY_ACTION_COMPLETED, NOTIFY_ACTION_FAILED, NOTIFY_TARGET_INVALID, notifyObject, setAiState } from './unit-ai';
import type { Task, UnitType } from './units';

export const ACTION_REPAIR = 106;
/** `MASTER_OBJECT_REPAIR_MAN`: every repairer becomes one (src/t_c_obj.cpp:593, :1021). */
export const REPAIR_MAN = 156;

/** Repair states (`src/tact_rep.cpp`). */
const REPAIR_DONE = 1;
const REPAIR_IDLE = 2;
const REPAIR_WAITING = 3;
const REPAIR_TO_TARGET = 4;
const REPAIR_TURNING = 6;
const REPAIR_WORKING = 7;
const REPAIR_OUT_OF_REACH = 10;
const REPAIR_TO_POINT = 11;
const REPAIR_FAILED = 13;

/** `g_repair_distance_offset`, `g_repair_distance_threshold` (src/game_globals.cpp:343-344). */
const REPAIR_DISTANCE_OFFSET = f32(2);
const REPAIR_DISTANCE_THRESHOLD = 0.4;
/** The out-of-reach wait before the reach test runs again (src/tact_rep.cpp:121, :293). */
const REPAIR_WAIT = f32(1);
const MASTER_TYPE_BUILDING = 80;
/** `MASTER_OBJECT_FARM`: never repaired by a right click (src/ttsk_lst.cpp:85). */
const FARM = 50;

function taskOf(ctx: PlayerMasters, e: Entity, a: WorkAction): Task {
  return typeOf(ctx, e).action!.tasks[a.task]!;
}

function object(ctx: GameContext, id: number): Entity | undefined {
  return id === -1 ? undefined : ctx.entities.get(id);
}

/**
 * The repair pass of `TRIBE_Task_List::get_target_task` (src/ttsk_lst.cpp:82-92): an own building short of hit points,
 * not dying and not a Farm, takes the first repair task of class -1 or 0, and nothing else; null when the pass does not
 * apply. Its own or a building of a player its owner calls an ally (`isAlly`, src/ttsk_lst.cpp:82). The boat pass after it
 * has no target here.
 */
export function repairTaskFor(ctx: PlayerMasters & DiplomacyContext, t: UnitType, e: Entity, target: Entity): number | null {
  if (!isAlly(ctx, e.owner, target.owner)) return null;
  const tt = typeOf(ctx, target);
  if (tt.masterType !== MASTER_TYPE_BUILDING || !(target.hp < f32(tt.hitPoints)) || target.state >= ObjectState.Dying || tt.id === FARM) return null;
  return (t.action?.tasks ?? []).findIndex((k) => k.actionType === ACTION_REPAIR && (k.group === -1 || k.group === 0));
}

/** A new repair action on `target` (`TRIBE_Action_Repair(obj, task, target)` then `first_in_stack(1)`), the only one. */
export function startRepair(ctx: GameContext, e: Entity, task: number, target: Entity | undefined, x: number, y: number): void {
  deleteActions(ctx, e);
  const a: WorkAction = { type: ACTION_REPAIR, task, state: 0, timer: 0, target: target ? target.id : -1, target2: -1, x: f32(x), y: f32(y), z: 0 };
  if (target) {
    a.x = target.x;
    a.y = target.y;
    a.z = target.z;
  }
  e.work = a;
  setState(ctx, e, a, target ? REPAIR_TO_TARGET : REPAIR_WAITING);
}

/** `set_state` (src/tact_rep.cpp:76-165): the sub-action (the walk) is always deleted first. */
function setState(ctx: GameContext, e: Entity, a: WorkAction, state: number): void {
  if (e.mover) endAction(e.mover);
  a.state = state;
  const task = taskOf(ctx, e, a);
  const t = typeOf(ctx, e);
  switch (state) {
    case REPAIR_WAITING:
      // Waiting asks the unit AI for a task (`UNIT_AI_NOTIFY_REQUEST_TASK`); a human player's civilian gets none.
      return;
    case REPAIR_TO_POINT:
      startMoveTo(e, null, a.x, a.y, a.z, 0, task.moving, true, ctx);
      return;
    case REPAIR_TO_TARGET: {
      const target = object(ctx, a.target);
      if (target) {
        a.x = target.x;
        a.y = target.y;
        a.z = target.z;
      }
      // Up to the repairer's weapon range (0 for the Repair_Man).
      startMoveTo(e, target ?? null, a.x, a.y, a.z, t.combat?.range ?? 0, task.moving, true, ctx);
      return;
    }
    case REPAIR_OUT_OF_REACH:
      newSprite(ctx, e, t.standing);
      a.timer = REPAIR_WAIT;
      return;
    case REPAIR_TURNING: {
      const target = object(ctx, a.target);
      if (target) {
        a.x = target.x;
        a.y = target.y;
        a.z = target.z;
      }
      newSprite(ctx, e, task.moving);
      return;
    }
    case REPAIR_WORKING:
      // `work_sprite`.
      newSprite(ctx, e, task.proceeding);
      return;
    case REPAIR_DONE:
      a.target = -1;
      notifyObject(ctx, e, e.id, NOTIFY_ACTION_COMPLETED, AI_ACTION_REPAIR);
      newSprite(ctx, e, t.standing);
      return;
    case REPAIR_IDLE:
      newSprite(ctx, e, t.standing);
      return;
  }
}

/** `TRIBE_Action_Repair::work` (src/tact_rep.cpp:330): a new target (kept while walking to or facing it), or a point. */
export function repairWork(ctx: GameContext, e: Entity, a: WorkAction, target: Entity | undefined, x: number, y: number): void {
  if (target) {
    if (target.id === a.target && (a.state === REPAIR_TO_TARGET || a.state === REPAIR_TURNING)) return;
    a.target = target.id;
    a.x = target.x;
    a.y = target.y;
    a.z = target.z;
    setState(ctx, e, a, REPAIR_TO_TARGET);
    return;
  }
  repairMoveTo(ctx, e, a, x, y);
}

/** `TRIBE_Action_Repair::move_to` (src/tact_rep.cpp:321): walk to the point, then the action ends. */
export function repairMoveTo(ctx: GameContext, e: Entity, a: WorkAction, x: number, y: number): void {
  a.x = f32(x);
  a.y = f32(y);
  a.z = 0;
  a.target = -1;
  setState(ctx, e, a, REPAIR_TO_POINT);
}

/** The reach test (src/tact_rep.cpp:225-232): edge distance less 2.0 within 0.4. */
function inReach(ctx: GameContext, e: Entity, target: Entity): boolean {
  return sub32(distanceToObject(ctx, e, target), REPAIR_DISTANCE_OFFSET) <= REPAIR_DISTANCE_THRESHOLD;
}

/** Drop the target and finish (`invalid_target`). */
function invalidTarget(ctx: GameContext, e: Entity, a: WorkAction): ActionResult {
  a.target = -1;
  setState(ctx, e, a, REPAIR_DONE);
  return ActionResult.Continue;
}

/**
 * `TRIBE_Action_Repair::update` (src/tact_rep.cpp:167-314, status N; support-actions.md §6.2). A target that is gone,
 * not active, or not the unit's own or a player's its owner calls an ally (`isAlly`, src/tact_rep.cpp:188) ends the action.
 */
export function updateRepair(ctx: GameContext, e: Entity, a: WorkAction): ActionResult {
  if (a.target !== -1 && !object(ctx, a.target)) return invalidTarget(ctx, e, a);
  if (a.target2 !== -1 && !object(ctx, a.target2)) a.target2 = -1;
  const target = object(ctx, a.target);
  if (target && (target.state !== ObjectState.Active || !isAlly(ctx, e.owner, target.owner))) return invalidTarget(ctx, e, a);
  switch (a.state) {
    case REPAIR_TO_POINT:
      switch (updateMover(ctx, e)) {
        case ActionResult.TargetInvalid:
          a.target = -1;
          setState(ctx, e, a, REPAIR_TO_POINT);
          break;
        case ActionResult.Remove:
        case ActionResult.Completed:
        case ActionResult.Failed:
        case ActionResult.TargetLost:
          setState(ctx, e, a, REPAIR_DONE);
          break;
      }
      return ActionResult.Continue;
    case REPAIR_TO_TARGET:
      switch (updateMover(ctx, e)) {
        case ActionResult.Remove:
        case ActionResult.Completed:
        case ActionResult.Failed:
          setState(ctx, e, a, target && inReach(ctx, e, target) ? REPAIR_TURNING : REPAIR_OUT_OF_REACH);
          return ActionResult.Continue;
        case ActionResult.TargetInvalid:
        case ActionResult.TargetLost:
          return invalidTarget(ctx, e, a);
      }
      return ActionResult.Continue;
    case REPAIR_TURNING:
      if (!target) setState(ctx, e, a, REPAIR_DONE);
      else if (turnTowards(ctx, e, target.x, target.y)) setState(ctx, e, a, REPAIR_WORKING);
      return ActionResult.Continue;
    case REPAIR_WORKING: {
      if (!target) {
        setState(ctx, e, a, REPAIR_DONE);
        return ActionResult.Continue;
      }
      if (target.x !== a.x || target.y !== a.y) {
        // The target moved: no repair this step.
        if (!inReach(ctx, e, target)) setState(ctx, e, a, REPAIR_WAITING);
        else {
          a.x = target.x;
          a.y = target.y;
          a.z = target.z;
        }
        return ActionResult.Continue;
      }
      const amount = mul32(mul32(taskOf(ctx, e, a).workValue1, ctx.deltaSeconds), typeOf(ctx, e).action!.workRate);
      const result = heal(ctx, target, amount);
      if (result === HEAL_FULL) setState(ctx, e, a, REPAIR_DONE);
      else if (result === HEAL_UNPAID) {
        // `GAME_NOTIFY_CANNOT_REPAIR` tells the owner's screen; the action idles.
        notifyObject(ctx, e, e.id, NOTIFY_TARGET_INVALID, AI_ACTION_REPAIR);
        setState(ctx, e, a, REPAIR_IDLE);
      }
      return ActionResult.Continue;
    }
    case REPAIR_OUT_OF_REACH:
      if (!target) return ActionResult.Continue;
      a.timer = sub32(a.timer, ctx.deltaSeconds);
      if (a.timer <= 0) {
        if (inReach(ctx, e, target)) setState(ctx, e, a, REPAIR_TURNING);
        else a.timer = REPAIR_WAIT;
      }
      return ActionResult.Continue;
    case REPAIR_DONE:
      return ActionResult.Remove;
    case REPAIR_FAILED:
      notifyObject(ctx, e, e.id, NOTIFY_ACTION_FAILED, AI_ACTION_REPAIR);
      setState(ctx, e, a, REPAIR_IDLE);
      return ActionResult.Failed;
  }
  return ActionResult.Continue;
}

/** `heal`'s results: still short, full, the owner could not pay. */
const HEAL_SHORT = 0;
export const HEAL_FULL = 1;
export const HEAL_UNPAID = 2;

/**
 * `TRIBE_Building_Object::heal` (src/t_b_obj.cpp:215, support-actions.md §6.3): a building scales the amount by hit
 * points over build points, clamps it to the missing hit points and pays `healing / (2 * hp)` of its cost; then
 * `RGE_Static_Object::heal` (src/stat_obj.cpp:2224) adds it. Other objects (no boats in the sim) heal for free. The
 * priest's heal (`priest.ts`) calls it too.
 */
export function heal(ctx: GameContext, target: Entity, amount: number): number {
  const t = typeOf(ctx, target);
  let healing = amount;
  if (t.masterType === MASTER_TYPE_BUILDING) {
    const maxHp = f32(t.hitPoints);
    healing = div32(mul32(healing, maxHp), f32(t.creatable!.trainTime));
    if (add32(healing, target.hp) > maxHp) healing = sub32(maxHp, target.hp);
    if (!payObjCost(ctx, target.owner, t.id, div32(healing, f32(t.hitPoints * 2)), false)) return HEAL_UNPAID;
  }
  target.hp = add32(healing, target.hp);
  if (healing < 0 && target.hp < 1) target.hp = f32(1);
  if (t.hitPoints <= target.hp) {
    target.hp = f32(t.hitPoints);
    return HEAL_FULL;
  }
  return HEAL_SHORT;
}

/**
 * `TRIBE_Combat_Object::do_repair` (src/t_c_obj.cpp:1007), the repair command: the unit becomes its owner's Repair_Man,
 * takes the first repair task for the target (class -1 or 0 for any building, else the target's class); the current
 * repair action takes the target when it runs that task, else a new one replaces every action. The unit AI records the
 * order (`UNIT_AI_ORDER_REPAIR`), or none when no task fits.
 */
export function doRepair(ctx: GameContext, e: Entity, target: Entity): void {
  if (target === e) return;
  if (e.type !== REPAIR_MAN) transform(ctx, e, master(ctx, e.owner, REPAIR_MAN));
  const t = typeOf(ctx, e);
  const tt = typeOf(ctx, target);
  const task = (t.action?.tasks ?? []).findIndex(
    (k) => k.actionType === ACTION_REPAIR && ((tt.masterType === MASTER_TYPE_BUILDING && (k.group === -1 || k.group === 0)) || k.group === tt.group),
  );
  let repairing = false;
  const w = e.work;
  if (task !== -1 && w?.type === ACTION_REPAIR && w.task === task) {
    repairWork(ctx, e, w, target, target.x, target.y);
    repairing = true;
  } else if (task !== -1) {
    startRepair(ctx, e, task, target, target.x, target.y);
    repairing = true;
  }
  if (repairing) setAiState(e, AI_ORDER_REPAIR, AI_ACTION_REPAIR, target.id, tt.group, target.x, target.y, target.z);
  else setAiState(e, -1, -1, target.id, tt.group, target.x, target.y, target.z);
}

/**
 * `TRIBE_Combat_Object::repair(target, unconditional)` (src/t_c_obj.cpp:579), the unit AI's repair order: a repair
 * action already on the target is kept (unless unconditional); a repair action takes the new target; otherwise the unit
 * becomes the Repair_Man and a repair action runs the task `getTask` picks for the target. False when there is none.
 */
export function aiRepair(ctx: GameContext, e: Entity, target: Entity, unconditional: boolean): boolean {
  const w = e.work;
  if (!unconditional && w?.type === ACTION_REPAIR && w.target === target.id) return true;
  if (w?.type === ACTION_REPAIR) {
    repairWork(ctx, e, w, target, target.x, target.y);
    return true;
  }
  if (e.type !== REPAIR_MAN) transform(ctx, e, master(ctx, e.owner, REPAIR_MAN));
  const task = getTask(ctx, e, target);
  if (task === -1) return false;
  startRepair(ctx, e, task, target, target.x, target.y);
  return true;
}
