/**
 * Trade boats (docs/spec/support-actions.md §7): `TRIBE_Action_Trade` (action 111, src/tact_trd.cpp), a trade boat's
 * default task: it sails to another player's Dock, loads the cargo it was told to carry (food, wood or stone) against
 * that player's trade goods (attribute 9), brings it back to its own Dock and is paid gold by the distance. The trade
 * goods' regrowth (`TRIBE_Player::update`, src/tplayer.cpp:372-374), the trade-attribute command
 * (`TRIBE_Command::do_command_trade_attribute`, src/tcommand.cpp:489) and the unit AI's `trade`
 * (`TRIBE_Combat_Object::trade`, src/t_c_obj.cpp:638). The action uses the work action's record (`WorkAction`, with the
 * pick-up point); `gather.ts` routes orders and updates of type 111 here.
 */
import { turnTowards } from './combat';
import type { GameContext } from './context';
import { ObjectState, type Entity } from './entities';
import { deleteActions, findDropSite, getTask, keepsWorker, type WorkAction } from './gather';
import { typeOf } from './masters';
import { ActionResult, endAction, startMoveTo, updateMover } from './movement';
import { add32, f32, mul32, sub32, toInt } from './num';
import { newSprite } from './sprites';
import { NOTIFY_ACTION_FAILED, NOTIFY_REQUEST_TASK, NOTIFY_TARGET_INVALID, notifyObject } from './unit-ai';
import type { SpriteInfo, Task, UnitType } from './units';

export const ACTION_TRADE = 111;
/** `UNIT_AI_ACTION_TRADE`, `UNIT_AI_ORDER_TRADE` (include/stat_obj.h). */
export const AI_ACTION_TRADE = 0x267;
export const AI_ORDER_TRADE = 0x2cb;
/** `unit_level` 5: what the trade-attribute command reaches (`get_selected_objects_to_command(4, -1, -1, 5)`, src/tplayer.cpp:946). */
export const UNIT_LEVEL_TRADE = 5;

/** Resources a trade boat may carry (`RGE_RESOURCE_*`); anything else becomes wood. */
const RESOURCE_FOOD = 0;
const RESOURCE_WOOD = 1;
const RESOURCE_STONE = 2;
/** Player attributes (include/player.h). */
const ATTR_GOLD = 3;
export const ATTR_TRADE_GOODS = 9;
const ATTR_TRADE_PRODUCTION = 10;
const ATTR_GOLD_EARNED = 49;
const TRADE_GOODS_MAX = f32(100);
/** `g_trade_*` (src/game_globals.cpp:345-350, :367, support-actions.md §3). */
const DISTANCE_MODIFIER_FACTOR = f32(0.00025125628);
const DISTANCE_MODIFIER_SCALE = f32(0.7);
const MINIMUM_TRANSFER_MODIFIER = f32(0.35);
const MODIFIER_THRESHOLD = 0.35;
const MAX_TRANSFER_AMOUNT = f32(75);
/** The retry wait after a failed move (src/tact_trd.cpp:235, :268, :351). */
const RETRY_WAIT = f32(-0.5);
/** `CIVILIZATION_PALMYRAN` (include/tribegam.h:26): twice the gold. */
const CIV_PALMYRAN = 15;
/** The owner hears this when a loaded boat has no Dock to return to (src/tact_trd.cpp:166). */
const NOTIFY_NO_DOCK = 0x203;

/** Trade states (src/tact_trd.cpp). */
const DONE = 1;
const IDLE = 2;
const WAITING = 3;
const TO_TARGET = 4;
const TURNING = 6;
const LOADING = 7;
const RETURNING = 8;
const TO_POINT = 11;
const FAILED = 13;

function object(ctx: GameContext, id: number): Entity | undefined {
  return id === -1 ? undefined : ctx.entities.get(id);
}

function taskOf(ctx: GameContext, e: Entity, a: WorkAction): Task {
  return typeOf(ctx, e).action!.tasks[a.task]!;
}

