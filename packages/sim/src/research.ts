/**
 * A building's research (docs/spec/techs.md §3): the research command, `TRIBE_Action_Make_Tech` (paid when it starts,
 * progress at the building's work rate each step, the tech done when the progress reaches its research time) and its
 * stop. A building does one thing at a time: its research is its only action, and the production queue is dropped
 * while it researches (economy.md §5.1).
 */
import type { GameContext } from './context';
import { removeFromQueue } from './buildings';
import type { Entity } from './entities';
import { deleteActions } from './gather';
import { typeOf } from './masters';
import { ActionResult } from './movement';
import { mul32 } from './num';
import { cancelResearch, research, startResearch } from './techs';
import { AI_ACTION_RESEARCH, NOTIFY_ACTION_COMPLETED, NOTIFY_ACTION_FAILED, notifyObject, setAiAction, stopObject } from './unit-ai';

/** `TRIBE_Action_Make_Tech`. */
export interface ResearchAction {
  tech: number;
  /** 6 working, 1 done or failed (removed on its next update). */
  state: number;
}

const RESEARCH_WORKING = 6;
const RESEARCH_DONE = 1;

/**
 * `TRIBE_Command::do_command_research` (`src/tcommand.cpp:140-172`, techs.md §3.1): dropped while the building
 * researches; else the research replaces every action of the building (`set_only_action`, nothing stopped) and starts
 * (`first_in_stack`: pay and work, or fail and be removed on the first update). The command checks neither the
 * building's kind nor the tech's place.
 */
export function orderResearch(ctx: GameContext, e: Entity, tech: number): void {
  if (e.research) return;
  deleteActions(ctx, e);
  const a: ResearchAction = { tech, state: RESEARCH_WORKING };
  e.research = a;
  if (!startResearch(ctx, e.owner, tech)) {
    notifyObject(ctx, e, e.id, NOTIFY_ACTION_FAILED, AI_ACTION_RESEARCH);
    a.state = RESEARCH_DONE;
  }
  // `setCurrentAction(RESEARCH)`, `setCurrentTarget(unique_id = -1)`.
  setAiAction(e, AI_ACTION_RESEARCH, -1);
}

/**
 * `TRIBE_Action_Make_Tech::update` (`src/tact_tek.cpp:71-109`, techs.md §3.4): `world_time_delta_seconds` times the
 * building's work rate goes to the tech; once it is done the action ends.
 */
export function updateResearch(ctx: GameContext, e: Entity, a: ResearchAction): ActionResult {
  if (a.state === RESEARCH_DONE) return ActionResult.Remove;
  if (a.state !== RESEARCH_WORKING) return ActionResult.Continue;
  const work = mul32(ctx.deltaSeconds, typeOf(ctx, e).action!.workRate);
  if (!research(ctx, e.owner, a.tech, work)) {
    a.state = RESEARCH_DONE;
    notifyObject(ctx, e, e.id, NOTIFY_ACTION_COMPLETED, AI_ACTION_RESEARCH);
    return ActionResult.Remove;
  }
  return ActionResult.Continue;
}

/** `TRIBE_Action_Make_Tech::stop` (`src/tact_tek.cpp:111-123`): the tech is refunded and available again. */
export function stopResearch(ctx: GameContext, e: Entity, a: ResearchAction): void {
  a.state = RESEARCH_DONE;
  cancelResearch(ctx, e.owner, a.tech, true);
  notifyObject(ctx, e, e.id, NOTIFY_ACTION_FAILED, AI_ACTION_RESEARCH);
}

/**
 * The action deleted while it works (`~TRIBE_Action_Make_Tech`, `src/tact_tek.cpp:26-40`): no refund, the progress is
 * lost. A dying building takes this path.
 */
export function dropResearch(ctx: GameContext, e: Entity): void {
  const a = e.research;
  if (!a) return;
  e.research = null;
  if (a.state === RESEARCH_DONE) return;
  cancelResearch(ctx, e.owner, a.tech, false);
  notifyObject(ctx, e, e.id, NOTIFY_ACTION_FAILED, AI_ACTION_RESEARCH);
}

/**
 * The stop command on a building (`RGE_Command::do_command_stop` → `TRIBE_Building_Object::stop`, `src/t_b_obj.cpp:1049`):
 * its research stops with a refund (`action_stop`), its AI stops (`stopObject(1)`: the stopped action is deleted, the
 * standing sprite shown), then the queue goes one unit at a time, each refunded. On a unit (`RGE_Combat_Object::stop`,
 * `src/com_obj.cpp:103`) only the middle part runs: it has no research or queue.
 */
export function stopBuilding(ctx: GameContext, e: Entity): void {
  if (e.research) stopResearch(ctx, e, e.research);
  if (e.ai) stopObject(ctx, e, true);
  else deleteActions(ctx, e);
  while (e.queue && e.queue.length > 0) removeFromQueue(ctx, e, e.queue[0]!.unit, 1);
}
