/**
 * Transport boats (docs/spec/naval.md §7): the Enter action (3, `RGE_Action_Enter`, src/act_entr.cpp) a land unit boards
 * a transport with, `enter_obj`/`exit_obj` (src/stat_obj.cpp:2068-2103), the transport's default Transport action (12,
 * `RGE_Action_Transport`, src/act_tran.cpp), where the cargo lands (`drop_held_objects`/`find_drop_location`,
 * src/stat_obj.cpp:2417-2534) and `RGE_Combat_Object::unload` (src/com_obj.cpp:821). Both actions use the work action's
 * record (`WorkAction`); `gather.ts` routes orders and updates of types 3 and 12 here.
 */
import { checkPlacement } from './buildings';
import { distanceToObject } from './combat';
import type { GameContext } from './context';
import { isAlly, type DiplomacyContext } from './diplomacy';
import { ObjectState, type Entity } from './entities';
import { deleteActions, type WorkAction } from './gather';
import { typeOf, type PlayerMasters } from './masters';
import { ActionResult, endAction, firstTileAlongLine, lookupZone, startMoveTo, teleport, updateMover } from './movement';
import { add32, f32, mul32, sqrt32, sub32, toInt } from './num';
import { newSprite } from './sprites';
import { forgetSighting, unexploreObject } from './visibility';
import { NOTIFY_ACTION_COMPLETED, NOTIFY_ACTION_FAILED, NOTIFY_TARGET_INVALID, notifyObject, objectMoveTo, playerNotify } from './unit-ai';
import type { Task, UnitType } from './units';

export const ACTION_ENTER = 3;
export const ACTION_TRANSPORT = 12;
/** `unit_level` 7: a transport, which units board (src/ttsk_lst.cpp:71). */
export const UNIT_LEVEL_TRANSPORT = 7;
/** `UNIT_AI_ACTION_TRANSPORT`, `UNIT_AI_ACTION_ENTER`, `UNIT_AI_ACTION_UNLOAD` (include/stat_obj.h). */
export const AI_ACTION_TRANSPORT = 0x266;
export const AI_ACTION_ENTER = 0x269;
export const AI_ACTION_UNLOAD = 0x26d;
/** The owner's "not close enough" and "not enough room" notifications from a drop (src/act_tran.cpp:96-121). */
const NOTIFY_NOT_CLOSE = 0x207;
const NOTIFY_NO_ROOM = 0x206;

const TERRAIN_WATER = 1;
const TERRAIN_BEACH = 2;
const TERRAIN_SHALLOWS = 4;
const TERRAIN_DEEP_WATER = 22;

/** Enter states (src/act_entr.cpp). */
const ENTER_DONE = 1;
const ENTER_WAITING = 2;
const ENTER_TO_TARGET = 4;
const ENTER_FAILED = 13;
/** Transport states (src/act_tran.cpp). */
const TRANSPORT_DONE = 1;
const TRANSPORT_IDLE = 2;
const TRANSPORT_TO_DROP = 4;
const TRANSPORT_DROP = 6;
const TRANSPORT_TO_POINT = 11;
const TRANSPORT_FAILED = 13;

/** The re-aim wait of state 2 (src/act_entr.cpp:97). */
const ENTER_WAIT = f32(1);
/** The transport's move range (src/act_tran.cpp:44). */
const TRANSPORT_MOVE_RANGE = f32(0.3);
/** `g_transport_lower_coordinate_adjustment` 1, `g_transport_upper_coordinate_adjustment` -1 (src/game_globals.cpp:193-194). */
const DROP_BOX_MARGIN = f32(1);
/** `withinRangeOfZone(zone, 2.0)` and the drop distance of `work` (src/act_tran.cpp:96, :171). */
const DROP_RANGE = f32(2);
/** `1.0f / 32767.0f` of `find_drop_location`. */
const RANDOM_SCALE = f32(1 / 32767);

function object(ctx: GameContext, id: number): Entity | undefined {
  return id === -1 ? undefined : ctx.entities.get(id);
}

function taskOf(ctx: GameContext, e: Entity, a: WorkAction): Task | null {
  return a.task === -1 ? null : (typeOf(ctx, e).action?.tasks[a.task] ?? null);
}

/** A transport: `unit_level` 7. */
export function isTransport(t: UnitType): boolean {
  return t.unitLevel === UNIT_LEVEL_TRANSPORT;
}

