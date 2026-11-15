/**
 * The Priest's actions (docs/spec/support-actions.md §4, §5): `TRIBE_Action_Convert` (action 104) with faith, the roll
 * and martyrdom, and `TRIBE_Action_Heal` (action 105). Both share the gather action's record (`WorkAction`, `range` the
 * convert's `requiredRange`); `gather.ts` routes orders and updates of these types here. The game notifications
 * (`GAME_NOTIFY_CONVERSION_*`) and the work sound are the client's; boats are not in the sim.
 */
import { distanceToObject, turnTowards } from './combat';
import type { GameContext } from './context';
import { isAlly } from './diplomacy';
import { ObjectState, type Entity } from './entities';
import { deleteActions, getTask, type WorkAction } from './gather';
import { typeOf, type PlayerMasters } from './masters';
import { ActionResult, endAction, startMoveTo, updateMover } from './movement';
import { add32, f32, mul32, sub32 } from './num';
import { heal, HEAL_FULL, HEAL_UNPAID } from './repair';
import { newSprite } from './sprites';
import {
  AI_ACTION_CONVERT,
  AI_ACTION_HEAL,
  NOTIFY_ACTION_FAILED,
  NOTIFY_ATTACKED,
  NOTIFY_REQUEST_TASK,
  NOTIFY_TARGET_INVALID,
  notifyObject,
} from './unit-ai';
import type { Task } from './units';

export const ACTION_CONVERT = 104;
export const ACTION_HEAL = 105;

/** `OBJECT_GROUP_PRIEST` and the other groups the convert and heal rules name (include/m_s_obj.h:23-52). */
export const GROUP_PRIEST = 18;
const GROUP_BUILDING = 3;
const GROUP_WALL = 27;
const GROUP_FLAG = 30;
const GROUP_CHARIOT = 35;
const GROUP_CHARIOT_ARCHER = 23;
/** Trade, transport, fishing and war boats. */
const BOAT_GROUPS = [2, 20, 21, 22];
/** Masters a priest never converts (src/tact_cnv.cpp:69-87): Town_Center1, artifact, the two ruins, the Wonder. */
const TOWN_CENTER = 109;
const ARTIFACT = 159;
const RUINS = [158, 163];
const WONDER = 276;
/** `MASTER_OBJECT_FLARE`: the minimap flare the converted player sees. */
const FLARE = 112;
/** `CIVILIZATION_MACEDONIAN` (include/tribegam.h:27). */
const CIV_MACEDONIAN = 16;

/** Player attributes (include/player.h:44-62). */
const ATTR_PRIEST_CONVERSION = 27;
const ATTR_BUILDING_CONVERSION = 28;
const ATTR_FAITH_RECHARGE = 35;
const ATTR_CONVERSIONS = 41;
const ATTR_HEAL_RATE = 56;
export const ATTR_MARTYRDOM = 57;
/** `RGE_RESOURCE_FAITH`, the priest's held attribute. */
export const RESOURCE_FAITH = 34;
export const FAITH_MAX = f32(100);

/** `g_conversion_*` and `g_heal_*` (src/game_globals.cpp:331-337, support-actions.md §3). */
const CONVERSION_RANDOM_SCALE = f32(3.051851e-5);
const CONVERSION_PLAYER_FACTOR = f32(4);
const CONVERSION_GROUP_FACTOR = f32(8);
const HEAL_ATTRIBUTE_THRESHOLD = f32(0.1);
const HEAL_DISTANCE_THRESHOLD = 0.5;
/** The heal's approach range (src/tact_hea.cpp:89). */
const HEAL_RANGE = f32(0.4);

/** Action states (`src/tact_cnv.cpp`, `src/tact_hea.cpp`). */
const DONE = 1;
const IDLE = 2;
const WAITING = 3;
const TO_TARGET = 4;
const TURNING = 6;
const WORKING = 7;
const TO_POINT = 11;
const FAILED = 13;

function taskOf(ctx: PlayerMasters, e: Entity, a: WorkAction): Task {
  return typeOf(ctx, e).action!.tasks[a.task]!;
}

function object(ctx: GameContext, id: number): Entity | undefined {
  return id === -1 ? undefined : ctx.entities.get(id);
}

function latch(a: WorkAction, target: Entity): void {
  a.x = target.x;
  a.y = target.y;
  a.z = target.z;
}

