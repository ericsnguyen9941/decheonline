/**
 * `TRIBE_Action_Build` (action 101, docs/spec/economy.md §4.2): walk to an own foundation, face it, add build points
 * each step until it completes. It shares the gather action's record (`WorkAction`); `gather.ts` routes orders and
 * updates of type 101 here. Only human players exist: the computer-player branches are not ported.
 */
import { build } from './buildings';
import { turnTowards } from './combat';
import type { GameContext } from './context';
import { ObjectState, type Entity } from './entities';
import type { WorkAction } from './gather';
import { ActionResult, endAction, startMoveTo, updateMover } from './movement';
import { f32, mul32 } from './num';
import { newSprite } from './sprites';
import { unitType, type Task } from './units';

export const ACTION_BUILD = 101;

/** Build states (`src/tact_bld.cpp`): as gather, without drop-off. */
const BUILD_DONE = 1;
const BUILD_IDLE = 2;
const BUILD_WAITING = 3;
const BUILD_TO_TARGET = 4;
const BUILD_TURNING = 6;
const BUILD_WORKING = 7;
const BUILD_TO_POINT = 11;
const BUILD_FAILED = 13;

function taskOf(e: Entity, a: WorkAction): Task {
  return unitType(e.type).action!.tasks[a.task]!;
}

function object(ctx: GameContext, id: number): Entity | undefined {
  return id === -1 ? undefined : ctx.entities.get(id);
}

/** `first_in_stack(1)`: to the target when there is one, else wait. */
export function buildFirstInStack(ctx: GameContext, e: Entity, a: WorkAction): void {
  setState(ctx, e, a, a.target !== -1 ? BUILD_TO_TARGET : BUILD_WAITING);
}

/** `set_state`: the sub-action (the walk) is always deleted first. */
function setState(ctx: GameContext, e: Entity, a: WorkAction, state: number): void {
  if (e.mover) endAction(e.mover);
  a.state = state;
  const task = taskOf(e, a);
  const t = unitType(e.type);
  switch (state) {
    case BUILD_WAITING:
    case BUILD_DONE:
    case BUILD_FAILED:
      // Waiting asks the unit AI for a task; human players' units get none yet.
      newSprite(e, t.standing, ctx.rng);
      return;
    case BUILD_IDLE:
      newSprite(e, t.standing, ctx.rng);
      a.target = -1;
      a.target2 = -1;
      a.x = a.y = a.z = f32(-1);
      return;
    case BUILD_TO_POINT:
      startMoveTo(e, null, a.x, a.y, a.z, 0, task.moving, true, ctx.rng);
      return;
    case BUILD_TO_TARGET: {
      const target = object(ctx, a.target);
      if (target) {
        a.x = target.x;
        a.y = target.y;
        a.z = target.z;
      }
      startMoveTo(e, target ?? null, a.x, a.y, a.z, task.workRange, task.moving, true, ctx.rng);
      return;
    }
    case BUILD_TURNING:
      newSprite(e, task.moving, ctx.rng);
      return;
    case BUILD_WORKING:
      // `work_sprite`.
      newSprite(e, task.proceeding, ctx.rng);
      return;
  }
}

/** `TRIBE_Action_Build::work`: an own object becomes the target (kept while already walking to or facing it). */
export function buildWork(ctx: GameContext, e: Entity, a: WorkAction, target: Entity | undefined, x: number, y: number): void {
  if (target && target.owner === e.owner) {
    if (target.id === a.target && (a.state === BUILD_TO_TARGET || a.state === BUILD_TURNING)) return;
    a.target = target.id;
    setState(ctx, e, a, BUILD_TO_TARGET);
    return;
  }
  a.x = f32(x);
  a.y = f32(y);
  a.z = 0;
  a.target = -1;
  setState(ctx, e, a, BUILD_TO_POINT);
}

/** `TRIBE_Action_Build::move_to`: walk to the point, then wait. */
export function buildMoveTo(ctx: GameContext, e: Entity, a: WorkAction, x: number, y: number): void {
  a.x = f32(x);
  a.y = f32(y);
  a.z = 0;
  a.target = -1;
  setState(ctx, e, a, BUILD_TO_POINT);
}

/** The walk's update; an empty list answers Remove. */
function updateSub(ctx: GameContext, e: Entity): ActionResult {
  const r = updateMover(ctx, e);
  if (r === ActionResult.Remove && e.mover) endAction(e.mover);
  return r;
}

/** `TRIBE_Action_Build::update` (`src/tact_bld.cpp:146-262`). */
export function updateBuild(ctx: GameContext, e: Entity, a: WorkAction): ActionResult {
  if (a.target !== -1 && !object(ctx, a.target)) {
    a.target = -1;
    if (a.state !== BUILD_IDLE) {
      setState(ctx, e, a, BUILD_WAITING);
      return ActionResult.Continue;
    }
  }
  if (a.target2 !== -1 && !object(ctx, a.target2)) a.target2 = -1;
  let target = object(ctx, a.target);
  if (target && target.state !== ObjectState.Unbuilt && a.timer === 0) {
    // A damaged target is handed to repair as an AI order in the original (`processAIOrder`); repair is not ported,
    // so it is dropped like a finished one.
    a.target = -1;
    target = undefined;
    if (a.state !== BUILD_IDLE) {
      setState(ctx, e, a, BUILD_WAITING);
      return ActionResult.Continue;
    }
  }
  switch (a.state) {
    case BUILD_TO_POINT:
      switch (updateSub(ctx, e)) {
        case ActionResult.Remove:
        case ActionResult.Completed:
        case ActionResult.TargetLost:
        case ActionResult.Failed:
          setState(ctx, e, a, BUILD_WAITING);
          break;
        case ActionResult.TargetInvalid:
          a.target = -1;
          setState(ctx, e, a, BUILD_TO_POINT);
          break;
      }
      return ActionResult.Continue;
    case BUILD_TO_TARGET:
      switch (updateSub(ctx, e)) {
        case ActionResult.TargetInvalid:
        case ActionResult.TargetLost:
          a.target = -1;
          setState(ctx, e, a, BUILD_TO_POINT);
          break;
        case ActionResult.Failed:
          setState(ctx, e, a, BUILD_WAITING);
          break;
        case ActionResult.Remove:
        case ActionResult.Completed:
          setState(ctx, e, a, BUILD_TURNING);
          break;
      }
      return ActionResult.Continue;
    case BUILD_TURNING:
      // `turn_towards(null)` is not reached: a lost target sent the action to state 3 above.
      if (target && turnTowards(ctx, e, target.x, target.y)) setState(ctx, e, a, BUILD_WORKING);
      return ActionResult.Continue;
    case BUILD_WORKING: {
      // A finished Farm keeps its builder (timer -1, then `do_command(farm)`); the sim has no Farms yet, so every
      // finished building sends the builder to wait.
      const task = taskOf(e, a);
      const work = mul32(mul32(task.workValue1, unitType(e.type).action!.workRate), ctx.deltaSeconds);
      if (!target || build(ctx, target, work)) setState(ctx, e, a, BUILD_WAITING);
      return ActionResult.Continue;
    }
    case BUILD_DONE:
      return ActionResult.Remove;
    case BUILD_FAILED:
      setState(ctx, e, a, BUILD_IDLE);
      return ActionResult.Failed;
  }
  return ActionResult.Continue;
}