/** The state of the object's top action (`actionState()`), 0 with none; and that action's point and `target2ID`. */
function topAction(e: Entity): { state: number; x: number; y: number; target2: number } {
  const a = e.work ?? e.attack ?? e.mover?.action ?? null;
  if (!a) return { state: 0, x: 0, y: 0, target2: -1 };
  return { state: a.state, x: a.x, y: a.y, target2: e.work ? e.work.target2 : -1 };
}

/** `more_room`: fewer passengers than `obj_max`. */
function moreRoom(ctx: GameContext, boat: Entity): boolean {
  return (boat.cargo?.length ?? 0) < typeOf(ctx, boat).objMax;
}

/**
 * The enter pass of `TRIBE_Task_List::get_target_task` (src/ttsk_lst.cpp:71-79): a target of the unit's owner or of a
 * mutual ally, below Dying, whose `unit_level` is 7, takes the unit's first Enter task, or none (-1); either way the
 * search ends. Null when the pass does not apply.
 */
export function enterTaskFor(ctx: PlayerMasters & DiplomacyContext, t: UnitType, e: Entity, target: Entity): number | null {
  const mutual = target.owner === e.owner || (isAlly(ctx, e.owner, target.owner) && isAlly(ctx, target.owner, e.owner));
  if (!mutual || target.state >= ObjectState.Dying || !isTransport(typeOf(ctx, target))) return null;
  return (t.action?.tasks ?? []).findIndex((k) => k.actionType === ACTION_ENTER);
}

// ---- Enter (action 3) ----

/**
 * Aim at the first beach tile the unit may stand on along the line from its tile to the boat's and call the boat to
 * that tile's corner; without one, aim at the boat and call it to the unit (src/act_entr.cpp:55-66, :160-174).
 */
function aimAlongLine(ctx: GameContext, e: Entity, a: WorkAction, boat: Entity, range: number): void {
  const tile = firstTileAlongLine(ctx, e, toInt(e.x), toInt(e.y), toInt(boat.x), toInt(boat.y), TERRAIN_BEACH, TERRAIN_BEACH);
  if (tile) {
    a.x = f32(tile[0] + 0.5);
    a.y = f32(tile[1] + 0.5);
    objectMoveTo(ctx, boat, tile[0], tile[1], boat.z, range, true);
  } else {
    a.x = boat.x;
    a.y = boat.y;
    objectMoveTo(ctx, boat, e.x, e.y, boat.z, f32(0.5), true);
  }
}

/** A new Enter action on `boat` (`RGE_Action_Enter(obj, task, target)` then `first_in_stack`), the only action. */
export function startEnter(ctx: GameContext, e: Entity, task: number, boat: Entity): void {
  deleteActions(ctx, e);
  const a: WorkAction = { type: ACTION_ENTER, task, state: 0, timer: 0, target: boat.id, target2: -1, x: boat.x, y: boat.y, z: boat.z };
  e.work = a;
  const top = topAction(boat);
  // A human player's unit lines up with an idle boat that has room, or with one moving on a move order (`target2ID` 0).
  if ((top.state === TRANSPORT_IDLE && moreRoom(ctx, boat)) || (top.state === TRANSPORT_TO_POINT && top.target2 === 0)) {
    aimAlongLine(ctx, e, a, boat, f32(0.5));
  } else if (top.state === TRANSPORT_TO_POINT) {
    a.x = top.x;
    a.y = top.y;
  }
  enterState(ctx, e, a, ENTER_TO_TARGET);
}

/** `set_state` (src/act_entr.cpp:87-119): the walk is deleted first. */
function enterState(ctx: GameContext, e: Entity, a: WorkAction, state: number): void {
  if (e.mover) endAction(e.mover);
  a.state = state;
  switch (state) {
    case ENTER_TO_TARGET: {
      const task = taskOf(ctx, e, a)!;
      if (!startMoveTo(e, null, a.x, a.y, a.z, task.workRange, task.moving, true, ctx)) enterState(ctx, e, a, ENTER_FAILED);
      return;
    }
    case ENTER_WAITING:
      a.timer = ENTER_WAIT;
      newSprite(ctx, e, null);
      return;
    case ENTER_DONE:
    case ENTER_FAILED:
      newSprite(ctx, e, null);
      return;
  }
}

function outOfReach(ctx: GameContext, e: Entity, a: WorkAction, boat: Entity): boolean {
  return sub32(distanceToObject(ctx, e, boat), 1) > f32(taskOf(ctx, e, a)!.workRange);
}

