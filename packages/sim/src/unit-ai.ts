/**
 * The per-unit AI (`UnitAIModule` and the TRIBE subclasses, docs/spec/unit-ai.md) for human and Gaia owners: the
 * idle-timeout draws at creation, the update on the owner's player turn, the notify queue (attacked, action completed /
 * failed / target invalid), the order queue, the idle scan for soldiers (`bestUnitToAttack`), the reaction to being
 * attacked (soldiers fight back, villagers flee player units and fight animals) and `askForHelp`. Computer-player
 * branches are left out (unit-ai.md §1.4). Fog of war is not ported: every combat object counts as visible, at its
 * current tile, and the visible-unit records are walked in id order.
 */
import { combatAttack, distanceToObject } from './combat';
import type { GameContext } from './context';
import { ObjectState, type Entity } from './entities';
import { aiWork, deleteActions, workMoveTo, ACTION_ATTACK, ACTION_GATHER, ACTION_HUNT, ACTION_MOVE } from './gather';
import { ACTION_BUILD } from './build';
import { hasMaster, typeOf, type PlayerMasters } from './masters';
import { maximumSpeed, startMoveTo } from './movement';
import { add32, div32, f32, mul32, sqrt32, sub32, toInt, u32 } from './num';
import { newSprite } from './sprites';
import type { UnitType } from './units';

/** Unit AI actions (`UNIT_AI_ACTION_*`, include/stat_obj.h). */
export const AI_ACTION_ATTACK = 0x258;
const AI_ACTION_DEFEND = 0x259;
export const AI_ACTION_BUILD = 0x25a;
const AI_ACTION_HEAL = 0x25b;
const AI_ACTION_CONVERT = 0x25c;
export const AI_ACTION_GATHER = 0x261;
export const AI_ACTION_MOVE = 0x262;
const AI_ACTION_FOLLOW = 0x264;
export const AI_ACTION_HUNT = 0x265;
const AI_ACTION_REPAIR = 0x26a;
const AI_ACTION_TRAIN = 0x26b;
export const AI_ACTION_RESEARCH = 0x26c;
/** Unit AI orders (`UNIT_AI_ORDER_*`): an order is its action + 100. */
export const AI_ORDER_ATTACK = 0x2bc;
export const AI_ORDER_BUILD = 0x2be;
const AI_ORDER_STOP = 0x2c2;
export const AI_ORDER_GATHER = 0x2c5;
export const AI_ORDER_MOVE = 0x2c6;
export const AI_ORDER_HUNT = 0x2c9;
const AI_ORDER_REPAIR = 0x2ce;
const AI_ORDER_MOVE_TO_TARGET = 0x2d4;
const AI_ORDER_STAND_GROUND = 0x2d5;
const AI_ORDER_ATTACK_ROUNDUP = 0x2d9;
/** Notifications (`UNIT_AI_NOTIFY_*` and the owner events). */
export const NOTIFY_ATTACKED = 0x1f4;
export const NOTIFY_ACTION_FAILED = 0x1f9;
export const NOTIFY_ACTION_COMPLETED = 0x1fa;
export const NOTIFY_TARGET_INVALID = 0x1fb;
const NOTIFY_UNDER_ATTACK = 0x201;
const NOTIFY_KILLED = 0x209;
const NOTIFY_STOPPED_WORKING = 0x2bb;

/** `processIdle` / `processNotify` results. */
const IDLE_NOTHING = 5;
const IDLE_TASKED = 6;
const NOTE_DONE = 2;
const NOTE_STOP = 3;
const NOTE_DIED = 4;

/** Which `UnitAIModule` subclass an object has (`TRIBE_Combat_Object::initUnitAI`, unit-ai.md §1.1). */
export const AiClass = {
  Soldier: 1,
  Civilian: 2,
  Priest: 3,
  Hunted: 4,
  Elephant: 5,
  Lion: 6,
  Predator: 7,
  FishingShip: 8,
  TradeShip: 9,
  TransportShip: 10,
  Tower: 11,
  Building: 12,
  Artifact: 13,
} as const;

const GROUP_ARTIFACT = 1;
const GROUP_BUILDING = 3;
const GROUP_CIVILIAN = 4;
const GROUP_PREDATOR = 10;
const GROUP_WALL = 27;
const SCOUT = 299;
const CATAPULTS = [35, 36];
const TOWERS = [79, 199, 69, 278, 383, 380];
/** Towers a unit keeps attacking when hit (`processNotify`, src/aiuaimod.cpp:2846-2848). */
const SWITCH_EXEMPT_TOWERS = [79, 199, 69];
/** Groups that never answer `askForHelp`. */
const NO_HELP_GROUPS = [1, 3, 4, 21, 18, 20, 27];
const NO_AI_GROUPS = [5, 7, 8, 11, 14, 15, 16, 29, 30, 31, 32, 33];

/** Important-object groups per class, in scan order (unit-ai.md §3.2). */
const SOLDIER_GROUPS = [0, 3, 4, 26, 24, 6, 35, 25, 17, 12, 23, 36, 28, 18, 13, 27, 22, 20, 2, 21, 39];
const IMPORTANT: Partial<Record<number, readonly number[]>> = {
  [AiClass.Soldier]: SOLDIER_GROUPS,
  [AiClass.Tower]: SOLDIER_GROUPS,
  [AiClass.Building]: SOLDIER_GROUPS,
  [AiClass.Civilian]: [3, 7, 8, 9, 10, 15, 17, 18, 32, 33, 27],
  [AiClass.Priest]: [3, 0, 4, 26, 24, 6, 25, 17, 10, 12, 35, 23, 36, 28, 18, 13, 39],
  [AiClass.Hunted]: [0, 4, 26, 24, 6, 25, 17, 10, 12, 35, 23, 36, 28, 18, 13, 39],
  [AiClass.Predator]: [29, 9, 0, 4, 26, 24, 6, 25, 17, 13, 12, 35, 23, 36, 28, 18, 39],
  [AiClass.Lion]: [29, 9, 0, 4, 26, 24, 6, 25, 17, 13, 12, 35, 23, 36, 28, 18, 39],
};

