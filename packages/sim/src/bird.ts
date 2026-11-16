/**
 * `RGE_Action_Bird` (action 6, `src/act_bird.cpp`, unit-ai.md §5.5): the wander that is the default task of the Gazelle,
 * the Elephant, the Alligator and their "King" variants. Whenever such an animal is active with no action it starts it
 * (`src/act_obj.cpp:403-407`); the action walks to a random point of the map, then to another, without end, and every
 * 5 to 15 s swaps between the task's move and work sprites. Any other action (fleeing, fighting back, being hunted)
 * replaces it; once that ends the animal wanders again.
 */
import type { GameContext } from './context';
import type { Entity } from './entities';
import { typeOf } from './masters';
import { ActionResult, endAction, startMoveTo, teleport, updateMover } from './movement';
import { f32, sub32 } from './num';
import { newSprite } from './sprites';
import { spriteInfo, type Task, type UnitType } from './units';

export const ACTION_BIRD = 6;
/** `RGE_Action_Bird` states: 1 done, 3 pick a point, 4 moving (move sprite), 6 moving (work sprite). */
const BIRD_DONE = 1;
const BIRD_PICK = 3;
const BIRD_MOVE_SPRITE = 4;
const BIRD_WORK_SPRITE = 6;
/** `first_in_stack(1)` teleports the object in place at this height (`src/act_bird.cpp:35`); only flyers keep it. */
const BIRD_HEIGHT = 6;

export interface BirdAction {
  task: number;
  state: number;
  /** Seconds left before the sprite swaps (float32). */
  timer: number;
  /** The point it walks to (float32). */
  x: number;
  y: number;
  z: number;
}

/** `default_task` (src/m_ac_obj.cpp:130-140) when it is the wander: its index, else -1. */
export function defaultBirdTask(t: UnitType): number {
  const tasks = t.action?.tasks ?? [];
  const i = tasks.findIndex((k) => k.isDefault !== 0);
  return i !== -1 && tasks[i]!.actionType === ACTION_BIRD ? i : -1;
}

function taskOf(ctx: GameContext, e: Entity, a: BirdAction): Task {
  return typeOf(ctx, e).action!.tasks[a.task]!;
}

/** `set_task(default_task)`: a new Bird action with no point, then `first_in_stack(1)` (src/act_bird.cpp:31-41). */
export function startBird(ctx: GameContext, e: Entity, task: number): void {
  const a: BirdAction = { task, state: 0, timer: 0, x: f32(-1), y: f32(-1), z: f32(-1) };
  e.bird = a;
  teleport(ctx, e, typeOf(ctx, e), e.x, e.y, BIRD_HEIGHT);
  birdState(ctx, e, a, BIRD_PICK);
}

/**
 * `set_state` (src/act_bird.cpp:43-69): states 4 and 6 draw a new timer, `rand() * 10 / 0x7FFF + 5` whole seconds, and
 * show the task's move (4) or work (6) sprite, the master's when the task has none; any other state deletes the walk.
 */
function birdState(ctx: GameContext, e: Entity, a: BirdAction, state: number): void {
  a.state = state;
  if (state !== BIRD_MOVE_SPRITE && state !== BIRD_WORK_SPRITE) {
    if (e.mover) endAction(e.mover);
    return;
  }
  a.timer = f32(Math.trunc((ctx.rng.rand() * 10) / 0x7fff) + 5);
  const task = taskOf(ctx, e, a);
  newSprite(ctx, e, state === BIRD_MOVE_SPRITE ? task.moving : task.proceeding);
}

/**
 * `RGE_Action_Bird::update` (src/act_bird.cpp:73-126; the 1.0a exe's at 0x402140 is the same): the timer runs down while
 * positive. States 4 and 6 swap to each other once it is out, then update the walk; when the walk is gone (it arrived
 * and was removed) the next update picks a point. State 3 draws x then y, `rand() * map size / 0x7FFF`, and starts a
 * walk there at the object's height with the task's work range and the object's current sprite, then state 4.
 */
export function updateBird(ctx: GameContext, e: Entity, a: BirdAction): ActionResult {
  if (a.timer > 0) a.timer = sub32(a.timer, ctx.deltaSeconds);
  switch (a.state) {
    case BIRD_MOVE_SPRITE:
    case BIRD_WORK_SPRITE: {
      if (a.timer <= 0) birdState(ctx, e, a, a.state === BIRD_MOVE_SPRITE ? BIRD_WORK_SPRITE : BIRD_MOVE_SPRITE);
      // `RGE_Action_List::update`: an empty list, or a walk that reports remove (and is dropped), is remove.
      if (subUpdate(ctx, e) === ActionResult.Remove) birdState(ctx, e, a, BIRD_PICK);
      return ActionResult.Continue;
    }
    case BIRD_PICK: {
      a.x = f32(Math.trunc((ctx.rng.rand() * ctx.map.width) / 0x7fff));
      a.y = f32(Math.trunc((ctx.rng.rand() * ctx.map.height) / 0x7fff));
      a.z = e.z;
      const sprite = e.sprite ? spriteInfo(e.sprite.graphic) : null;
      if (!startMoveTo(e, null, a.x, a.y, a.z, taskOf(ctx, e, a).workRange, sprite, true, ctx)) {
        birdState(ctx, e, a, BIRD_PICK);
        return ActionResult.Continue;
      }
      birdState(ctx, e, a, BIRD_MOVE_SPRITE);
      return ActionResult.Continue;
    }
    case BIRD_DONE:
      return ActionResult.Remove;
  }
  return ActionResult.Continue;
}

function subUpdate(ctx: GameContext, e: Entity): ActionResult {
  if (!e.mover?.action) return ActionResult.Remove;
  const r = updateMover(ctx, e);
  if (r === ActionResult.Remove) endAction(e.mover);
  return r;
}
