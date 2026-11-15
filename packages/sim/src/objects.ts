/**
 * One object's update in its owner's list (economy.md §3, combat.md §5): the `RGE_Static_Object` →
 * `RGE_Animated_Object` → `RGE_Action_Object` → `RGE_Combat_Object` chain. Dying, death animation, resource decay,
 * removal and the spawned dead object live here; actions are gather/hunt/build (`gather.ts`), an attack, a plain walk,
 * a missile, or a Farm's food production (`make.ts`); the unit AI (`unit-ai.ts`) runs last. Buildings wrap the chain with construction and their production queue (`buildings.ts`).
 */
import { emptyQueue, giveBuiltStorages, isBuilding, updateConstruction, updateQueue } from './buildings';
import { updateAttack, updateMissile } from './combat';
import type { GameContext } from './context';
import { ObjectState, type Entity } from './entities';
import { deleteActions, updateWork } from './gather';
import { defaultMakeTask, startMake, updateMake } from './make';
import { typeOf } from './masters';
import { ActionResult, endAction, updateMover } from './movement';
import { add32, f32, mul32, sub32 } from './num';
import { GROUP_PRIEST, rechargeFaith } from './priest';
import { updateResearch } from './research';
import { advanceSprite, isAnimating, newSprite } from './sprites';
import { undoTech } from './techs';
import { AI_ACTION_MOVE, NOTIFY_ACTION_COMPLETED, NOTIFY_ACTION_FAILED, NOTIFY_TARGET_INVALID, notifyObject, updateUnitAI } from './unit-ai';
import { defaultTransportTask, startTransport } from './transport';
import { defaultTradeTask, startTrade } from './trade';
import { refreshSighting, stateChanged } from './visibility';
import { defaultWonderTask, startWonder, updateWonder } from './wonder';
import { spriteInfo, type UnitType } from './units';

/** Master types (`master_type`): 20 animated, 30 moving, 40 action, 50 combat, 60 missile, 70 unit, 80 building. */
export function isAnimated(t: UnitType): boolean {
  return t.masterType >= 20 && t.masterType <= 80;
}

export function isMoving(t: UnitType): boolean {
  return t.masterType >= 30 && t.masterType <= 80;
}

function isActionObject(t: UnitType): boolean {
  return t.masterType >= 40 && t.masterType <= 80;
}

/** Storage slots given to the owner: flag 1 and 2 on creation (economy.md §6.3), flag 2 taken back on dying. */
export function giveStorages(attributes: number[], t: UnitType, sign: 1 | -1, flags: readonly number[]): void {
  for (const s of t.storages) {
    if (s.type < 0 || !flags.includes(s.flag)) continue;
    attributes[s.type] = add32(attributes[s.type] ?? 0, sign * s.amount);
  }
}

/**
 * The shadow techs that open the Tool, Bronze and Iron Age (`TECH_A01_B01_F01_I01_TOOL_AGE` 74, 75, 76), undone with the
 * last building of a kind (`src/t_b_obj.cpp:314-327`); the ages themselves stay.
 */
const AGE_TECHS = [74, 75, 76];

/**
 * `set_object_state` side effects the sim keeps: a unit starting to die returns its flag-2 storages; line of sight
 * moves as visibility.md §3.3 says. A built building
 * going from active to dying also takes back its flag-4 storages; when the owner has no other active building of its
 * kind, its tech and the age techs are undone (`TRIBE_Building_Object::set_object_state`, `src/t_b_obj.cpp:303-327`).
 */
function setObjectState(ctx: GameContext, e: Entity, state: number): void {
  if (e.state === state) return;
  const t = typeOf(ctx, e);
  const lost = isBuilding(t) && state === ObjectState.Dying && e.state === ObjectState.Active;
  if (lost) giveBuiltStorages(ctx, e, t, -1);
  if (state >= ObjectState.Dying && e.state < ObjectState.Dying) giveStorages(ctx.attributes[e.owner]!, t, -1, [2]);
  // A passenger's sight was taken away when it boarded (naval.md §7.3).
  if (e.inside == null) stateChanged(ctx, e, t, state);
  e.state = state;
  if (lost && !ctx.objectsOf(e.owner).some((o) => o.type === e.type && o.state === ObjectState.Active)) {
    if (t.building!.techId > -1) undoTech(ctx, e.owner, t.building!.techId);
    for (const id of AGE_TECHS) undoTech(ctx, e.owner, id);
  }
}

/**
 * Update `e` for one step; true when it is ready to be removed (`update` returned non-zero, src/obj_list.cpp:226).
 * A building (`TRIBE_Building_Object::update`, `src/t_b_obj.cpp:334-363`) runs its construction first, then the
 * chain, then its production queue: dropped once it is no longer active, else advanced.
 */
export function updateObject(ctx: GameContext, e: Entity): boolean {
  const t = typeOf(ctx, e);
  if (!isBuilding(t)) return updateChain(ctx, e, t);
  updateConstruction(ctx, e, t);
  const remove = updateChain(ctx, e, t);
  if (e.state > ObjectState.Active) emptyQueue(e);
  else updateQueue(ctx, e);
  return remove;
}

