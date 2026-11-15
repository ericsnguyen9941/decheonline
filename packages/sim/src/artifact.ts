// `TRIBE_Action_Artifact`, action 107 (src/tact_art.cpp; docs/spec/victory.md §10.2). The relic's and the ruin's task
// 0, which nothing in 1.0a starts: `get_target_task` never picks it (no unit, group, combat level or terrain) and neither
// master has a default task. Ported as the original has it, for a scenario or task list that does start it.
import type { GameContext } from './context';
import { ObjectState, type Entity } from './entities';
import { deleteActions, type WorkAction } from './gather';
import { hasMaster, typeOf } from './masters';
import { ActionResult, endAction, startMoveTo, updateMover } from './movement';
import { add32, f32, sub32 } from './num';

export const ACTION_ARTIFACT = 107;

/** States (src/tact_art.cpp:51-86): done, to a point, to an object, check the owner, wait, back to Gaia. */
export const ARTIFACT_DONE = 1;
export const ARTIFACT_TO_POINT = 4;
export const ARTIFACT_TO_TARGET = 5;
export const ARTIFACT_CHECK = 6;
export const ARTIFACT_WAIT = 10;
export const ARTIFACT_RESET_OWNER = 100;

/** The wait between two owner checks, seconds (`set_state(10)`). */
const WAIT = f32(3);
/** `g_artifact_timer_threshold`. */
const WAIT_THRESHOLD = 0;
/** `g_artifact_scan_lower_adjustment` / `g_artifact_scan_upper_adjustment` (src/game_globals.cpp:329-330). */
const SCAN_LOWER = 1;
const SCAN_UPPER = -1;
/** Object groups the scan skips: artifacts, flags (11) and 30 (src/tact_art.cpp:160-161). */
const SKIPPED_GROUPS = new Set([1, 11, 30]);

/**
 * A new artifact action (the target or the point constructor, then `first_in_stack(1)`, src/tact_art.cpp:36-49), the
 * only one: to the object, else to the point when both coordinates are set, else straight to the owner check.
 */
export function startArtifact(ctx: GameContext, e: Entity, task: number, target: Entity | undefined, x: number, y: number): void {
  deleteActions(ctx, e);
  const a: WorkAction = { type: ACTION_ARTIFACT, task, state: 0, timer: 0, target: target ? target.id : -1, target2: -1, x: f32(x), y: f32(y), z: 0 };
  e.work = a;
  if (target) setState(ctx, e, a, ARTIFACT_TO_TARGET);
  else if (a.x !== -1 && a.y !== -1) setState(ctx, e, a, ARTIFACT_TO_POINT);
  else setState(ctx, e, a, ARTIFACT_CHECK);
}

/**
 * `set_state` (src/tact_art.cpp:51-86). A walk replaces the sub-action and goes straight on to the owner check, which
 * then runs every update while the object walks. The walk to an object goes to where the object is now and forgets it.
 */
function setState(ctx: GameContext, e: Entity, a: WorkAction, state: number): void {
  a.state = state;
  switch (state) {
    case ARTIFACT_WAIT:
      a.timer = WAIT;
      return;
    case ARTIFACT_TO_TARGET: {
      const target = a.target === -1 ? undefined : ctx.entities.get(a.target);
      if (target) {
        a.x = target.x;
        a.y = target.y;
        a.z = target.z;
      }
      a.target = -1;
    }
    // falls through: the walk to the remembered point
    case ARTIFACT_TO_POINT: {
      if (e.mover) endAction(e.mover);
      const task = typeOf(ctx, e).action!.tasks[a.task]!;
      if (startMoveTo(e, null, a.x, a.y, a.z, 0, task.moving, true, ctx)) setState(ctx, e, a, ARTIFACT_CHECK);
      return;
    }
  }
}

/** `TRIBE_Action_Artifact::move_to` (src/tact_art.cpp:196-202): walk to the point. */
export function artifactMoveTo(ctx: GameContext, e: Entity, a: WorkAction, x: number, y: number): void {
  a.x = f32(x);
  a.y = f32(y);
  a.z = 0;
  setState(ctx, e, a, ARTIFACT_TO_POINT);
}

