/**
 * `RGE_Action_Make` (action 21, `src/act_make.cpp`, economy.md §4.7): the Farm's default task. An idle, active object
 * whose master has a default make task starts it by itself; each step it grows the food the object holds, up to its
 * capacity, until the owner's farm food (attribute 36) is used up; then the emptied object dies.
 */
import type { GameContext } from './context';
import type { Entity } from './entities';
import { typeOf } from './masters';
import { ActionResult } from './movement';
import { add32, f32, mul32, sub32 } from './num';
import type { UnitType } from './units';

export const ACTION_MAKE = 21;
/** Attribute 36, the farm food (economy.md §2.2): what a make action may produce in all; civ start value 250. */
export const ATTR_FARM_FOOD = 36;

/** `RGE_Action_Make`: always in state 6 (working); `timer` is what it may still produce. */
export interface MakeAction {
  task: number;
  timer: number;
}

/**
 * `default_task` (src/m_ac_obj.cpp:130-140): the first task flagged default, if it is a make task (the animals' wander,
 * action 6, is not started, unit-ai.md §5.5).
 */
export function defaultMakeTask(t: UnitType): number {
  const tasks = t.action?.tasks ?? [];
  const i = tasks.findIndex((k) => k.isDefault !== 0);
  return i !== -1 && tasks[i]!.actionType === ACTION_MAKE ? i : -1;
}

/**
 * `set_task(default_task)` (src/act_obj.cpp:403-407) and `first_in_stack` (src/act_make.cpp:20-33): the object's load
 * becomes 0 of the task's type unless it already holds that type, and the timer starts at the owner's attribute 36.
 */
export function startMake(ctx: GameContext, e: Entity, task: number): void {
  const k = typeOf(ctx, e).action!.tasks[task]!;
  if (k.resourceIn >= 0 && e.heldType !== k.resourceIn) {
    e.heldType = k.resourceIn;
    e.heldAmount = f32(0);
  }
  e.make = { task, timer: ctx.attributes[e.owner]![ATTR_FARM_FOOD]! };
}

/**
 * `RGE_Action_Make::update` (src/act_make.cpp:35-76). Once the timer is spent (and attribute 36 is above 0) nothing
 * grows; the object dies (`die_die_die`) when it holds nothing more, after telling its owner (`OBJECT_DEPLETED`). With
 * attribute 36 at 0 or below the timer is ignored. Work flag 0 adds `work` to the object's load (clamped to its
 * capacity) and takes the actual increase off the timer; another flag would credit the owner directly.
 */
export function updateMake(ctx: GameContext, e: Entity, a: MakeAction): ActionResult {
  const t = typeOf(ctx, e);
  const k = t.action!.tasks[a.task]!;
  const attrs = ctx.attributes[e.owner]!;
  if (a.timer <= 0 && attrs[ATTR_FARM_FOOD]! > 0) {
    if (e.heldAmount <= 0) {
      ctx.depleted[e.owner]!++;
      e.hp = 0;
      ctx.wake(e);
    }
    return ActionResult.Continue;
  }
  const work = mul32(mul32(t.action!.workRate, ctx.deltaSeconds), k.workValue1);
  const before = e.heldAmount;
  if (k.workFlag !== 0) {
    attrs[k.resourceIn] = add32(attrs[k.resourceIn]!, work);
  } else {
    e.heldAmount = add32(work, e.heldAmount);
    const cap = f32(Math.trunc(t.resourceCapacity));
    if (cap < e.heldAmount) e.heldAmount = cap;
  }
  a.timer = sub32(a.timer, sub32(e.heldAmount, before));
  return ActionResult.Continue;
}