function updateChain(ctx: GameContext, e: Entity, t: UnitType): boolean {
  // `TRIBE_Combat_Object::update`: a priest's faith recharges first (support-actions.md §4.1).
  if (t.group === GROUP_PRIEST) rechargeFaith(ctx, e);
  // `RGE_Combat_Object::update`: the reload timer runs first.
  if (e.attackTimer !== undefined && e.attackTimer > 0) {
    e.attackTimer = sub32(e.attackTimer, ctx.deltaSeconds);
    if (e.attackTimer < 0) e.attackTimer = 0;
  }
  const remove = staticUpdate(ctx, e, t);
  const inside = e.inside != null;
  if (isAnimated(t) && !inside) {
    if (e.state === ObjectState.Dying) setObjectState(ctx, e, t.dying ? ObjectState.DeathAnimation : ObjectState.Dead);
    else if (e.state === ObjectState.DeathAnimation && !(e.sprite && isAnimating(e.sprite, spriteInfo(e.sprite.graphic)))) {
      e.state = ObjectState.Dead;
      if (e.mover) e.mover.speed = 0;
    }
    if (e.sprite) advanceSprite(e.sprite, spriteInfo(e.sprite.graphic), ctx.deltaSeconds, e.mover?.speed ?? 0);
  }
  if (!isActionObject(t)) return remove;
  if (e.state > ObjectState.Active) {
    deleteActions(ctx, e);
    e.missile = null;
    if (t.masterType >= 50 && !inside) refreshSighting(ctx, e, t);
    return remove;
  }
  if (inside) {
    // A passenger's actions wait until it is dropped; its unit AI still runs (naval.md §7.3).
  } else if (e.research) {
    if (updateResearch(ctx, e, e.research) === ActionResult.Remove) e.research = null;
  } else if (e.missile) {
    if (updateMissile(ctx, e) === ActionResult.Remove) e.missile = null;
  } else if (e.work) {
    const r = updateWork(ctx, e);
    if (r === ActionResult.Failed || r === ActionResult.Remove) deleteActions(ctx, e);
  } else if (e.attack) {
    // Only `remove` drops an attack; a failed one stays in state 13 and tells the unit AI every update.
    if (updateAttack(ctx, e) === ActionResult.Remove) deleteActions(ctx, e);
  } else if (e.mover?.action) {
    // A top-level move that ends tells the unit AI, which resets the order (src/act_move.cpp:140, :205, :218, :236).
    const sub = e.mover.action.sub;
    const r = updateMover(ctx, e);
    if (!sub) notifyMoveEnd(ctx, e, r);
    if (r === ActionResult.Failed || r === ActionResult.Remove) endAction(e.mover);
  } else if (e.make) {
    updateMake(ctx, e, e.make);
  } else if (e.wonder) {
    updateWonder(ctx, e, e.wonder);
  } else if (e.state === ObjectState.Active) {
    // An active object with no action starts its default task, and does no more this step (src/act_obj.cpp:403-407).
    const task = defaultMakeTask(t);
    if (task !== -1) startMake(ctx, e, task);
    else if (defaultWonderTask(t) !== -1) startWonder(ctx, e);
    else if (defaultTransportTask(t) !== -1) startTransport(ctx, e, defaultTransportTask(t), -1, -1);
    else if (defaultTradeTask(t) !== -1) startTrade(ctx, e, defaultTradeTask(t), undefined, -1, -1);
  }
  // `RGE_Combat_Object::update` refreshes the object's visible-unit records, then ends with the unit AI, on the owner's
  // turn only, with the owner's accumulated time.
  if (t.masterType >= 50 && !inside) refreshSighting(ctx, e, t);
  if (e.ai && ctx.playerTurn === e.owner) updateUnitAI(ctx, e, ctx.playerTimeDelta[e.owner]!);
  return remove;
}

function notifyMoveEnd(ctx: GameContext, e: Entity, r: ActionResult): void {
  if (r === ActionResult.Completed) notifyObject(ctx, e, e.id, NOTIFY_ACTION_COMPLETED, AI_ACTION_MOVE);
  else if (r === ActionResult.Failed) notifyObject(ctx, e, e.id, NOTIFY_ACTION_FAILED, AI_ACTION_MOVE);
  else if (r === ActionResult.TargetInvalid) notifyObject(ctx, e, e.id, NOTIFY_TARGET_INVALID, AI_ACTION_MOVE);
}

/** `RGE_Static_Object::update` (src/stat_obj.cpp:1166). */
function staticUpdate(ctx: GameContext, e: Entity, t: UnitType): boolean {
  if (e.inside != null) {
    // A passenger copies its transport's state once that is past active: it dies with its ship (src/stat_obj.cpp:1233).
    const vessel = ctx.entities.get(e.inside);
    if (vessel && vessel.state > ObjectState.Active) setObjectState(ctx, e, vessel.state);
    return false;
  }
  switch (e.state) {
    case ObjectState.Active:
    case ObjectState.Unbuilt:
      if (e.hp < 1) {
        setObjectState(ctx, e, ObjectState.Dying);
        newSprite(ctx, e, t.dying);
        // The death sound is fenced off the stream (src/stat_obj.cpp:1796-1806).
        ctx.rng.srand(ctx.rng.rand());
      }
      return false;
    case ObjectState.Dying:
    case ObjectState.Dead:
      if (e.heldType === -1 || e.heldAmount <= 0) {
        setObjectState(ctx, e, ObjectState.PendingRemoval);
        // `spawn_death_obj` (src/stat_obj.cpp:1329): the dead object takes this one's place and owner.
        if (t.deadUnitId >= 0) ctx.create(e.owner, t.deadUnitId, e.x, e.y, e.z);
        return false;
      }
      if (t.resourceDecay > 0) {
        e.heldAmount = sub32(e.heldAmount, mul32(ctx.deltaSeconds, t.resourceDecay));
        if (e.heldAmount < 0) e.heldAmount = f32(0);
      }
      return false;
    case ObjectState.PendingRemoval:
      e.state = ObjectState.ReadyToRemove;
      return false;
    case ObjectState.ReadyToRemove:
      return true;
  }
  return false;
}