/** The first default task of action 111 (`isDefault`), -1 when the type has none. */
export function defaultTradeTask(t: UnitType): number {
  return (t.action?.tasks ?? []).findIndex((k) => k.isDefault !== 0 && k.actionType === ACTION_TRADE);
}

/** A cargo other than food, wood or stone becomes wood (src/tact_trd.cpp:56-59, :307-310). */
function checkCargo(e: Entity): void {
  if (e.heldType !== RESOURCE_FOOD && e.heldType !== RESOURCE_STONE && e.heldType !== RESOURCE_WOOD) e.heldType = RESOURCE_WOOD;
}

/** Holding at least 1 of the task's type, with a carry sprite. */
function carrying(e: Entity, task: Task): boolean {
  return task.resourceIn !== -1 && e.heldType === task.resourceIn && toInt(e.heldAmount) > 0 && task.carrying !== null;
}

/** `get_move_sprite`: the carry sprite while carrying the task's type, else the task's move sprite. */
function moveSprite(ctx: GameContext, e: Entity, a: WorkAction): SpriteInfo | null {
  const task = taskOf(ctx, e, a);
  return carrying(e, task) ? task.carrying : task.moving;
}

/** `get_wait_sprite`: the carry sprite while carrying the task's type, else the master's. */
function waitSprite(ctx: GameContext, e: Entity, a: WorkAction): SpriteInfo | null {
  const task = taskOf(ctx, e, a);
  return carrying(e, task) ? task.carrying : null;
}

function latch(a: WorkAction, target: Entity): void {
  a.x = target.x;
  a.y = target.y;
  a.z = target.z;
}

/**
 * A new Trade action (`TRIBE_Action_Trade(obj, task, target)` or `(obj, task, x, y, z)`, then `first_in_stack(1)`), the
 * only action. No pick-up point yet.
 */
export function startTrade(ctx: GameContext, e: Entity, task: number, target: Entity | undefined, x: number, y: number): WorkAction {
  deleteActions(ctx, e);
  const a: WorkAction = { type: ACTION_TRADE, task, state: 0, timer: 0, target: -1, target2: -1, x: f32(x), y: f32(y), z: 0, pickUpX: f32(-1), pickUpY: f32(-1) };
  if (target) {
    a.target = target.id;
    latch(a, target);
  }
  e.work = a;
  checkCargo(e);
  tradeState(ctx, e, a, target ? TO_TARGET : IDLE);
  return a;
}

/** `set_state` (src/tact_trd.cpp:71-182): the sub-action (the move) is always deleted first. */
function tradeState(ctx: GameContext, e: Entity, a: WorkAction, state: number): void {
  if (e.mover) endAction(e.mover);
  a.state = state;
  switch (state) {
    case WAITING:
      notifyObject(ctx, e, e.id, NOTIFY_REQUEST_TASK, AI_ACTION_TRADE);
      newSprite(ctx, e, waitSprite(ctx, e, a));
      return;
    case IDLE:
      newSprite(ctx, e, waitSprite(ctx, e, a));
      a.target = -1;
      a.target2 = -1;
      a.x = a.y = a.z = f32(-1);
      return;
    case TO_POINT:
      startMoveTo(e, null, a.x, a.y, a.z, 0, moveSprite(ctx, e, a), true, ctx);
      return;
    case TO_TARGET: {
      const target = object(ctx, a.target);
      if (!target) return tradeState(ctx, e, a, FAILED);
      latch(a, target);
      startMoveTo(e, target, a.x, a.y, a.z, taskOf(ctx, e, a).workRange, moveSprite(ctx, e, a), true, ctx);
      return;
    }
    case TURNING:
      newSprite(ctx, e, moveSprite(ctx, e, a));
      return;
    case LOADING: {
      newSprite(ctx, e, taskOf(ctx, e, a).proceeding);
      const target = object(ctx, a.target);
      a.pickUpX = target ? target.x : f32(-1);
      a.pickUpY = target ? target.y : f32(-1);
      return;
    }
    case RETURNING:
      returnState(ctx, e, a);
      return;
  }
}