/** Boarded (whether or not there was room): the unit AI hears the action completed. */
function entered(ctx: GameContext, e: Entity, a: WorkAction, boat: Entity): ActionResult {
  enterObj(ctx, e, boat);
  notifyObject(ctx, e, e.id, NOTIFY_ACTION_COMPLETED, AI_ACTION_ENTER);
  enterState(ctx, e, a, ENTER_DONE);
  return ActionResult.Completed;
}

/** `RGE_Action_Enter::update` (src/act_entr.cpp:121-245). */
export function updateEnter(ctx: GameContext, e: Entity, a: WorkAction): ActionResult {
  const boat = object(ctx, a.target);
  if ((a.target !== -1 && !boat) || (boat && (boat.state >= ObjectState.Dying || !isAlly(ctx, e.owner, boat.owner)))) {
    enterState(ctx, e, a, ENTER_DONE);
    a.target = -1;
    notifyObject(ctx, e, e.id, NOTIFY_TARGET_INVALID, AI_ACTION_ENTER);
    return ActionResult.TargetInvalid;
  }
  switch (a.state) {
    case ENTER_TO_TARGET:
      if (boat) {
        switch (updateMover(ctx, e)) {
          case ActionResult.Remove:
          case ActionResult.Completed:
            if (outOfReach(ctx, e, a, boat)) {
              enterState(ctx, e, a, ENTER_WAITING);
              return ActionResult.Continue;
            }
            return entered(ctx, e, a, boat);
          case ActionResult.Failed:
            enterState(ctx, e, a, ENTER_WAITING);
            return ActionResult.Continue;
          case ActionResult.TargetInvalid:
          case ActionResult.TargetLost:
            break;
          default:
            return ActionResult.Continue;
        }
      }
      a.target = -1;
      enterState(ctx, e, a, ENTER_FAILED);
      return ActionResult.Continue;
    case ENTER_WAITING: {
      a.timer = sub32(a.timer, ctx.deltaSeconds);
      if (a.timer > 0) return ActionResult.Continue;
      // The original reads the target unchecked here; a targetless Enter cannot be made.
      if (!boat) {
        enterState(ctx, e, a, ENTER_FAILED);
        return ActionResult.Continue;
      }
      if (!outOfReach(ctx, e, a, boat)) return entered(ctx, e, a, boat);
      const top = topAction(boat);
      if (top.state === TRANSPORT_IDLE) {
        const tile = firstTileAlongLine(ctx, e, toInt(e.x), toInt(e.y), toInt(boat.x), toInt(boat.y), TERRAIN_BEACH, TERRAIN_BEACH);
        if (tile) {
          const x = f32(tile[0] + 0.5);
          const y = f32(tile[1] + 0.5);
          if (a.x === x && a.y === y) {
            // Already aimed there: walk to the boat itself, without calling it again.
            a.x = boat.x;
            a.y = boat.y;
            enterState(ctx, e, a, ENTER_TO_TARGET);
            return ActionResult.Continue;
          }
          a.x = x;
          a.y = y;
          objectMoveTo(ctx, boat, tile[0], tile[1], boat.z, 0, true);
        } else {
          a.x = boat.x;
          a.y = boat.y;
          objectMoveTo(ctx, boat, e.x, e.y, boat.z, f32(0.5), true);
        }
      } else if (top.state === TRANSPORT_TO_POINT) {
        a.x = top.x;
        a.y = top.y;
      }
      enterState(ctx, e, a, ENTER_TO_TARGET);
      return ActionResult.Continue;
    }
    case ENTER_DONE:
      return ActionResult.Remove;
    case ENTER_FAILED:
      notifyObject(ctx, e, e.id, NOTIFY_ACTION_FAILED, AI_ACTION_ENTER);
      return ActionResult.Failed;
  }
  return ActionResult.Continue;
}

// ---- Inside ----

/**
 * `enter_obj` (src/stat_obj.cpp:2074, src/com_obj.cpp:413): with room, the unit leaves its tile (its sight unexplored),
 * its visible-unit records and the obstruction map, goes to the head of the boat's list and takes the boat's position.
 */
export function enterObj(ctx: GameContext, e: Entity, boat: Entity): void {
  if (!moreRoom(ctx, boat)) return;
  if (e.inside != null) exitObj(ctx, e);
  const t = typeOf(ctx, e);
  unexploreObject(ctx, e, t, false);
  if (t.masterType >= 50) forgetSighting(ctx, e, t);
  ctx.pathing.unstamp(e, t);
  boat.cargo = [e.id, ...(boat.cargo ?? [])];
  e.inside = boat.id;
  e.x = boat.x;
  e.y = boat.y;
}

