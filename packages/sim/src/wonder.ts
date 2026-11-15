/**
 * `TRIBE_Action_Wonder` (action 120, `src/tact_wnd.cpp`, victory.md §8): the Wonder's countdown. The Wonder (unit 276)
 * gets it when it is created, a foundation (`TRIBE_Building_Object` ctor, `src/t_b_obj.cpp:53-55`), and again as its
 * default task whenever it is active with no action (`src/act_obj.cpp:403-407`; the stop command deletes it). State 2
 * shows the site to the other players and waits for the building to be active; state 6 shows its sight to them and
 * counts the years, 2 per game second, to 2000: in a Standard game the owner (and its allied-victory team) then wins.
 *
 * The sim sends no notifications: the client reads "started" (a new action), "completed" (state 6) and "destroyed"
 * (the action gone while the game runs) off `Entity.wonder` (hud.md "Wonder"). `VictoryState.wonderCountdown` is
 * `RGE_Base_Game::countdown_timer`, which the Wonder clocks show.
 */
import type { GameContext } from './context';
import { ObjectState, type Entity } from './entities';
import { typeOf } from './masters';
import { add32, f32, sub32, toInt } from './num';
import type { UnitType } from './units';
import { VICTORY_STANDARD, END_WONDER, winGameNow, type VictoryState } from './victory';
import { exploreObject, unexploreObject } from './visibility';

export const ACTION_WONDER = 120;
/** `MASTER_OBJECT_WONDER`. */
export const WONDER = 276;
/** `LIMIT` (`src/tact_wnd.cpp:15`): the years a completed Wonder must stand. */
export const WONDER_YEARS = 2000;
/** `TRIBE_Action_Wonder::state`: waiting for the building (2), counting (6). */
export const WONDER_WAITING = 2;
export const WONDER_COUNTING = 6;

export interface WonderAction {
  state: number;
  /** `timer` (float32): the years counted so far. */
  timer: number;
}

/** `default_task` (src/m_ac_obj.cpp:130-140) when it is the Wonder's action: its index, else -1. */
export function defaultWonderTask(t: UnitType): number {
  const tasks = t.action?.tasks ?? [];
  const i = tasks.findIndex((k) => k.isDefault !== 0);
  return i !== -1 && tasks[i]!.actionType === ACTION_WONDER ? i : -1;
}

/** `RGE_Base_Game::set_countdown_timer` (src/basegame.cpp:3873-3878): only a lower value, or any over -1, is kept. */
export function setCountdown(v: VictoryState, player: number, years: number): void {
  const current = v.wonderCountdown[player]!;
  if (current > years || current < 0) v.wonderCountdown[player] = years;
}

/** The other players 1 and up, whose maps the Wonder shows itself on (`src/tact_wnd.cpp:30-56`, `:105-145`). */
function others(ctx: GameContext, e: Entity): number[] {
  const out: number[] = [];
  for (let i = 1; i < ctx.victory.status.length; i++) if (i !== e.owner) out.push(i);
  return out;
}

/** `set_task(default_task)` + `first_in_stack(1)` → `set_state(2)` (src/tact_wnd.cpp:92-96, :129-148). */
export function startWonder(ctx: GameContext, e: Entity): void {
  e.wonder = { state: WONDER_WAITING, timer: f32(0) };
  const t = typeOf(ctx, e);
  // `explore_terrain(p, 1)`: its footprint (the building override makes an unbuilt one's any call square).
  for (const p of others(ctx, e)) exploreObject(ctx, e, t, true, -1, p);
}

/** `set_state(6)` (src/tact_wnd.cpp:102-127): the footprint gives way to its sight; a Standard game starts the clock. */
function complete(ctx: GameContext, e: Entity, a: WonderAction): void {
  a.state = WONDER_COUNTING;
  const t = typeOf(ctx, e);
  for (const p of others(ctx, e)) {
    unexploreObject(ctx, e, t, true, -1, p);
    exploreObject(ctx, e, t, false, -1, p);
  }
  if (ctx.victory.type === VICTORY_STANDARD) setCountdown(ctx.victory, e.owner, WONDER_YEARS);
}

/**
 * `TRIBE_Action_Wonder::update` (src/tact_wnd.cpp:156-194). Waiting: once the building is active, count from the next
 * update. Counting: `timer = dt + dt + timer` until it reaches 2000, in every game; in a Standard game the countdown
 * shows `(int)(2000 - timer)` and reaching 2000 is `win_game_now` with end condition 100.
 */
export function updateWonder(ctx: GameContext, e: Entity, a: WonderAction): void {
  if (a.state === WONDER_WAITING) {
    if (e.state === ObjectState.Active) complete(ctx, e, a);
    return;
  }
  if (a.state !== WONDER_COUNTING || a.timer >= WONDER_YEARS) return;
  a.timer = add32(add32(ctx.deltaSeconds, ctx.deltaSeconds), a.timer);
  const v = ctx.victory;
  if (v.type !== VICTORY_STANDARD) return;
  setCountdown(v, e.owner, toInt(sub32(WONDER_YEARS, a.timer)));
  if (a.timer >= WONDER_YEARS) {
    winGameNow(v, e.owner, ctx.diplomacy);
    v.endCondition = END_WONDER;
  }
}

/**
 * `~TRIBE_Action_Wonder` (src/tact_wnd.cpp:26-89), while the game runs: the other players lose what it showed them; a
 * completed Wonder's owner's countdown is cleared, and in a Standard game shows 2000 again if it has another Wonder
 * active or past it (the other's next update lowers it).
 */
export function endWonder(ctx: GameContext, e: Entity): void {
  const a = e.wonder;
  if (!a) return;
  e.wonder = null;
  const v = ctx.victory;
  if (v.gameState !== 0) return;
  const t = typeOf(ctx, e);
  if (a.state === WONDER_WAITING) for (const p of others(ctx, e)) unexploreObject(ctx, e, t, true, -1, p);
  if (a.state !== WONDER_COUNTING) return;
  for (const p of others(ctx, e)) unexploreObject(ctx, e, t, false, -1, p);
  if (v.type !== VICTORY_STANDARD) return;
  const another = [...ctx.entities.ofPlayer(e.owner)].some((o) => o !== e && o.type === WONDER && o.state >= ObjectState.Active);
  v.wonderCountdown[e.owner] = -1;
  if (another) setCountdown(v, e.owner, WONDER_YEARS);
}