/**
 * The visible-unit distance `d[dy][dx]` (unit-ai.md §3.2): the smallest LOS radius whose fog-of-war shape
 * (`NormalLOS`, src/visible.cpp:11-136, ref aoe1-decomp@6d6d8b1) contains the cell; 99 beyond radius 16.
 */
const VISIBLE_DISTANCE: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [2, 2, 3, 4, 5, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [3, 3, 4, 4, 5, 6, 7, 8, 9, 10, 10, 11, 12, 13, 14, 15],
  [4, 4, 5, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  [5, 5, 5, 6, 6, 7, 8, 9, 9, 10, 11, 12, 13, 14, 15, 16],
  [6, 6, 6, 7, 7, 8, 9, 9, 10, 11, 12, 13, 13, 14, 15, 16],
  [7, 7, 7, 8, 8, 9, 9, 10, 11, 11, 12, 13, 14, 15, 16, 99],
  [8, 8, 8, 9, 9, 9, 10, 11, 11, 12, 13, 14, 14, 15, 16, 99],
  [9, 9, 9, 10, 10, 10, 11, 11, 12, 13, 14, 14, 15, 16, 99, 99],
  [10, 10, 10, 10, 11, 11, 12, 12, 13, 14, 14, 15, 16, 16, 99, 99],
  [11, 11, 11, 11, 12, 12, 13, 13, 14, 14, 15, 16, 16, 99, 99, 99],
  [12, 12, 12, 12, 13, 13, 13, 14, 14, 15, 16, 16, 99, 99, 99, 99],
  [13, 13, 13, 13, 14, 14, 14, 15, 15, 16, 16, 99, 99, 99, 99, 99],
  [14, 14, 14, 14, 15, 15, 15, 16, 16, 99, 99, 99, 99, 99, 99, 99],
  [15, 15, 15, 15, 16, 16, 16, 99, 99, 99, 99, 99, 99, 99, 99, 99],
];

/** One queued notification (`NotifyEvent`). */
export interface Note {
  caller: number;
  type: number;
  p1: number;
  p2: number;
}

/** One queued order (`OrderEvent`). */
export interface Order {
  issuer: number;
  type: number;
  target: number;
  targetOwner: number;
  x: number;
  y: number;
  z: number;
  range: number;
  priority: number;
}

/** `UnitAIModule` state; times in ms. Ids are -1 when none. */
export interface UnitAI {
  kind: number;
  idleTimeout: number;
  adjustedIdleTimeout: number;
  idleTimer: number;
  action: number;
  lastAction: number;
  order: number;
  lastOrder: number;
  priority: number;
  target: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  lastTarget: number;
  /** `desiredTargetDistance`. */
  desiredDistance: number;
  attackers: number[];
  underAttack: boolean;
  stopAfterTargetKilled: boolean;
  notes: Note[];
  orders: Order[];
}

/** The AI class for a master (`initUnitAI`, src/t_c_obj.cpp:692); null for groups without one. */
export function aiClassOf(t: UnitType): number | null {
  const g = t.group;
  if (g === GROUP_ARTIFACT) return t.id !== 99 && t.id !== 10 ? AiClass.Artifact : AiClass.Soldier;
  if (g === GROUP_CIVILIAN) return AiClass.Civilian;
  if (g === 18) return AiClass.Priest;
  if (g === 9) return AiClass.Hunted;
  if (g === GROUP_PREDATOR) {
    if (t.id === 157) return AiClass.Hunted;
    if (t.id === 48) return AiClass.Elephant;
    if (t.id === 126) return AiClass.Lion;
    return AiClass.Predator;
  }
  if (g === 21) return AiClass.FishingShip;
  if (g === 2) return AiClass.TradeShip;
  if (g === 20) return AiClass.TransportShip;
  if (g === GROUP_BUILDING || g === GROUP_WALL) return TOWERS.includes(t.id) ? AiClass.Tower : AiClass.Building;
  if (NO_AI_GROUPS.includes(g)) return null;
  return AiClass.Soldier;
}

/** Idle timeouts a subclass constructor sets after the base one, each with its own draw (unit-ai.md §1.2). */
const SUBCLASS_TIMEOUT: Partial<Record<number, number>> = {
  [AiClass.Hunted]: 4000,
  [AiClass.Lion]: 6000,
  [AiClass.Soldier]: 1500,
  [AiClass.Artifact]: 5000,
};

/** `setAdjustedIdleTimeout` (src/aiuaimod.cpp:2420): one `rand()`, then a timeout in [0.75 T, 1.25 T). */
function adjustIdleTimeout(ctx: Pick<GameContext, 'rng'>, ai: UnitAI): void {
  const r = ctx.rng.rand();
  ai.adjustedIdleTimeout = u32((r % (ai.idleTimeout >>> 1)) + ((ai.idleTimeout * 3) >>> 2));
}

/**
 * Construct the unit AI of a new combat object (unit, building), drawing its adjusted idle timeout once for the base
 * constructor and once more for a subclass with its own timeout. Null for groups without an AI.
 */
export function createUnitAI(ctx: Pick<GameContext, 'rng'>, t: UnitType): UnitAI | null {
  const kind = aiClassOf(t);
  if (kind === null) return null;
  const ai: UnitAI = {
    kind,
    idleTimeout: 3000,
    adjustedIdleTimeout: 0,
    idleTimer: 0,
    action: -1,
    lastAction: -1,
    order: -1,
    lastOrder: -1,
    priority: -1,
    target: -1,
    targetX: f32(-1),
    targetY: f32(-1),
    targetZ: f32(-1),
    lastTarget: -1,
    desiredDistance: f32(2),
    attackers: [],
    underAttack: false,
    stopAfterTargetKilled: false,
    notes: [],
    orders: [],
  };
  adjustIdleTimeout(ctx, ai);
  const sub = SUBCLASS_TIMEOUT[kind];
  if (sub !== undefined) {
    ai.idleTimeout = sub;
    adjustIdleTimeout(ctx, ai);
  }
  return ai;
}

/** The order and unit-AI action `work2` records for the action type it started (src/act_obj.cpp:212-262). */
export function aiStateForAction(action: number): [order: number, action: number] {
  switch (action) {
    case ACTION_ATTACK:
      return [AI_ORDER_ATTACK, AI_ACTION_ATTACK];
    case ACTION_BUILD:
      return [AI_ORDER_BUILD, AI_ACTION_BUILD];
    case ACTION_GATHER:
      return [AI_ORDER_GATHER, AI_ACTION_GATHER];
    case ACTION_MOVE:
      return [AI_ORDER_MOVE, AI_ACTION_MOVE];
    case ACTION_HUNT:
      return [AI_ORDER_HUNT, AI_ACTION_HUNT];
    default:
      return [-1, -1];
  }
}

/** `setCurrentAction`, `setCurrentOrder`, `setCurrentTarget`, `removeCurrentTarget`. */
export function setAiState(e: Entity, order: number, action: number, target: number, x: number, y: number, z: number): void {
  const ai = e.ai;
  if (!ai) return;
  ai.order = order;
  setAction(ai, action);
  setTarget(ai, target, x, y, z);
}

/** `setCurrentAction(action)` then `setCurrentTarget(target, -1, -1, -1, -1)`, the order kept (a building's train or research). */
export function setAiAction(e: Entity, action: number, target: number): void {
  const ai = e.ai;
  if (!ai) return;
  setAction(ai, action);
  setTarget(ai, target, -1, -1, -1);
}

function setAction(ai: UnitAI, action: number): void {
  ai.lastAction = ai.action;
  ai.action = action;
}

function setTarget(ai: UnitAI, id: number, x: number, y: number, z: number): void {
  ai.lastTarget = ai.target;
  ai.target = id;
  ai.targetX = f32(x);
  ai.targetY = f32(y);
  ai.targetZ = f32(z);
}

function removeCurrentTarget(ai: UnitAI): void {
  ai.lastTarget = ai.target;
  ai.target = -1;
  ai.targetX = f32(-1);
  ai.targetY = f32(-1);
  ai.targetZ = f32(-1);
}

/** The object has a game action at the top of its list. */
function hasAction(e: Entity): boolean {
  return !!(e.work || e.attack || e.mover?.action || e.research);
}

/**
 * `TRIBE_Player::notify` (src/tplayer.cpp:1740-1783): the under-attack alert takes a 20 s cooldown and is fenced off the
 * stream when the attacker exists; every call ends with a fence around the computer-player AI.
 */
export function playerNotify(ctx: GameContext, player: number, type: number, p1: number): void {
  const rng = ctx.rng;
  if (type === NOTIFY_UNDER_ATTACK && ctx.alertCooldown[player] === 0) {
    ctx.alertCooldown[player] = 20;
    if (ctx.entities.get(p1)) rng.srand(rng.rand());
  }
  rng.srand(rng.rand());
}

/**
 * `RGE_Combat_Object::notify` (src/com_obj.cpp:507): only an active object hears anything. Its AI queues the event
 * unless it refuses it (`UnitAIModule::notify`, src/aiuaimod.cpp:1042); a refused event goes to the owner.
 */
export function notifyObject(ctx: GameContext, e: Entity, caller: number, type: number, p1: number, p2 = 0): void {
  if (e.state !== ObjectState.Active) return;
  if (e.ai && aiAccepts(e.ai, caller, type, p1)) {
    // An ACTION_COMPLETED for a move the AI did not order is accepted without queueing.
    if (!(type === NOTIFY_ACTION_COMPLETED && p1 === AI_ACTION_MOVE && e.ai.action !== AI_ACTION_MOVE && e.ai.action !== 0x268)) {
      e.ai.notes.push({ caller, type, p1, p2 });
    }
    return;
  }
  if (type !== NOTIFY_STOPPED_WORKING) playerNotify(ctx, e.owner, type, p1);
}

function aiAccepts(ai: UnitAI, caller: number, type: number, p1: number): boolean {
  if (type === NOTIFY_STOPPED_WORKING) return ai.attackers.includes(caller);
  return type !== NOTIFY_TARGET_INVALID || p1 === ai.action;
}

/** `actionRequiresLiveTarget` (src/aiuaimod.cpp:1163). */
function requiresLiveTarget(ai: UnitAI): boolean {
  const a = ai.action;
  return a === AI_ACTION_ATTACK || a === AI_ACTION_DEFEND || a === AI_ACTION_HEAL || a === AI_ACTION_CONVERT || a === AI_ACTION_REPAIR || a === AI_ACTION_FOLLOW || ai.stopAfterTargetKilled;
}

/** `UnitAIModule::update` (unit-ai.md §2), on the owner's player turn with the owner's accumulated time `uTime` ms. */
export function updateUnitAI(ctx: GameContext, e: Entity, uTime: number): void {
  const ai = e.ai!;
  if (e.state > ObjectState.Active) return;
  const haveAction = hasAction(e);
  if (!haveAction && e.mover?.waitingToMove) e.mover.waitingToMove = false;

  if (ai.target !== -1) {
    const target = ctx.entities.get(ai.target);
    if (!target) {
      ai.target = -1;
      if (ai.action === AI_ACTION_ATTACK) {
        removeCurrentTarget(ai);
        stopObject(ctx, e, true);
        ai.idleTimer = ai.idleTimeout;
      }
    } else if (e.state === ObjectState.Active && target.state > ObjectState.Active && requiresLiveTarget(ai)) {
      ai.stopAfterTargetKilled = false;
      if (ai.action === AI_ACTION_ATTACK) {
        const idle = processIdle(ctx, e, false);
        const order = ai.order;
        if (idle === IDLE_NOTHING) {
          if (order !== AI_ORDER_STAND_GROUND) {
            // The fallback walks to where the target stood when the attack began (decomp @bug, aiuaimod.cpp:449).
            if (!aiMoveTo(ctx, e, ai.targetX, ai.targetY, ai.targetZ, weaponRange(ctx, e), true)) {
              removeCurrentTarget(ai);
              stopObject(ctx, e, true);
            } else {
              ai.lastOrder = ai.order;
              ai.order = -1;
              ai.priority = -1;
            }
          }
        } else if (order !== AI_ORDER_STAND_GROUND) {
          ai.lastOrder = order;
          ai.order = -1;
          ai.priority = -1;
        }
      } else {
        removeCurrentTarget(ai);
        stopObject(ctx, e, true);
      }
    }
  }

  if (ai.attackers.length === 0 && ai.underAttack) ai.underAttack = false;
  else {
    for (let i = 0; i < ai.attackers.length; i++) {
      const a = ctx.entities.get(ai.attackers[i]!);
      if (!a || !a.ai || a.state > ObjectState.Active || a.ai.target !== e.id) {
        ai.attackers.splice(i, 1);
        break;
      }
    }
  }

  ai.idleTimer = u32(ai.idleTimer + uTime);

  for (let i = 0; i < ai.notes.length; i++) {
    const r = processNotify(ctx, e, ai.notes[i]!);
    if (r === NOTE_DIED) {
      ai.notes = [];
      return;
    }
    if (r === NOTE_STOP) break;
  }
  ai.notes = [];

  if (!haveAction) {
    const a = ai.action;
    if (a === AI_ACTION_ATTACK || a === AI_ACTION_GATHER || a === AI_ACTION_MOVE || a === AI_ACTION_HUNT || a === AI_ACTION_TRAIN || a === AI_ACTION_RESEARCH) {
      ai.action = -1;
    }
  }
  if (e.state > ObjectState.Active) return;

  if (ai.action === -1) {
    // `processOrder` always removes the entry, yet the index still moves on: the order that slid into its place waits.
    for (let i = 0; i < ai.orders.length; i++) if (processOrder(ctx, e, i)) break;
  }

  if (ai.idleTimer > ai.adjustedIdleTimeout) {
    ai.idleTimer = 0;
    if (ai.action === -1 && ai.target === -1) processIdle(ctx, e, true);
  } else if (ai.action !== -1 || ai.target !== -1) ai.idleTimer = 0;
}

/** `stopObject` (src/aiuaimod.cpp:1733): `stopAction` drops every action and shows the standing sprite. */
export function stopObject(ctx: GameContext, e: Entity, checkOrderAndAction: boolean): void {
  const ai = e.ai!;
  ai.lastAction = ai.action;
  if (!checkOrderAndAction || ai.action + 100 === ai.order) {
    ai.lastOrder = ai.order;
    ai.order = -1;
    ai.priority = -1;
  }
  deleteActions(ctx, e);
  newSprite(ctx, e, null);
  ai.action = -1;
}

/** `weaponRange(ctx, )`: the master's weapon range; 0 for objects without combat data. */
function weaponRange(ctx: PlayerMasters, e: Entity): number {
  return typeOf(ctx, e).combat?.range ?? 0;
}

/** `inAttackRange` (src/com_obj.cpp:890): edge distance within range + own radius + 0.3. */
function inAttackRange(ctx: PlayerMasters, e: Entity, target: Entity): boolean {
  const t = typeOf(ctx, e);
  const radius = sqrt32(add32(mul32(t.radiusX, t.radiusX), mul32(t.radiusY, t.radiusY)));
  return distanceToObject(ctx, e, target) <= add32(add32(weaponRange(ctx, e), radius), f32(0.3));
}

/**
 * `canPath(targetID, range)` (src/move_obj.cpp:1468): a tile path search towards the target's tile. The zone pre-check
 * is not ported (zones are not), so a target in another zone costs a full search instead of an early no.
 */
function canPath(ctx: GameContext, e: Entity, target: Entity, range: number): boolean {
  if (!e.mover) return false;
  return ctx.pathing.findTilePath(e, typeOf(ctx, e), toInt(e.x), toInt(e.y), toInt(target.x), toInt(target.y), range, target.id).found;
}

function canAttackUnit(ctx: PlayerMasters, ai: UnitAI, target: Entity): boolean {
  if (ai.kind === AiClass.Soldier || ai.kind === AiClass.Civilian || ai.kind === AiClass.Tower) return typeOf(ctx, target).group !== GROUP_ARTIFACT;
  return true;
}

function canAttackUnitAtNeutrality(ai: UnitAI, group: number): boolean {
  if (ai.kind === AiClass.Civilian) return false;
  if (ai.kind === AiClass.Soldier) return ![3, 27, 4, 21, 2, 20].includes(group);
  return true;
}

/** `attackObject` (src/aiuaimod.cpp:1752). */
export function attackObject(ctx: GameContext, e: Entity, targetId: number, unconditional: boolean): boolean {
  const ai = e.ai!;
  if (!unconditional && ai.action !== -1) return false;
  const target = ctx.entities.get(targetId);
  if (!target || !canAttackUnit(ctx, ai, target)) return false;
  if (!combatAttack(ctx, e, target, unconditional)) return false;
  // `attack` may have transformed a villager; the AI record travels with the object.
  setAction(e.ai!, AI_ACTION_ATTACK);
  setTarget(e.ai!, targetId, target.x, target.y, target.z);
  return true;
}

/**
 * `RGE_Combat_Object::moveTo(x, y, z, range)` (src/com_obj.cpp:648): the current gather/hunt/build action takes the walk
 * when it can; otherwise a fresh move replaces every action.
 */
function objectMoveTo(ctx: GameContext, e: Entity, x: number, y: number, z: number, range: number, unconditional: boolean): boolean {
  const m = e.mover;
  if (!m) return false;
  const top = m.action && !e.work && !e.attack ? m.action : null;
  if (!unconditional && top && top.target === -1 && top.x === x && top.y === y && top.z === z) return true;
  if (workMoveTo(ctx, e, x, y)) return true;
  deleteActions(ctx, e);
  startMoveTo(e, null, x, y, z, range, null, false, ctx);
  return true;
}

/** `UnitAIModule::moveTo(x, y, z, range)` (src/aiuaimod.cpp:2033). */
function aiMoveTo(ctx: GameContext, e: Entity, x: number, y: number, z: number, range: number, unconditional: boolean): boolean {
  const ai = e.ai!;
  if (!unconditional && ai.action !== -1) return false;
  if (!objectMoveTo(ctx, e, x, y, z, range, unconditional)) return false;
  setAction(ai, AI_ACTION_MOVE);
  setTarget(ai, -1, x, y, z);
  return true;
}

/** `evasiveMoveTo` (src/aiuaimod.cpp:2048): clamp into the map, up to 5 jitters of 4 draws while not passable. */
function evasiveMoveTo(ctx: GameContext, e: Entity, x: number, y: number, z: number): boolean {
  // |S| = 0 gives NaN in the original too (unit-ai.md §4.5, unverified): no walk.
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  const t = typeOf(ctx, e);
  const width = f32(ctx.map.width);
  const height = f32(ctx.map.height);
  const clamp = () => {
    if (x < 0) x = 0;
    else if (x >= width) x = sub32(width, 1);
    if (y < 0) y = 0;
    else if (y >= height) y = sub32(height, 1);
  };
  clamp();
  const rng = ctx.rng;
  for (let i = 0; i < 5; i++) {
    if (ctx.pathing.passable(e, t, x, y, true)) break;
    x = rng.rand() % 2 ? add32(x, rng.rand() % 4) : sub32(x, rng.rand() % 4);
    y = rng.rand() % 2 ? add32(y, rng.rand() % 4) : sub32(y, rng.rand() % 4);
    clamp();
  }
  return aiMoveTo(ctx, e, x, y, z, 0, true);
}

/** `runAwayFromAttackers` (src/aiuaimod.cpp:2205): flee 4 × maximum speed away from the sum of the attacker vectors. */
function runAwayFromAttackers(ctx: GameContext, e: Entity): boolean {
  const ai = e.ai!;
  let dx = 0;
  let dy = 0;
  for (const id of ai.attackers) {
    const a = ctx.entities.get(id);
    if (!a) continue;
    dx = add32(dx, sub32(a.x, e.x));
    dy = add32(dy, sub32(a.y, e.y));
  }
  const distance = mul32(maximumSpeed(e, typeOf(ctx, e)), 4);
  const length = sqrt32(add32(mul32(dx, dx), mul32(dy, dy)));
  const x = add32(-mul32(div32(dx, length), distance), e.x);
  const y = add32(-mul32(div32(dy, length), distance), e.y);
  return evasiveMoveTo(ctx, e, x, y, e.z);
}

/** One visible-unit record (`VISIBLE_UNIT_REC`) as a search result. */
interface Seen {
  id: number;
  distance: number;
}

/** Diplomacy buckets of `GetVisibleUnits`: 0 Gaia, 1 self, 2 ally, 3 neutral, 4 enemy. Every other player is an enemy. */
function bucketOf(searcher: number, owner: number): number {
  if (owner === 0) return 0;
  return owner === searcher ? 1 : 4;
}

/**
 * `search` / `GetVisibleUnits` (unit-ai.md §3.2) around the unit's tile with radius (int) LOS (doubled for the builder,
 * clamped to 15): the combat objects of each important group, in group order, bucketed by diplomacy, at most 256 a
 * bucket.
 */
function search(ctx: GameContext, e: Entity): Seen[][] {
  const buckets: Seen[][] = [[], [], [], [], []];
  const groups = IMPORTANT[e.ai!.kind];
  if (!groups) return buckets;
  const t = typeOf(ctx, e);
  let radius = toInt(t.los);
  if (t.id === 118) radius += radius;
  if (radius > 15) radius = 15;
  const cx = toInt(e.x);
  const cy = toInt(e.y);
  const all = [...ctx.entities.all()].filter((o) => {
    // `test` probe objects are not game objects.
    const ot = hasMaster(ctx, o.owner, o.type) ? typeOf(ctx, o) : undefined;
    if (!ot) return false;
    return ot.masterType >= 50 && ot.masterType <= 80 && o.state < ObjectState.PendingRemoval;
  });
  for (const group of groups) {
    for (const o of all) {
      if (typeOf(ctx, o).group !== group) continue;
      const ox = toInt(o.x);
      const oy = toInt(o.y);
      if (ox > cx + radius || ox < cx - radius || oy > cy + radius || oy < cy - radius) continue;
      const d = VISIBLE_DISTANCE[Math.abs(oy - cy) & 15]![Math.abs(ox - cx) & 15]!;
      if (d > radius) continue;
      const list = buckets[bucketOf(e.owner, o.owner)]!;
      if (list.length >= 0x100) continue;
      list.push({ id: o.id, distance: d });
    }
  }
  return buckets;
}

/** `damageCapability(ctx, )` (src/com_obj.cpp:859): the sum of the positive weapon values. */
function damageCapability(ctx: PlayerMasters, e: Entity): number {
  let total = 0;
  for (const w of typeOf(ctx, e).combat?.attacks ?? []) if (w.amount > 0) total = add32(total, w.amount);
  return total;
}

/** `calc_base_damage_ability` of `target`'s master against `attacker`'s weapons (src/m_co_obj.cpp:525), an integer ≥ 1. */
function baseDamageAbility(ctx: PlayerMasters, target: Entity, attacker: Entity): number {
  const defence = typeOf(ctx, target).combat;
  let total = 0;
  for (const w of typeOf(ctx, attacker).combat?.attacks ?? []) {
    let armour = defence?.baseArmour ?? 0;
    for (const a of defence?.armours ?? []) if (a.group === w.group) armour = a.amount;
    const diff = sub32(w.amount, armour);
    if (diff > 0) total = add32(total, diff);
  }
  if (total < 1) total = 1;
  return Math.trunc(total);
}

/**
 * `bestUnitToAttack(allowWalls, quickCheck)` (src/aiuaimod.cpp:1177, unit-ai.md §3.3) for a human or Gaia searcher
 * with no single-player difficulty. Returns an object id or -1.
 */
export function bestUnitToAttack(ctx: GameContext, e: Entity, allowWalls: boolean, quickCheck: boolean): number {
  const ai = e.ai!;
  const t = typeOf(ctx, e);
  const buckets = search(ctx, e);
  const modifier = toInt(t.los) * 2;
  const minRange = t.combat?.minRange ?? 0;
  const current = ai.target === -1 ? undefined : ctx.entities.get(ai.target);
  const wallOk = !!current && typeOf(ctx, current).group === GROUP_WALL;
  const passes = (o: Entity | undefined, bucket: number): o is Entity => {
    if (!o || o.state > ObjectState.Active) return false;
    if (o.owner === e.owner) return false;
    const g = typeOf(ctx, o).group;
    if (!(allowWalls && wallOk) && g === GROUP_WALL) return false;
    if (g === GROUP_BUILDING && o.hp <= 1 && CATAPULTS.includes(t.id)) return false;
    if (!canAttackUnit(ctx, ai, o)) return false;
    return bucket !== 3 || canAttackUnitAtNeutrality(ai, g);
  };
  let nonCurrent = 0;
  let nUnits = 0;
  let nArmed = 0;
  let closest = f32(100000);
  let closestId = -1;
  for (let b = 4; b >= 2; b--) {
    for (const r of buckets[b]!) {
      const o = ctx.entities.get(r.id);
      if (!passes(o, b)) continue;
      const d = distanceToObject(ctx, e, o);
      if (!(minRange <= d && modifier >= r.distance)) continue;
      if (o.id !== ai.target) nonCurrent++;
      const building = typeOf(ctx, o).group === GROUP_BUILDING;
      if (!building) nUnits++;
      if (damageCapability(ctx, o) > 0) nArmed++;
      if (!building && d < closest) {
        closest = d;
        closestId = o.id;
      }
    }
  }
  let best = -1;
  let bestScore = 0;
  let bestIsBuilding = false;
  if (current && !quickCheck && ai.action === AI_ACTION_ATTACK) {
    // With every object visible, the visibility gate on a current wall target always passes.
    const blocked = nonCurrent !== 0 && !inAttackRange(ctx, e, current) && !canPath(ctx, e, current, weaponRange(ctx, e));
    if (!blocked && current.state === ObjectState.Active && current.owner !== e.owner) {
      if (current.type === 276) return current.id;
      best = current.id;
      let score = add32(mul32(baseDamageAbility(ctx, current, e), 100), mul32(damageCapability(ctx, current), 50));
      if (current.hp > 0) score = div32(score, current.hp);
      const d = distanceToObject(ctx, current, e);
      if (nUnits < 2) {
        if (d !== 0) score = div32(score, d);
      } else if (d !== 0) score = div32(score, mul32(mul32(nUnits, d), f32(0.5)));
      bestScore = score;
      if (typeOf(ctx, current).group !== GROUP_BUILDING) {
        nUnits++;
        bestIsBuilding = false;
      } else bestIsBuilding = true;
      if (damageCapability(ctx, current) > 0) nArmed++;
    }
  }
  if (nUnits > 1) {
    const o = ctx.entities.get(closestId);
    if (o && (inAttackRange(ctx, e, o) || canPath(ctx, e, o, weaponRange(ctx, e)))) return closestId;
  }
  for (let b = 4; b >= 2; b--) {
    for (const r of buckets[b]!) {
      const o = ctx.entities.get(r.id);
      if (!passes(o, b)) continue;
      const d = distanceToObject(ctx, e, o);
      if (!(minRange <= d && modifier >= r.distance && (!quickCheck || inAttackRange(ctx, e, o)))) continue;
      if (!quickCheck && !inAttackRange(ctx, e, o) && !canPath(ctx, e, o, weaponRange(ctx, e))) continue;
      const threat = mul32(damageCapability(ctx, o), 50);
      if (nArmed > 0 && threat === 0) continue;
      let score = add32(mul32(baseDamageAbility(ctx, o, e), 100), threat);
      if (o.hp > 0) score = div32(score, o.hp);
      if (r.distance !== 0) score = div32(score, r.distance);
      if (nUnits > 1) score = div32(score, r.distance * r.distance * r.distance);
      const building = typeOf(ctx, o).group === GROUP_BUILDING;
      if (best === -1 || bestIsBuilding || !building) {
        if (best === -1 || (bestIsBuilding && !building) || score > bestScore) {
          best = o.id;
          bestIsBuilding = building;
          bestScore = score;
        }
      }
    }
  }
  return best;
}

/** `processIdle(doSearch)` per class (unit-ai.md §3.1): 6 when it found something to do, else 5. */
function processIdle(ctx: GameContext, e: Entity, doSearch: boolean): number {
  void doSearch; // `processRetryableOrder` never retries for these classes.
  const ai = e.ai!;
  switch (ai.kind) {
    case AiClass.Soldier: {
      if (e.owner === 0 || e.type === SCOUT) return IDLE_NOTHING;
      if (ai.order === AI_ORDER_STAND_GROUND && (CATAPULTS.includes(e.type) || e.type === 250)) return IDLE_NOTHING;
      const id = bestUnitToAttack(ctx, e, true, false);
      return id !== -1 && attackObject(ctx, e, id, true) ? IDLE_TASKED : IDLE_NOTHING;
    }
    case AiClass.Tower:
    case AiClass.Predator: {
      const id = bestUnitToAttack(ctx, e, true, false);
      return id !== -1 && attackObject(ctx, e, id, true) ? IDLE_TASKED : IDLE_NOTHING;
    }
    default:
      // Civilians, buildings, priests and ships do nothing for a human; the animal classes are not ported yet.
      return IDLE_NOTHING;
  }
}

/** Remember the attacker (`attackingUnits`) and raise the under-attack flag. */
function recordAttacker(ai: UnitAI, caller: number): void {
  if (!ai.attackers.includes(caller)) ai.attackers.push(caller);
  ai.underAttack = true;
}

/** The ATTACKED preamble shared by the classes: the alert on the first attacker, then `askForHelp` for a new one. */
function alertAndAskForHelp(ctx: GameContext, e: Entity, note: Note): void {
  const ai = e.ai!;
  if (ai.attackers.length === 0) playerNotify(ctx, e.owner, NOTIFY_UNDER_ATTACK, note.caller);
  if (!ai.attackers.includes(note.caller) && ai.target !== note.caller) askForHelp(ctx, e, note.caller);
  recordAttacker(ai, note.caller);
}

function processNotify(ctx: GameContext, e: Entity, note: Note): number {
  switch (e.ai!.kind) {
    case AiClass.Soldier:
    case AiClass.Tower:
    case AiClass.Predator:
    case AiClass.Priest:
      return baseNotify(ctx, e, note);
    case AiClass.Civilian:
      return civilianNotify(ctx, e, note);
    case AiClass.Building:
      return buildingNotify(ctx, e, note);
    default:
      // The animal, ship and artifact reactions are not ported yet.
      return NOTE_DONE;
  }
}

/** `UnitAIModule::processNotify` (src/aiuaimod.cpp:2754, unit-ai.md §4.2, §4.6). */
function baseNotify(ctx: GameContext, e: Entity, note: Note): number {
  const ai = e.ai!;
  switch (note.type) {
    case NOTIFY_ATTACKED: {
      // `notifyCommander`: no groups for humans, but the owner always hears it.
      playerNotify(ctx, e.owner, note.type, note.p1);
      if (note.p2 < 1) {
        playerNotify(ctx, e.owner, NOTIFY_KILLED, note.caller);
        ai.notes = [];
        return NOTE_DIED;
      }
      alertAndAskForHelp(ctx, e, note);
      if (ai.order !== -1) return NOTE_DONE;
      const attacker = ctx.entities.get(note.caller);
      if (!attacker || attacker.owner === e.owner) return NOTE_DONE;
      if (ai.action === AI_ACTION_HEAL && runAwayFromAttackers(ctx, e)) return NOTE_STOP;
      const target = ai.target === -1 ? undefined : ctx.entities.get(ai.target);
      if (target) {
        const tt = typeOf(ctx, target);
        if ((tt.group === GROUP_BUILDING || tt.group === GROUP_WALL) && !SWITCH_EXEMPT_TOWERS.includes(tt.id)) {
          if (!canAttackUnit(ctx, ai, attacker) || (!inAttackRange(ctx, e, attacker) && !canPath(ctx, e, attacker, weaponRange(ctx, e)))) {
            runAwayFromAttackers(ctx, e);
            return NOTE_STOP;
          }
          attackObject(ctx, e, note.caller, true);
          return NOTE_STOP;
        }
        // A human unit keeps a unit (or tower) target; the kill-time comparison is for computer players.
        return NOTE_DONE;
      }
      if (canAttackUnit(ctx, ai, attacker) && (inAttackRange(ctx, e, attacker) || canPath(ctx, e, attacker, weaponRange(ctx, e)))) {
        attackObject(ctx, e, note.caller, true);
        return NOTE_STOP;
      }
      if (ai.action !== AI_ACTION_MOVE) runAwayFromAttackers(ctx, e);
      return NOTE_STOP;
    }
    case NOTIFY_ACTION_COMPLETED:
    case NOTIFY_ACTION_FAILED:
    case NOTIFY_TARGET_INVALID: {
      // Completion keeps a human attack order's checks (`stopObject(0)`); failure and invalid targets use stopObject(1).
      const completed = note.type === NOTIFY_ACTION_COMPLETED;
      if (ai.order === AI_ORDER_ATTACK && note.p1 === AI_ACTION_ATTACK) {
        if (processIdle(ctx, e, false) !== IDLE_NOTHING) return NOTE_DONE;
        removeCurrentTarget(ai);
        stopObject(ctx, e, !completed);
        return NOTE_DONE;
      }
      if ((ai.order !== -1 && ai.order === ai.action + 100) || (ai.order === -1 && ai.action === note.p1)) {
        removeCurrentTarget(ai);
        stopObject(ctx, e, true);
        if (!completed) playerNotify(ctx, e.owner, note.type, note.p1);
        return NOTE_DONE;
      }
      if (ai.order === AI_ORDER_MOVE_TO_TARGET && note.p1 === AI_ACTION_MOVE) {
        removeCurrentTarget(ai);
        stopObject(ctx, e, false);
      }
      return NOTE_DONE;
    }
    case NOTIFY_STOPPED_WORKING: {
      const i = ai.attackers.indexOf(note.caller);
      if (i !== -1) ai.attackers.splice(i, 1);
      return NOTE_DONE;
    }
    default:
      return NOTE_DONE;
  }
}

/** `TribeCivilianUnitAIModule::processNotify` (src/taiuaimd.cpp:568, unit-ai.md §4.3). */
function civilianNotify(ctx: GameContext, e: Entity, note: Note): number {
  const ai = e.ai!;
  switch (note.type) {
    case NOTIFY_ATTACKED: {
      if (note.p2 <= 0) {
        playerNotify(ctx, e.owner, NOTIFY_KILLED, note.caller);
        ai.notes = [];
        return NOTE_DIED;
      }
      const attacker = ctx.entities.get(note.caller);
      const target = ai.target === -1 ? undefined : ctx.entities.get(ai.target);
      if (!attacker) return NOTE_DONE;
      alertAndAskForHelp(ctx, e, note);
      const speed = e.mover?.speed ?? 0;
      const order = ai.order;
      if (order === AI_ORDER_MOVE && speed > 0) return NOTE_DONE;
      if (order === AI_ORDER_ATTACK || order === AI_ORDER_REPAIR) return NOTE_DONE;
      if (order === AI_ORDER_HUNT && e.work?.state === 12 && target && typeOf(ctx, target).group === GROUP_PREDATOR && attacker.owner === 0) return NOTE_DONE;
      if (attacker.owner === 0) {
        // An animal: fight back, then go back to the order.
        if (order !== -1) {
          aiOrder(ctx, e, e.id, order, ai.target, -1, ai.targetX, ai.targetY, ai.targetZ, ai.desiredDistance, false, false, ai.priority);
          ai.order = AI_ORDER_ATTACK;
          ai.priority = 100;
          attackObject(ctx, e, note.caller, true);
          ai.stopAfterTargetKilled = true;
          return NOTE_STOP;
        }
        attackObject(ctx, e, note.caller, true);
        return NOTE_STOP;
      }
      if (ai.action === AI_ACTION_MOVE && speed !== 0) return NOTE_STOP;
      // A player's unit: queue the order again, stop and run.
      aiOrder(ctx, e, e.id, order, ai.target, -1, ai.targetX, ai.targetY, ai.targetZ, ai.desiredDistance, false, false, ai.priority);
      stopObject(ctx, e, true);
      runAwayFromAttackers(ctx, e);
      return NOTE_STOP;
    }
    case NOTIFY_ACTION_COMPLETED:
    case NOTIFY_ACTION_FAILED:
      if (ai.action !== note.p1) return NOTE_DONE;
      removeCurrentTarget(ai);
      stopObject(ctx, e, true);
      playerNotify(ctx, e.owner, note.type, note.p1);
      return NOTE_DONE;
    default:
      // Target-invalid and task requests re-task gatherers (economy); not ported yet.
      return NOTE_DONE;
  }
}

/** `TribeBuildingUnitAIModule::processNotify` (src/taiuaimd.cpp:2238): alert, help call, attacker list. */
function buildingNotify(ctx: GameContext, e: Entity, note: Note): number {
  const ai = e.ai!;
  switch (note.type) {
    case NOTIFY_ATTACKED:
      if (note.p2 <= 0) {
        playerNotify(ctx, e.owner, NOTIFY_KILLED, note.caller);
        ai.notes = [];
        return NOTE_DIED;
      }
      alertAndAskForHelp(ctx, e, note);
      return NOTE_DONE;
    case AI_ACTION_ATTACK:
      recordAttacker(ai, note.caller);
      return NOTE_DONE;
    case NOTIFY_STOPPED_WORKING: {
      const i = ai.attackers.indexOf(note.caller);
      if (i !== -1) ai.attackers.splice(i, 1);
      return NOTE_DONE;
    }
    default:
      return NOTE_DONE;
  }
}

/**
 * `askForHelp` (src/aiuaimod.cpp:2494, unit-ai.md §4.4): idle armed units of the owner within 3 tiles of the victim, among
 * its own search results, get an immediate attack order on the attacker (priority 50). The order's z is the attacker's
 * y, as in the original.
 */
function askForHelp(ctx: GameContext, e: Entity, attackerId: number): void {
  const attacker = ctx.entities.get(attackerId);
  if (!attacker) return;
  const buckets = search(ctx, e);
  for (const bucket of [1, 2]) {
    for (const r of buckets[bucket]!) {
      if (r.id === e.id) continue;
      const o = ctx.entities.get(r.id);
      if (!o?.ai || o.state > ObjectState.Active) continue;
      if (NO_HELP_GROUPS.includes(typeOf(ctx, o).group)) continue;
      if (o.owner !== e.owner) continue;
      if (distanceToObject(ctx, e, o) > 3) continue;
      if (o.ai.action !== -1 || o.ai.order !== -1 || o.ai.orders.length > 0) continue;
      aiOrder(ctx, o, o.owner, AI_ORDER_ATTACK, attackerId, attacker.owner, attacker.x, attacker.y, attacker.y, weaponRange(ctx, o), true, false, 50);
    }
  }
}

/**
 * `order` (src/aiuaimod.cpp:1000, status N): queue an order at the back (or the front), or for an immediate one put it
 * first, drop the current target, stop, purge the notify queue and run it at once.
 */
function aiOrder(
  ctx: GameContext,
  e: Entity,
  issuer: number,
  type: number,
  target: number,
  targetOwner: number,
  x: number,
  y: number,
  z: number,
  range: number,
  immediate: boolean,
  inFront: boolean,
  priority: number,
): void {
  const ai = e.ai!;
  if (e.state > ObjectState.Active) return;
  const make = (): Order => ({ issuer, type, target, targetOwner, x: f32(x), y: f32(y), z: f32(z), range: f32(range), priority });
  if (!immediate) {
    if (inFront) ai.orders.unshift(make());
    else ai.orders.push(make());
    return;
  }
  if (inFront) {
    ai.orders.unshift({ issuer: e.id, type: ai.order, target: ai.target, targetOwner: -1, x: ai.targetX, y: ai.targetY, z: ai.targetZ, range: ai.desiredDistance, priority: ai.priority });
  }
  ai.orders.unshift(make());
  if (type !== AI_ORDER_ATTACK_ROUNDUP) removeCurrentTarget(ai);
  stopObject(ctx, e, true);
  ai.notes = [];
  processOrder(ctx, e, 0);
}

/**
 * `processOrder` (src/aiuaimod.cpp:2543) for the orders a human game produces: run entry `index`, make it the current
 * order on success, then remove it. The shift copies every field but `range` (decomp: 8 of 9), so a later entry keeps
 * the range of the one it replaced.
 */
function processOrder(ctx: GameContext, e: Entity, index: number): boolean {
  const ai = e.ai!;
  const o = ai.orders[index]!;
  let ok = false;
  switch (o.type) {
    case AI_ORDER_STOP:
    case AI_ORDER_STAND_GROUND:
      removeCurrentTarget(ai);
      stopObject(ctx, e, true);
      ok = true;
      break;
    case AI_ORDER_MOVE:
    case AI_ORDER_MOVE_TO_TARGET:
      ok = aiMoveTo(ctx, e, o.x, o.y, o.z, o.range, true);
      break;
    case AI_ORDER_ATTACK:
      ok = attackObject(ctx, e, o.target, true);
      break;
    case AI_ORDER_GATHER:
      ok = aiTask(ctx, e, o.target, ACTION_GATHER, AI_ACTION_GATHER);
      break;
    case AI_ORDER_HUNT:
      stopObject(ctx, e, true);
      ok = aiTask(ctx, e, o.target, ACTION_HUNT, AI_ACTION_HUNT);
      break;
    case AI_ORDER_BUILD:
      ok = aiTask(ctx, e, o.target, ACTION_BUILD, AI_ACTION_BUILD);
      break;
  }
  if (ok) {
    if (o.type === AI_ORDER_STOP) {
      ai.order = -1;
      ai.priority = -1;
    } else {
      ai.order = o.type === AI_ORDER_ATTACK_ROUNDUP ? AI_ORDER_ATTACK : o.type;
      ai.priority = o.priority;
    }
  }
  const q = ai.orders;
  for (let i = index; i < q.length - 1; i++) q[i] = { ...q[i + 1]!, range: q[i]!.range };
  q.pop();
  return ok;
}

/** `gatherObject` / `huntObject` / `buildObject`: start the task of that kind on the target, then record it. */
function aiTask(ctx: GameContext, e: Entity, targetId: number, kind: number, action: number): boolean {
  const target = ctx.entities.get(targetId);
  if (!target || !aiWork(ctx, e, target, kind)) return false;
  setAction(e.ai!, action);
  setTarget(e.ai!, targetId, target.x, target.y, target.z);
  return true;
}