/** `exit_obj` (src/stat_obj.cpp:2097): off the boat's list. */
export function exitObj(ctx: GameContext, e: Entity): void {
  if (e.inside == null) return;
  const boat = ctx.entities.get(e.inside);
  if (boat?.cargo) boat.cargo = boat.cargo.filter((id) => id !== e.id);
  e.inside = null;
}

/** A removed boat's destructor exits every passenger (src/stat_obj.cpp:205-213). */
export function exitAll(ctx: GameContext, boat: Entity): void {
  for (const id of boat.cargo ?? []) {
    const o = ctx.entities.get(id);
    if (o) o.inside = null;
  }
  boat.cargo = [];
}

// ---- Transport (action 12) ----

/** The first default task of action 12 (`isDefault`), -1 when the type has none. */
export function defaultTransportTask(t: UnitType): number {
  return (t.action?.tasks ?? []).findIndex((k) => k.isDefault !== 0 && k.actionType === ACTION_TRANSPORT);
}

/** A new Transport action (`RGE_Action_Transport(obj, task, x, y, z)` then `first_in_stack(1)`), the only action. */
export function startTransport(ctx: GameContext, e: Entity, task: number, x: number, y: number): WorkAction {
  deleteActions(ctx, e);
  const a: WorkAction = { type: ACTION_TRANSPORT, task, state: 0, timer: 0, target: -1, target2: -1, x: f32(x), y: f32(y), z: 0 };
  e.work = a;
  transportState(ctx, e, a, a.x >= 0 && a.y >= 0 ? TRANSPORT_TO_POINT : TRANSPORT_IDLE);
  return a;
}

/** `set_state` (src/act_tran.cpp:37-72): the move is deleted first. */
function transportState(ctx: GameContext, e: Entity, a: WorkAction, state: number): void {
  if (e.mover) endAction(e.mover);
  a.state = state;
  if (state === TRANSPORT_TO_DROP || state === TRANSPORT_TO_POINT) {
    const sprite = taskOf(ctx, e, a)?.moving ?? null;
    if (!startMoveTo(e, null, a.x, a.y, a.z, TRANSPORT_MOVE_RANGE, sprite, true, ctx)) transportState(ctx, e, a, TRANSPORT_IDLE);
  } else if (state === TRANSPORT_IDLE) newSprite(ctx, e, null);
}

/** `move_to` (src/act_tran.cpp:155): a move order, `target2ID` 0. */
export function transportMoveTo(ctx: GameContext, e: Entity, a: WorkAction, x: number, y: number): void {
  a.x = f32(x);
  a.y = f32(y);
  a.z = 0;
  a.target2 = 0;
  transportState(ctx, e, a, TRANSPORT_TO_POINT);
}

/** `stop` (src/act_tran.cpp:150). */
export function transportStop(ctx: GameContext, e: Entity, a: WorkAction): void {
  transportState(ctx, e, a, TRANSPORT_IDLE);
}

/** `withinRangeOfZone(zone, range)` (src/stat_obj.cpp:3056): some tile of `zone` within `range` of the boat's tile. */
function withinRangeOfZone(ctx: GameContext, e: Entity, zone: number, range: number): boolean {
  return ctx.pathing.zones.of(typeOf(ctx, e)).zoneWithinRange(zone, toInt(e.x), toInt(e.y), range);
}

/**
 * `work(obj, x, y)` (src/act_tran.cpp:164-191): a point whose zone is within 2 tiles of the boat and at most 2 away is
 * dropped onto now; otherwise the boat moves there, then drops when `obj` is the boat itself (an unload).
 */
export function transportWork(ctx: GameContext, e: Entity, a: WorkAction, obj: Entity | undefined, x: number, y: number): void {
  a.target2 = 1;
  const zone = lookupZone(ctx, e, toInt(x), toInt(y));
  const dx = sub32(x, e.x);
  const dy = sub32(y, e.y);
  const distance = sqrt32(add32(mul32(dx, dx), mul32(dy, dy)));
  if (withinRangeOfZone(ctx, e, zone, DROP_RANGE) && distance <= DROP_RANGE) {
    a.x = f32(x);
    a.y = f32(y);
    a.z = 0;
    transportState(ctx, e, a, TRANSPORT_DROP);
    return;
  }
  if (x >= 0 && y >= 0) {
    a.x = f32(x);
    a.y = f32(y);
    a.z = 0;
    transportState(ctx, e, a, obj !== e ? TRANSPORT_TO_POINT : TRANSPORT_TO_DROP);
  }
}