/**
 * `TRIBE_Combat_Object::update` (src/t_c_obj.cpp:146-155, support-actions.md §4.1): an active priest's faith grows by the
 * owner's recharge rate (attribute 35) per second up to 100, before the rest of its update.
 */
export function rechargeFaith(ctx: GameContext, e: Entity): void {
  if (typeOf(ctx, e).group !== GROUP_PRIEST || e.state !== ObjectState.Active) return;
  e.heldAmount = add32(e.heldAmount, mul32(ctx.attributes[e.owner]![ATTR_FAITH_RECHARGE]!, ctx.deltaSeconds));
  if (e.heldAmount >= FAITH_MAX) e.heldAmount = FAITH_MAX;
  e.heldType = RESOURCE_FAITH;
}

/** A new action of `type` on `target` (`create_task_action` then `set_only_action`, `first_in_stack(1)`), the only one. */
export function startPriestAction(ctx: GameContext, e: Entity, type: number, task: number, target: Entity | undefined, x: number, y: number): void {
  deleteActions(ctx, e);
  const a: WorkAction = { type, task, state: 0, timer: 0, target: target ? target.id : -1, target2: -1, x: f32(x), y: f32(y), z: 0 };
  if (type === ACTION_CONVERT) a.range = f32(1);
  if (target) latch(a, target);
  e.work = a;
  if (type === ACTION_CONVERT) convertFirstInStack(ctx, e, a, true);
  else healFirstInStack(ctx, e, a);
}

/** `TRIBE_Action_Convert::work` / `TRIBE_Action_Heal::work`: a new target, kept while walking to, facing or working on it. */
export function priestWork(ctx: GameContext, e: Entity, a: WorkAction, target: Entity | undefined): boolean {
  if (!target) return false;
  if (target.id === a.target && (a.state === TO_TARGET || a.state === TURNING || a.state === WORKING)) return true;
  a.target = target.id;
  latch(a, target);
  if (a.type === ACTION_CONVERT) convertFirstInStack(ctx, e, a, true);
  else healFirstInStack(ctx, e, a);
  return true;
}

/** `TRIBE_Action_Convert::first_in_stack` (src/tact_cnv.cpp:58-131, support-actions.md §4.2), for a human owner. */
function convertFirstInStack(ctx: GameContext, e: Entity, a: WorkAction, firstTime: boolean): void {
  const target = object(ctx, a.target);
  if (target) {
    const tt = typeOf(ctx, target);
    const group = tt.group;
    if (tt.id === TOWN_CENTER || group === GROUP_WALL || tt.id === ARTIFACT || RUINS.includes(tt.id) || tt.id === WONDER) return convertState(ctx, e, a, FAILED);
    // The only faith check: once under way, a later attempt needs none.
    if (e.heldAmount < 100) return convertState(ctx, e, a, FAILED);
    a.range = group === GROUP_BUILDING ? f32(1) : (typeOf(ctx, e).combat?.range ?? 0);
    if (group === GROUP_FLAG) return convertState(ctx, e, a, FAILED);
    const attributes = ctx.attributes[e.owner]!;
    if (group === GROUP_PRIEST && attributes[ATTR_PRIEST_CONVERSION]! <= 0) return convertState(ctx, e, a, FAILED);
    if (group === GROUP_BUILDING && attributes[ATTR_BUILDING_CONVERSION]! <= 0) return convertState(ctx, e, a, FAILED);
  }
  convertState(ctx, e, a, firstTime && target ? TO_TARGET : WAITING);
}

/** `TRIBE_Action_Convert::set_state` (src/tact_cnv.cpp:133-202): the sub-action (the walk) is always deleted first. */
function convertState(ctx: GameContext, e: Entity, a: WorkAction, state: number): void {
  if (e.mover) endAction(e.mover);
  a.state = state;
  const task = taskOf(ctx, e, a);
  switch (state) {
    case WAITING:
      notifyObject(ctx, e, e.id, NOTIFY_REQUEST_TASK, AI_ACTION_CONVERT);
      newSprite(ctx, e, null);
      return;
    case TO_POINT:
      startMoveTo(e, null, a.x, a.y, a.z, a.range ?? f32(1), task.moving, true, ctx);
      return;
    case TO_TARGET: {
      const target = object(ctx, a.target);
      if (target) latch(a, target);
      startMoveTo(e, target ?? null, a.x, a.y, a.z, a.range ?? f32(1), task.moving, true, ctx);
      return;
    }
    case TURNING:
      newSprite(ctx, e, task.moving);
      return;
    case WORKING: {
      newSprite(ctx, e, task.proceeding);
      // The converted player's flare (src/tact_cnv.cpp:179-183): an object, so its setup draws.
      const target = object(ctx, a.target);
      if (target && target.owner > 0) ctx.create(target.owner, FLARE, e.x, e.y, e.z);
      a.timer = task.workValue2;
      return;
    }
    case DONE:
    case IDLE:
    case FAILED:
      newSprite(ctx, e, null);
      return;
  }
}