/**
 * State 8's entry (src/tact_trd.cpp:140-176): with cargo, a home Dock that is gone or not the drop site becomes the
 * nearest own active one, and the boat sails to it (range 0); without one the owner hears 0x203 and the action fails.
 * Without cargo, a target that holds nothing and does not keep workers is dropped (never a Dock).
 */
function returnState(ctx: GameContext, e: Entity, a: WorkAction): void {
  if (e.heldAmount > 0) {
    const site = typeOf(ctx, e).action!.dropSites[0];
    const home = object(ctx, a.target2);
    if (!home || home.type !== site) a.target2 = site !== -1 ? (findDropSite(ctx, e)?.id ?? -1) : -1;
    const dock = object(ctx, a.target2);
    if (dock) {
      startMoveTo(e, dock, dock.x, dock.y, dock.z, 0, moveSprite(ctx, e, a), true, ctx);
      return;
    }
    notifyObject(ctx, e, e.id, NOTIFY_NO_DOCK, AI_ACTION_TRADE);
    tradeState(ctx, e, a, FAILED);
    return;
  }
  const target = object(ctx, a.target);
  if (target && target.heldAmount <= 0 && !keepsWorker(target)) {
    a.target = -1;
    tradeState(ctx, e, a, WAITING);
  }
}

/**
 * `work(obj, x, y)` (src/tact_trd.cpp:470-498): the same target while going to, facing or loading at it is kept; an own
 * Dock becomes the home Dock (state 8); another object the trade target (state 4); a point is sailed to (state 11).
 */
export function tradeWork(ctx: GameContext, e: Entity, a: WorkAction, target: Entity | undefined, x: number, y: number): void {
  if (target) {
    if (target.id === a.target && (a.state === TO_TARGET || a.state === TURNING || a.state === LOADING)) return;
    if (target.owner === e.owner && target.type === typeOf(ctx, e).action!.dropSites[0]) {
      a.target2 = target.id;
      tradeState(ctx, e, a, RETURNING);
      return;
    }
    a.target = target.id;
    tradeState(ctx, e, a, TO_TARGET);
    return;
  }
  a.x = f32(x);
  a.y = f32(y);
  a.z = 0;
  a.target = -1;
  tradeState(ctx, e, a, TO_POINT);
}

/** `move_to(x, y)` (src/tact_trd.cpp:447-468), a move order (no object): sail there, the trade target dropped. */
export function tradeMoveTo(ctx: GameContext, e: Entity, a: WorkAction, x: number, y: number): void {
  tradeWork(ctx, e, a, undefined, x, y);
}

/** The −0.5 s retry wait of states 4, 8 and 11: true while it runs; when it ends, `then` runs. */
function retryWait(ctx: GameContext, a: WorkAction, then: () => void): boolean {
  if (a.timer >= 0) return false;
  a.timer = add32(a.timer, ctx.deltaSeconds);
  if (a.timer > 0) {
    a.timer = 0;
    then();
  }
  return true;
}