/** `targetZone` (src/act_tran.cpp:236): the target point's zone, -1 without one. */
function targetZone(ctx: GameContext, e: Entity, a: WorkAction): number {
  return a.x !== -1 ? lookupZone(ctx, e, toInt(a.x), toInt(a.y)) & 0xff : -1;
}

/**
 * `next_to_drop_off_terrain` (src/act_tran.cpp:193-234): a task of terrain -1 drops anywhere; otherwise the tile box one
 * tile around the boat's radius must hold beach or shallows in the target point's zone.
 */
function nextToDropOffTerrain(ctx: GameContext, e: Entity, a: WorkAction): boolean {
  const task = taskOf(ctx, e, a);
  if (task && task.terrainId === -1) return true;
  const t = typeOf(ctx, e);
  const { width, height } = ctx.map;
  const x1 = Math.max(toInt(sub32(sub32(e.x, t.radiusX), DROP_BOX_MARGIN)), 0);
  const y1 = Math.max(toInt(sub32(sub32(e.y, t.radiusY), DROP_BOX_MARGIN)), 0);
  const x2 = Math.min(toInt(add32(add32(t.radiusX, e.x), DROP_BOX_MARGIN)), width - 1);
  const y2 = Math.min(toInt(add32(add32(t.radiusY, e.y), DROP_BOX_MARGIN)), height - 1);
  const zone = targetZone(ctx, e, a);
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (zone !== -1 && lookupZone(ctx, e, x, y) !== zone) continue;
      const terrain = ctx.map.terrainAt(x, y);
      if (terrain === TERRAIN_BEACH || terrain === TERRAIN_SHALLOWS) return true;
    }
  }
  return false;
}

/** `RGE_Action_Transport::update` (src/act_tran.cpp:74-148). */
export function updateTransport(ctx: GameContext, e: Entity, a: WorkAction): ActionResult {
  switch (a.state) {
    case TRANSPORT_TO_POINT:
      if (updateMover(ctx, e) !== ActionResult.Continue) transportState(ctx, e, a, TRANSPORT_IDLE);
      return ActionResult.Continue;
    case TRANSPORT_TO_DROP:
      if (updateMover(ctx, e) !== ActionResult.Continue) transportState(ctx, e, a, TRANSPORT_DROP);
      return ActionResult.Continue;
    case TRANSPORT_DROP:
      drop(ctx, e, a);
      transportState(ctx, e, a, TRANSPORT_IDLE);
      return ActionResult.Continue;
    case TRANSPORT_DONE:
      return ActionResult.Remove;
    case TRANSPORT_FAILED:
      notifyObject(ctx, e, e.id, NOTIFY_ACTION_FAILED, AI_ACTION_TRANSPORT);
      transportState(ctx, e, a, TRANSPORT_IDLE);
      return ActionResult.Failed;
  }
  return ActionResult.Continue;
}

/** State 6 (src/act_tran.cpp:94-123): drop the passengers when the boat is close enough, telling the owner otherwise. */
function drop(ctx: GameContext, e: Entity, a: WorkAction): void {
  const zone = targetZone(ctx, e, a);
  if (zone !== -1 && !withinRangeOfZone(ctx, e, zone, DROP_RANGE)) {
    playerNotify(ctx, e.owner, NOTIFY_NOT_CLOSE, AI_ACTION_TRANSPORT);
    return;
  }
  if ((e.cargo?.length ?? 0) === 0) return;
  if (nextToDropOffTerrain(ctx, e, a)) {
    if (dropHeldObjects(ctx, e, targetZone(ctx, e, a)) === 0) playerNotify(ctx, e.owner, NOTIFY_NOT_CLOSE, AI_ACTION_TRANSPORT);
    else if ((e.cargo?.length ?? 0) > 0) playerNotify(ctx, e.owner, NOTIFY_NO_ROOM, AI_ACTION_TRANSPORT);
    return;
  }
  if (a.x !== -1) {
    const terrain = ctx.map.terrainAt(toInt(a.x), toInt(a.y));
    if (terrain === TERRAIN_WATER || terrain === TERRAIN_DEEP_WATER) return;
  }
  playerNotify(ctx, e.owner, NOTIFY_NOT_CLOSE, AI_ACTION_TRANSPORT);
}