/** The faith-zeroing abort (src/tact_cnv.cpp:228-236): the target is the priest's owner's or an ally's. */
function convertAllyAbort(ctx: GameContext, e: Entity, a: WorkAction): ActionResult {
  if (a.state === WORKING || a.state === TURNING || a.state === TO_TARGET) setFaith(e, 0);
  convertState(ctx, e, a, DONE);
  notifyObject(ctx, e, e.id, NOTIFY_TARGET_INVALID, AI_ACTION_CONVERT);
  return ActionResult.TargetInvalid;
}

/** `set_attribute(RGE_RESOURCE_FAITH, amount)`. */
function setFaith(e: Entity, amount: number): void {
  e.heldType = RESOURCE_FAITH;
  e.heldAmount = f32(amount);
}

/**
 * The success branch (src/tact_cnv.cpp:321-327, :378-384): the target becomes the priest's owner's, who counts one more
 * conversion (attribute 41), and the priest's faith is spent.
 */
function convertTarget(ctx: GameContext, e: Entity, a: WorkAction, target: Entity): void {
  ctx.changeOwnership(target, e.owner);
  const attributes = ctx.attributes[e.owner]!;
  attributes[ATTR_CONVERSIONS] = add32(attributes[ATTR_CONVERSIONS] ?? 0, 1);
  setFaith(e, 0);
  convertState(ctx, e, a, WAITING);
}

/**
 * The roll (src/tact_cnv.cpp:302-320, support-actions.md §4.4): `rand() × 1/32767`, ×4 for a Macedonian owner's target,
 * else ×2 for a boat or a priest and ×8 for a chariot or chariot archer; it succeeds at or below the task's `work_val1`
 * times the priest's work rate.
 */
export function conversionSucceeds(ctx: GameContext, e: Entity, a: WorkAction, target: Entity, r: number): boolean {
  let chance = mul32(f32(r), CONVERSION_RANDOM_SCALE);
  const group = typeOf(ctx, target).group;
  if (ctx.civs[target.owner] === CIV_MACEDONIAN) chance = mul32(chance, CONVERSION_PLAYER_FACTOR);
  else if (BOAT_GROUPS.includes(group) || group === GROUP_PRIEST) chance = add32(chance, chance);
  else if (group === GROUP_CHARIOT || group === GROUP_CHARIOT_ARCHER) chance = mul32(chance, CONVERSION_GROUP_FACTOR);
  return chance <= mul32(taskOf(ctx, e, a).workValue1, typeOf(ctx, e).action!.workRate);
}