/** `TRIBE_Action_Trade::update` (src/tact_trd.cpp:186-412, support-actions.md §7.2). */
export function updateTrade(ctx: GameContext, e: Entity, a: WorkAction): ActionResult {
  const live = (id: number) => {
    const o = object(ctx, id);
    return o && o.state < ObjectState.PendingRemoval ? id : -1;
  };
  a.target = live(a.target);
  a.target2 = live(a.target2);
  const target = object(ctx, a.target);
  // An own target ends the action; the home Dock's owner is never checked again (src/tact_trd.cpp:201-213).
  if (target && target.owner === e.owner) {
    a.target = -1;
    a.target2 = -1;
    tradeState(ctx, e, a, DONE);
    notifyObject(ctx, e, e.id, NOTIFY_TARGET_INVALID, AI_ACTION_TRADE, a.target);
    return ActionResult.TargetInvalid;
  }
  const again = () => tradeState(ctx, e, a, target ? TO_TARGET : WAITING);
  switch (a.state) {
    case DONE:
      return ActionResult.Remove;
    case TO_POINT:
      if (retryWait(ctx, a, again)) return ActionResult.Continue;
      switch (updateMover(ctx, e)) {
        case ActionResult.Failed:
        case ActionResult.TargetInvalid:
          a.timer = RETRY_WAIT;
          break;
        case ActionResult.Remove:
        case ActionResult.Completed:
        case ActionResult.TargetLost:
          tradeState(ctx, e, a, WAITING);
          break;
      }
      return ActionResult.Continue;
    case TO_TARGET:
      if (retryWait(ctx, a, again)) return ActionResult.Continue;
      switch (updateMover(ctx, e)) {
        case ActionResult.Remove:
        case ActionResult.Completed:
          tradeState(ctx, e, a, TURNING);
          break;
        case ActionResult.Failed:
        case ActionResult.TargetInvalid:
          a.timer = RETRY_WAIT;
          break;
        case ActionResult.TargetLost:
          a.target = -1;
          tradeState(ctx, e, a, WAITING);
          break;
      }
      return ActionResult.Continue;
    case TURNING:
      if (!target) {
        tradeState(ctx, e, a, WAITING);
      } else if (turnTowards(ctx, e, target.x, target.y)) {
        if (target.heldAmount > 0 || keepsWorker(target)) tradeState(ctx, e, a, LOADING);
        else {
          a.target = -1;
          tradeState(ctx, e, a, WAITING);
        }
      }
      return ActionResult.Continue;
    case LOADING:
      if (!target) tradeState(ctx, e, a, e.heldAmount > 0 ? RETURNING : WAITING);
      else load(ctx, e, a, target);
      return ActionResult.Continue;
    case RETURNING:
      if (retryWait(ctx, a, () => tradeState(ctx, e, a, RETURNING))) return ActionResult.Continue;
      switch (updateMover(ctx, e)) {
        case ActionResult.Failed:
        case ActionResult.TargetInvalid:
        case ActionResult.TargetLost:
          a.timer = RETRY_WAIT;
          break;
        case ActionResult.Remove:
        case ActionResult.Completed: {
          const dock = object(ctx, a.target2);
          if (!dock) {
            tradeState(ctx, e, a, RETURNING);
            break;
          }
          if (e.heldAmount > 0) deliver(ctx, e, a, dock);
          tradeState(ctx, e, a, target ? TO_TARGET : WAITING);
          break;
        }
      }
      return ActionResult.Continue;
    case FAILED:
      notifyObject(ctx, e, e.id, NOTIFY_ACTION_FAILED, AI_ACTION_TRADE);
      tradeState(ctx, e, a, IDLE);
      return ActionResult.Failed;
  }
  return ActionResult.Continue;
}

/**
 * State 7 (src/tact_trd.cpp:297-336): in one step the boat takes what it has room for, limited by its owner's stock of the
 * cargo and the Dock owner's trade goods; both pay it. Full, it goes home; a Dock keeps it loading as goods regrow.
 */
function load(ctx: GameContext, e: Entity, a: WorkAction, target: Entity): void {
  checkCargo(e);
  const max = f32(toInt(typeOf(ctx, e).resourceCapacity));
  let give = sub32(max, e.heldAmount);
  const own = ctx.attributes[e.owner]!;
  const theirs = ctx.attributes[target.owner]!;
  const cargo = e.heldType;
  if (own[cargo]! < give) give = own[cargo]!;
  if (theirs[ATTR_TRADE_GOODS]! < give) give = theirs[ATTR_TRADE_GOODS]!;
  own[cargo] = add32(-give, own[cargo]!);
  theirs[ATTR_TRADE_GOODS] = sub32(theirs[ATTR_TRADE_GOODS]!, give);
  e.heldAmount = add32(e.heldAmount, give);
  if (e.heldAmount >= max) tradeState(ctx, e, a, RETURNING);
  else if (theirs[ATTR_TRADE_GOODS]! <= 0 && !keepsWorker(target)) tradeState(ctx, e, a, RETURNING);
}