/**
 * `drop_held_objects(zone)` (src/stat_obj.cpp:2417-2471): passengers from the head of the list each try a spot around
 * drop point 0 (first the boat, twice its radius); a dropped one appends its spot (up to 9), a failure drops the last
 * point (copied over the one before it) and tries again. With no points left the rest stay aboard. The count dropped.
 */
function dropHeldObjects(ctx: GameContext, boat: Entity, zone: number): number {
  const bt = typeOf(ctx, boat);
  const points = [{ x: boat.x, y: boat.y, rx: mul32(bt.radiusX, 2), ry: mul32(bt.radiusY, 2) }];
  // `find_drop_location` writes its spot through references to these: a try on side 4 keeps the last one. The original
  // leaves them uninitialised; -1 fails the map check.
  const spot = { x: -1, y: -1 };
  let count = 0;
  for (const id of [...(boat.cargo ?? [])]) {
    const o = ctx.entities.get(id);
    if (!o) continue;
    while (points.length > 0) {
      const p = points[0]!;
      if (findDropLocation(ctx, boat, zone, spot, o, p.x, p.y, p.rx, p.ry)) {
        const t = typeOf(ctx, o);
        o.x = boat.x;
        o.y = boat.y;
        exitObj(ctx, o);
        teleport(ctx, o, t, spot.x, spot.y, boat.z, true);
        count++;
        if (points.length < 9) points.push({ x: spot.x, y: spot.y, rx: mul32(t.radiusX, 2), ry: mul32(t.radiusY, 2) });
        break;
      }
      const last = points.pop()!;
      if (points.length > 0) points[points.length - 1] = last;
    }
  }
  return count;
}

/**
 * `find_drop_location` (src/stat_obj.cpp:2474-2534): 50 tries; each draws a side and a spot along it. The
 * spot must be on the map, in the drop zone, pass the passenger's placement check (as a unit is placed, objects that can
 * be built on ignored) and be passable for it.
 */
function findDropLocation(
  ctx: GameContext,
  boat: Entity,
  zone: number,
  spot: { x: number; y: number },
  o: Entity,
  dropX: number,
  dropY: number,
  radiusX: number,
  radiusY: number,
): boolean {
  const t = typeOf(ctx, o);
  const rng = ctx.rng;
  const rx = add32(radiusX, t.radiusX);
  const ry = add32(radiusY, t.radiusY);
  const rx2 = add32(rx, rx);
  const ry2 = add32(ry, ry);
  const along = (len: number, r: number) => sub32(mul32(mul32(rng.rand(), len), RANDOM_SCALE), r);
  // The ring counter runs from 1 while below 2: one ring (its widening for a second ring is never used).
  for (let tries = 0; tries < 50; tries++) {
    switch (Math.trunc((rng.rand() * 4) / 0x7fff)) {
      case 0:
        spot.x = add32(rx, dropX);
        spot.y = add32(dropY, along(ry2, ry));
        break;
      case 1:
        spot.x = sub32(dropX, rx);
        spot.y = add32(dropY, along(ry2, ry));
        break;
      case 2:
        spot.y = add32(ry, dropY);
        spot.x = add32(dropX, along(rx2, rx));
        break;
      case 3:
        spot.y = sub32(dropY, ry);
        spot.x = add32(dropX, along(rx2, rx));
        break;
    }
    const { x, y } = spot;
    if (!(x >= 0 && y >= 0 && x < ctx.map.width && y < ctx.map.height)) continue;
    if (zone !== -1 && zone !== lookupZone(ctx, boat, toInt(x), toInt(y))) continue;
    if (checkPlacement(ctx, t, x, y, false, true, o.owner) === 0 && ctx.pathing.passable(o, t, x, y)) return true;
  }
  return false;
}

/**
 * `RGE_Combat_Object::unload` (src/com_obj.cpp:821-840, naval.md §7.6): a top Transport action drops at the boat's own
 * position (the point ignored); otherwise a new Transport action without a task replaces every action and takes
 * `work(boat, x, y)`. A player's Unload is an immediate order, which stops the boat first: always the second path.
 */
export function unload(ctx: GameContext, e: Entity, x: number, y: number): boolean {
  if (e.work?.type === ACTION_TRANSPORT) {
    transportWork(ctx, e, e.work, e, e.x, e.y);
    return true;
  }
  const a = startTransport(ctx, e, -1, e.x, e.y);
  transportWork(ctx, e, a, e, x, y);
  return true;
}