/** `TRIBE_Action_Convert::update` (src/tact_cnv.cpp:204-347, support-actions.md §4.3-§4.4). */
export function updateConvert(ctx: GameContext, e: Entity, a: WorkAction): ActionResult {
  if (a.target !== -1 && !object(ctx, a.target)) {
    a.target = -1;
    convertState(ctx, e, a, WAITING);
    return ActionResult.Continue;
  }
  if (a.target2 !== -1 && !object(ctx, a.target2)) a.target2 = -1;
  const target = object(ctx, a.target);
  // Only an active target: a construction site is dropped (the decomp's AI-priest loop, src/tact_cnv.cpp:219-221).
  if (target && target.state !== ObjectState.Active) {
    a.target = -1;
    convertState(ctx, e, a, WAITING);
    return ActionResult.Continue;
  }
  if (target && isAlly(ctx, e.owner, target.owner)) return convertAllyAbort(ctx, e, a);
  switch (a.state) {
    case TO_POINT:
      switch (updateMover(ctx, e)) {
        case ActionResult.Failed:
          convertState(ctx, e, a, FAILED);
          break;
        case ActionResult.TargetInvalid:
          a.target = -1;
          convertState(ctx, e, a, TO_POINT);
          break;
        case ActionResult.Remove:
        case ActionResult.Completed:
        case ActionResult.TargetLost:
          convertState(ctx, e, a, WAITING);
          break;
      }
      return ActionResult.Continue;
    case TO_TARGET:
      switch (updateMover(ctx, e)) {
        case ActionResult.TargetInvalid:
        case ActionResult.TargetLost:
          a.target = -1;
          convertState(ctx, e, a, TO_POINT);
          break;
        case ActionResult.Failed:
          convertState(ctx, e, a, FAILED);
          break;
        case ActionResult.Remove:
        case ActionResult.Completed:
          convertState(ctx, e, a, TURNING);
          break;
      }
      return ActionResult.Continue;
    case TURNING:
      if (!target) convertState(ctx, e, a, WAITING);
      else if (turnTowards(ctx, e, target.x, target.y)) convertState(ctx, e, a, WORKING);
      return ActionResult.Continue;
    case WORKING: {
      if (!target) {
        convertState(ctx, e, a, WAITING);
        return ActionResult.Continue;
      }
      notifyObject(ctx, target, e.id, NOTIFY_ATTACKED, e.id, Math.trunc(target.hp));
      a.timer = sub32(a.timer, ctx.deltaSeconds);
      if (a.timer <= 0) {
        if (target.owner > 0) ctx.create(target.owner, FLARE, e.x, e.y, e.z);
        const r = ctx.rng.rand();
        if (conversionSucceeds(ctx, e, a, target, r)) convertTarget(ctx, e, a, target);
        // Success or not, the approach starts again; the next state 7 resets the timer.
        convertState(ctx, e, a, TO_TARGET);
      }
      return ActionResult.Continue;
    }
    case DONE:
      return ActionResult.Remove;
    case FAILED:
      notifyObject(ctx, e, e.id, NOTIFY_ACTION_FAILED, AI_ACTION_CONVERT);
      convertState(ctx, e, a, IDLE);
      return ActionResult.Failed;
  }
  return ActionResult.Continue;
}

/**
 * `TRIBE_Combat_Object::die_die_die` → `TRIBE_Action_Convert::martyrdom` (src/t_c_obj.cpp:202-210, src/tact_cnv.cpp:366-385,
 * support-actions.md §4.5): an active priest whose owner has Martyrdom (attribute 57 ≥ 1), killed while its convert is in
 * state 7 on a target that is not a priest, converts the target at once: no roll, no flare.
 */
export function martyrdom(ctx: GameContext, e: Entity): void {
  if (e.state !== ObjectState.Active || !(ctx.attributes[e.owner]![ATTR_MARTYRDOM]! >= 1)) return;
  const a = e.work;
  if (a?.type !== ACTION_CONVERT || a.state !== WORKING) return;
  const target = object(ctx, a.target);
  if (!target || typeOf(ctx, target).group === GROUP_PRIEST) return;
  convertTarget(ctx, e, a, target);
}

/** `TRIBE_Action_Heal::first_in_stack` (src/tact_hea.cpp:46-57): a boat target sets no state, the priest stands holding the order. */
function healFirstInStack(ctx: GameContext, e: Entity, a: WorkAction): void {
  const target = object(ctx, a.target);
  if (target && BOAT_GROUPS.includes(typeOf(ctx, target).group)) return;
  healState(ctx, e, a, target ? TO_TARGET : WAITING);
}

/** `TRIBE_Action_Heal::set_state` (src/tact_hea.cpp:59-115). */
function healState(ctx: GameContext, e: Entity, a: WorkAction, state: number): void {
  if (e.mover) endAction(e.mover);
  a.state = state;
  const task = taskOf(ctx, e, a);
  switch (state) {
    case WAITING:
      notifyObject(ctx, e, e.id, NOTIFY_REQUEST_TASK, AI_ACTION_HEAL);
      newSprite(ctx, e, null);
      return;
    case IDLE:
      newSprite(ctx, e, null);
      return;
    case TO_POINT:
      startMoveTo(e, null, a.x, a.y, a.z, 0, task.moving, true, ctx);
      return;
    case TO_TARGET: {
      const target = object(ctx, a.target);
      if (target) latch(a, target);
      startMoveTo(e, target ?? null, a.x, a.y, a.z, HEAL_RANGE, task.moving, true, ctx);
      return;
    }
    case TURNING: {
      const target = object(ctx, a.target);
      if (target) latch(a, target);
      newSprite(ctx, e, task.moving);
      return;
    }
    case WORKING:
      newSprite(ctx, e, task.proceeding);
      return;
  }
}