/**
 * The gold a cargo of `held` earns (src/tact_trd.cpp:362-384, support-actions.md §7.2): squared tiles from the pick-up
 * point to the home Dock × 0.00025125628 × 0.7 (0.35 without a pick-up point), doubled for a Palmyran owner, at least
 * 0.35; times the cargo, at most 75.
 */
export function tradeGold(held: number, pickUpX: number, pickUpY: number, dockX: number, dockY: number, palmyran: boolean): number {
  let modifier: number;
  if (pickUpX < 0 || pickUpY < 0) modifier = MINIMUM_TRANSFER_MODIFIER;
  else {
    const dx = sub32(pickUpX, dockX);
    const dy = sub32(pickUpY, dockY);
    modifier = mul32(add32(mul32(dx, dx), mul32(dy, dy)), DISTANCE_MODIFIER_FACTOR);
    modifier = mul32(modifier, DISTANCE_MODIFIER_SCALE);
  }
  if (palmyran) modifier = add32(modifier, modifier);
  if (modifier < MODIFIER_THRESHOLD) modifier = MINIMUM_TRANSFER_MODIFIER;
  const take = mul32(held, modifier);
  return take > MAX_TRANSFER_AMOUNT ? MAX_TRANSFER_AMOUNT : take;
}

/** The delivery: the owner earns the gold (attributes 3 and 49); the cargo is gone, its resource not given back. */
function deliver(ctx: GameContext, e: Entity, a: WorkAction, dock: Entity): void {
  const gold = tradeGold(e.heldAmount, a.pickUpX ?? -1, a.pickUpY ?? -1, dock.x, dock.y, ctx.civs[e.owner] === CIV_PALMYRAN);
  const attributes = ctx.attributes[e.owner]!;
  attributes[ATTR_GOLD_EARNED] = add32(gold, attributes[ATTR_GOLD_EARNED]!);
  attributes[ATTR_GOLD] = add32(gold, attributes[ATTR_GOLD]!);
  e.heldAmount = 0;
}

/**
 * `TRIBE_Combat_Object::trade(targetID, unconditional)` (src/t_c_obj.cpp:638-662), the unit AI's order: a Trade action
 * already on the target is kept (unless unconditional); a Trade action takes the new target; otherwise a Trade action
 * with whatever task `getTask` picks for the target replaces every action. False when there is none.
 */
export function aiTrade(ctx: GameContext, e: Entity, target: Entity, unconditional: boolean): boolean {
  const w = e.work;
  if (!unconditional && w?.type === ACTION_TRADE && w.target === target.id) return true;
  if (w?.type === ACTION_TRADE) {
    tradeWork(ctx, e, w, target, target.x, target.y);
    return true;
  }
  const task = getTask(ctx, e, target);
  if (task === -1) return false;
  startTrade(ctx, e, task, target, target.x, target.y);
  return true;
}

/**
 * `TRIBE_Player::update`'s once-a-second trade goods (src/tplayer.cpp:372-374, support-actions.md §7.4): attribute 9 grows
 * by the trade production (attribute 10) up to 100.
 */
export function regrowTradeGoods(attributes: number[]): void {
  attributes[ATTR_TRADE_GOODS] = add32(attributes[ATTR_TRADE_GOODS]!, attributes[ATTR_TRADE_PRODUCTION]!);
  if (attributes[ATTR_TRADE_GOODS]! > 100) attributes[ATTR_TRADE_GOODS] = TRADE_GOODS_MAX;
}

/** `do_command_trade_attribute` (src/tcommand.cpp:489-498): the cargo the boat will carry. */
export function setTradeAttribute(e: Entity, attribute: number): void {
  e.heldType = attribute;
}