/** `TRIBE_Action_Artifact::work` (src/tact_art.cpp:204-216): walk to the object, or to the point. */
export function artifactWork(ctx: GameContext, e: Entity, a: WorkAction, target: Entity | undefined, x: number, y: number): void {
  if (target) {
    a.target = target.id;
    setState(ctx, e, a, ARTIFACT_TO_TARGET);
    return;
  }
  artifactMoveTo(ctx, e, a, x, y);
}

/** `TRIBE_Action_Artifact::reset_owner` (src/tact_art.cpp:218-220; nothing calls it): next update gives the object to Gaia. */
export function artifactResetOwner(ctx: GameContext, e: Entity, a: WorkAction): void {
  setState(ctx, e, a, ARTIFACT_RESET_OWNER);
}

/**
 * `TRIBE_Action_Artifact::update` (src/tact_art.cpp:88-124). The walk runs first and is dropped once it ends. Then the
 * owner check: another single player on the object's tiles takes it (the change of owner deletes this action, src/
 * act_obj.cpp:425-429); otherwise wait 3 s and check again, for as long as the action lasts.
 */
export function updateArtifact(ctx: GameContext, e: Entity, a: WorkAction): ActionResult {
  if (e.mover?.action) {
    const r = updateMover(ctx, e);
    if (r > ActionResult.Continue && r <= ActionResult.Failed) endAction(e.mover);
  }
  switch (a.state) {
    case ARTIFACT_WAIT: {
      const left = sub32(a.timer, ctx.deltaSeconds);
      a.timer = left;
      if (!(left > WAIT_THRESHOLD)) setState(ctx, e, a, ARTIFACT_CHECK);
      return ActionResult.Continue;
    }
    case ARTIFACT_CHECK: {
      const owner = checkOwnership(ctx, e);
      if (owner !== -1) {
        if (e.mover) endAction(e.mover);
        ctx.changeOwnership(e, owner);
        return ActionResult.Continue;
      }
      setState(ctx, e, a, ARTIFACT_WAIT);
      return ActionResult.Continue;
    }
    case ARTIFACT_RESET_OWNER:
      ctx.changeOwnership(e, 0);
      // The change of owner deleted the action; the original's still sets its state (src/tact_art.cpp:116-118).
      if (e.work === a) setState(ctx, e, a, ARTIFACT_CHECK);
      return ActionResult.Continue;
    case ARTIFACT_DONE:
      return ActionResult.Remove;
    default:
      return ActionResult.Continue;
  }
}

/**
 * `check_ownership` (src/tact_art.cpp:126-189): count the active objects, other than artifacts, flags and group 30, on
 * the tiles from (x - 1 - radius) to (x + radius + 1), each axis truncated and clamped to the map, by owner. When the
 * players 1 and up with any are exactly one, and it is not the object's owner, that player; else -1.
 */
export function checkOwnership(ctx: GameContext, e: Entity): number {
  const t = typeOf(ctx, e);
  const { width, height } = ctx.map;
  let x0 = Math.trunc(sub32(sub32(e.x, SCAN_LOWER), t.radiusX));
  let y0 = Math.trunc(sub32(sub32(e.y, SCAN_LOWER), t.radiusY));
  let x1 = Math.trunc(sub32(add32(t.radiusX, e.x), SCAN_UPPER));
  let y1 = Math.trunc(sub32(add32(t.radiusY, e.y), SCAN_UPPER));
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 >= width) x1 = width - 1;
  if (y1 >= height) y1 = height - 1;
  const players = ctx.masters.length;
  const count = new Array<number>(players).fill(0);
  for (const o of ctx.entities.all()) {
    if (o.state !== ObjectState.Active || !hasMaster(ctx, o.owner, o.type) || o.inside != null) continue;
    const col = Math.trunc(o.x);
    const row = Math.trunc(o.y);
    if (col < x0 || col > x1 || row < y0 || row > y1) continue;
    if (SKIPPED_GROUPS.has(typeOf(ctx, o).group)) continue;
    count[o.owner]!++;
  }
  let best = -1;
  let unique = 0;
  for (let p = 1; p < players; p++) {
    if (count[p]! > 0) {
      unique++;
      best = p;
    }
  }
  return unique === 1 && best > 0 && best !== e.owner ? best : -1;
}