/** `TRIBE_Action_Heal::update` (src/tact_hea.cpp:117-232, support-actions.md §5). */
export function updateHeal(ctx: GameContext, e: Entity, a: WorkAction): ActionResult {
  if (a.target !== -1 && !object(ctx, a.target)) {
    a.target = -1;
    healState(ctx, e, a, WAITING);
    return ActionResult.Continue;
  }
  if (a.target2 !== -1 && !object(ctx, a.target2)) a.target2 = -1;
  const target = object(ctx, a.target);
  if (target && target.state !== ObjectState.Active) {
    a.target = -1;
    healState(ctx, e, a, WAITING);
    return ActionResult.Continue;
  }
  if (target && !isAlly(ctx, e.owner, target.owner)) {
    healState(ctx, e, a, DONE);
    notifyObject(ctx, e, e.id, NOTIFY_TARGET_INVALID, AI_ACTION_HEAL);
    return ActionResult.TargetInvalid;
  }
  switch (a.state) {
    case TO_POINT:
      switch (updateMover(ctx, e)) {
        case ActionResult.Remove:
        case ActionResult.Completed:
        case ActionResult.TargetLost:
          healState(ctx, e, a, WAITING);
          break;
        case ActionResult.Failed:
          healState(ctx, e, a, FAILED);
          break;
        case ActionResult.TargetInvalid:
          a.target = -1;
          healState(ctx, e, a, TO_POINT);
          break;
      }
      return ActionResult.Continue;
    case TO_TARGET:
      switch (updateMover(ctx, e)) {
        case ActionResult.TargetInvalid:
        case ActionResult.TargetLost:
          a.target = -1;
          healState(ctx, e, a, TO_POINT);
          break;
        case ActionResult.Failed:
          healState(ctx, e, a, FAILED);
          break;
        case ActionResult.Remove:
        case ActionResult.Completed:
          healState(ctx, e, a, TURNING);
          break;
      }
      return ActionResult.Continue;
    case TURNING:
      if (!target) healState(ctx, e, a, WAITING);
      else if (turnTowards(ctx, e, target.x, target.y)) healState(ctx, e, a, WORKING);
      return ActionResult.Continue;
    case WORKING: {
      if (!target) {
        healState(ctx, e, a, WAITING);
        return ActionResult.Continue;
      }
      const task = taskOf(ctx, e, a);
      if (target.x !== a.x || target.y !== a.y) {
        // The target moved: no healing this step; out of reach the priest waits for a task.
        const distance = distanceToObject(ctx, e, target);
        if (task.workRange < distance && HEAL_DISTANCE_THRESHOLD < distance) healState(ctx, e, a, WAITING);
        else latch(a, target);
        return ActionResult.Continue;
      }
      let work = mul32(task.workValue1, typeOf(ctx, e).action!.workRate);
      work = mul32(work, ctx.deltaSeconds);
      const rate = ctx.attributes[e.owner]![ATTR_HEAL_RATE] ?? 0;
      if (rate > HEAL_ATTRIBUTE_THRESHOLD) work = mul32(work, rate);
      const result = heal(ctx, target, work);
      if (result === HEAL_FULL) healState(ctx, e, a, WAITING);
      else if (result === HEAL_UNPAID) {
        notifyObject(ctx, e, e.id, NOTIFY_TARGET_INVALID, AI_ACTION_HEAL);
        healState(ctx, e, a, IDLE);
      }
      return ActionResult.Continue;
    }
    case DONE:
      return ActionResult.Remove;
    case FAILED:
      notifyObject(ctx, e, e.id, NOTIFY_ACTION_FAILED, AI_ACTION_HEAL);
      healState(ctx, e, a, IDLE);
      return ActionResult.Failed;
  }
  return ActionResult.Continue;
}

/**
 * `TRIBE_Combat_Object::convert` / `heal` (src/t_c_obj.cpp:525-577), the unit AI's orders: an action of that type already
 * on the target is kept (unless unconditional); an action of that type takes the new target; otherwise an action of that
 * type runs whatever task `getTask` picks for the target, replacing every action. False when there is none.
 */
export function aiPriestAction(ctx: GameContext, e: Entity, type: number, target: Entity, unconditional: boolean): boolean {
  const w = e.work;
  if (!unconditional && w?.type === type && w.target === target.id) return true;
  if (w?.type === type) {
    priestWork(ctx, e, w, target);
    return true;
  }
  const task = getTask(ctx, e, target);
  if (task === -1) return false;
  startPriestAction(ctx, e, type, task, target, target.x, target.y);
  return true;
}
