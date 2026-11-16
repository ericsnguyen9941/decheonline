/**
 * The per-unit AI (`UnitAIModule` and the TRIBE subclasses, docs/spec/unit-ai.md) for human and Gaia owners: the
 * idle-timeout draws at creation, the update on the owner's player turn, the notify queue (attacked, action completed /
 * failed / target invalid), the order queue, the idle scan for soldiers (`bestUnitToAttack`), the reaction to being
 * attacked (soldiers fight back, villagers flee player units and fight animals), `askForHelp` and the Gaia animals
 * (hunted animals run, the elephant fights back, the lion hunts what it sees; unit-ai.md §5). Computer-player
 * branches are left out (unit-ai.md §1.4). Fog of war is not ported: every combat object counts as visible, at its
 * current tile, and the visible-unit records are walked in id order.
 */
import { combatAttack, distanceToObject } from './combat';
import type { GameContext } from './context';
import { isAlly, unitDiplomacy, UNIT_DIPLOMACY_ALLY, UNIT_DIPLOMACY_ENEMY, UNIT_DIPLOMACY_NEUTRAL, UNIT_DIPLOMACY_SELF } from './diplomacy';
import { ObjectState, type Entity } from './entities';
import { aiWork, deleteActions, getTask, workMoveTo, ACTION_ATTACK, ACTION_GATHER, ACTION_HUNT, ACTION_MOVE } from './gather';
import { ACTION_BUILD } from './build';
import { typeOf, type PlayerMasters } from './masters';
import { maximumSpeed, startMoveTo } from './movement';
import { add32, div32, f32, mul32, sqrt32, sub32, toInt, u32 } from './num';
import { ACTION_REPAIR, aiRepair } from './repair';
import { ACTION_CONVERT, ACTION_HEAL, aiPriestAction, FAITH_MAX, GROUP_PRIEST } from './priest';
import {
  ACTION_ENTER,
  ACTION_TRANSPORT,
  AI_ACTION_ENTER,
  AI_ACTION_TRANSPORT,
  AI_ACTION_UNLOAD,
  startEnter,
  startTransport,
  transportWork,
  unload,
} from './transport';
import { ACTION_TRADE, AI_ACTION_TRADE, AI_ORDER_TRADE, aiTrade } from './trade';
import { NOTIFY_CANNOT_TRADE_WITH_ENEMY, NOTIFY_NOT_CLOSE_ENOUGH_TO_LAND, NOTIFY_NOT_ENOUGH_UNLOAD_SPACE } from './game-log';
import { newSprite } from './sprites';
import { FARM, type UnitType } from './units';
import { TILE_VISIBLE } from './visibility';

/** Unit AI actions (`UNIT_AI_ACTION_*`, include/stat_obj.h). */
export const AI_ACTION_ATTACK = 0x258;
const AI_ACTION_DEFEND = 0x259;
export const AI_ACTION_BUILD = 0x25a;
export const AI_ACTION_HEAL = 0x25b;
export const AI_ACTION_CONVERT = 0x25c;
export const AI_ACTION_GATHER = 0x261;
export const AI_ACTION_MOVE = 0x262;
const AI_ACTION_FOLLOW = 0x264;
export const AI_ACTION_HUNT = 0x265;
export const AI_ACTION_REPAIR = 0x26a;
const AI_ACTION_TRAIN = 0x26b;
export const AI_ACTION_RESEARCH = 0x26c;
/** Unit AI orders (`UNIT_AI_ORDER_*`): an order is its action + 100. */
export const AI_ORDER_ATTACK = 0x2bc;
export const AI_ORDER_BUILD = 0x2be;
export const AI_ORDER_HEAL = 0x2bf;
export const AI_ORDER_CONVERT = 0x2c0;
const AI_ORDER_STOP = 0x2c2;
export const AI_ORDER_GATHER = 0x2c5;
export const AI_ORDER_MOVE = 0x2c6;
export const AI_ORDER_HUNT = 0x2c9;
export const AI_ORDER_REPAIR = 0x2ce;
const AI_ORDER_MOVE_TO_TARGET = 0x2d4;
export const AI_ORDER_STAND_GROUND = 0x2d5;
/** `UNIT_AI_ORDER_DEFEND`, `UNIT_AI_ORDER_FOLLOW` (include/stat_obj.h): only a computer player gives them in 1.0a. */
const AI_ORDER_DEFEND = 0x2bd;
const AI_ORDER_FOLLOW = 0x2c8;
/** `UNIT_AI_ORDER_TRANSPORT`, `UNIT_AI_ORDER_ENTER`, `UNIT_AI_ORDER_UNLOAD` (include/stat_obj.h). */
const AI_ORDER_TRANSPORT = 0x2ca;
const AI_ORDER_ENTER = 0x2cd;
const AI_ORDER_UNLOAD = 0x2d1;
const AI_ORDER_ATTACK_ROUNDUP = 0x2d9;
/** Notifications (`UNIT_AI_NOTIFY_*` and the owner events). */
export const NOTIFY_ATTACKED = 0x1f4;
export const NOTIFY_ACTION_FAILED = 0x1f9;
export const NOTIFY_ACTION_COMPLETED = 0x1fa;
export const NOTIFY_TARGET_INVALID = 0x1fb;
const NOTIFY_UNDER_ATTACK = 0x201;
export const NOTIFY_REQUEST_TASK = 0x202;
const NOTIFY_KILLED = 0x209;
/** The owner notifications `TRIBE_Player::notify` turns into the game's: unload space, landing, trade (`transport.ts`). */
const NOTIFY_NO_ROOM = 0x206;
const NOTIFY_NOT_CLOSE = 0x207;
const NOTIFY_TRADE_REFUSED = 0x20c;
/** The object changed hands (`change_ownership`'s notify to itself, src/t_c_obj.cpp:284). */
export const NOTIFY_OWNER_CHANGED = 0x20b;
const NOTIFY_STOPPED_WORKING = 0x2bb;

/**
 * `TribeCivilianUnitAIModule::convertToLOSResourceType` (src/taiuaimd.cpp:546): an object group's visible-resource list
 * (forage 1, gold 4, stone 3, trees 0, the fish groups 2), -1 for any other group.
 */
const LOS_RESOURCE_TYPE = new Map([
  [7, 1],
  [0x20, 4],
  [8, 3],
  [0x0f, 0],
  [5, 2],
  [0x1f, 2],
  [0x21, 2],
]);

/** `g_unit_ai_resource_los_adjustment` (src/game_globals.cpp:202). */
const RESOURCE_LOS_ADJUSTMENT = f32(-5);

/** `processIdle` / `processNotify` results. */
const IDLE_NOTHING = 5;
const IDLE_TASKED = 6;
const NOTE_DONE = 2;
const NOTE_STOP = 3;
const NOTE_DIED = 4;
/** A note that gave the unit a new task (the trade ship's request, src/taiuaimd.cpp:1241). */
const NOTE_TASKED = 6;

/** `MASTER_OBJECT_DOCK_1`: the only Dock a trade ship looks for (src/taiuaimd.cpp:1238-1239). */
const DOCK = 45;

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
export const GROUP_BUILDING = 3;
const GROUP_CIVILIAN = 4;
const GROUP_HUNTED_ANIMAL = 9;
const GROUP_PREDATOR = 10;
const GROUP_TREE = 15;
export const GROUP_WALL = 27;
const SCOUT = 299;
const CATAPULTS = [35, 36];
const TOWERS = [79, 199, 69, 278, 383, 380];
/** Towers a unit keeps attacking when hit (`processNotify`, src/aiuaimod.cpp:2846-2848). */
const SWITCH_EXEMPT_TOWERS = [79, 199, 69];
/** Groups that never answer `askForHelp`. */
const NO_HELP_GROUPS = [1, 3, 4, 21, 18, 20, 27];
/** `g_ai_evasive_distance_scale` (src/game_globals.cpp:368). */
const EVASIVE_DISTANCE_SCALE = 3;
const NO_AI_GROUPS = [5, 7, 8, 11, 14, 15, 16, 29, 30, 31, 32, 33];

/** Important-object groups per class, in scan order (unit-ai.md §3.2). */
const SOLDIER_GROUPS = [0, 3, 4, 26, 24, 6, 35, 25, 17, 12, 23, 36, 28, 18, 13, 27, 22, 20, 2, 21, 39];
const IMPORTANT: Partial<Record<number, readonly number[]>> = {
  [AiClass.Soldier]: SOLDIER_GROUPS,
  [AiClass.Tower]: SOLDIER_GROUPS,
  [AiClass.Building]: SOLDIER_GROUPS,
  [AiClass.Civilian]: [3, 7, 8, 9, 10, 15, 17, 18, 32, 33, 27],
  // `TribeFishingShipUnitAIModule` (src/taiuaimd.cpp:1510-1524): buildings, the boats, fish (5) and the groups 31, 33.
  [AiClass.FishingShip]: [3, 22, 20, 2, 21, 5, 31, 33],
  [AiClass.Priest]: [3, 0, 4, 26, 24, 6, 25, 17, 10, 12, 35, 23, 36, 28, 18, 13, 39],
  [AiClass.Hunted]: [0, 4, 26, 24, 6, 25, 17, 10, 12, 35, 23, 36, 28, 18, 13, 39],
  [AiClass.Predator]: [29, 9, 0, 4, 26, 24, 6, 25, 17, 13, 12, 35, 23, 36, 28, 18, 39],
  [AiClass.Lion]: [29, 9, 0, 4, 26, 24, 6, 25, 17, 13, 12, 35, 23, 36, 28, 18, 39],
  // `TribeArtifactUnitAIModule` (src/taiuaimd.cpp:1902-1927): units and boats, no buildings or walls.
  [AiClass.Artifact]: [0, 4, 26, 24, 6, 35, 25, 17, 12, 23, 36, 28, 18, 13, 22, 20, 2, 21, 39],
};

/**
 * The visible-unit distance `d[dy][dx]` (unit-ai.md §3.2): the smallest LOS radius whose fog-of-war shape
 * (`NormalLOS`, src/visible.cpp:11-136, ref aoe1-decomp@6d6d8b1) contains the cell; 99 beyond radius 16.
 */
export const VISIBLE_DISTANCE: readonly (readonly number[])[] = [
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
  /** `currentTargetTypeValue` / `lastTargetTypeValue`: the target's object group, -1 none. */
  targetType: number;
  lastTargetType: number;
  /** `desiredTargetDistance`. */
  desiredDistance: number;
  /** `defendTargetValue`: the object a DEFEND order guards, -1 for a position or none. */
  defendTarget: number;
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
    targetType: -1,
    lastTargetType: -1,
    desiredDistance: f32(2),
    defendTarget: -1,
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
    case ACTION_REPAIR:
      return [AI_ORDER_REPAIR, AI_ACTION_REPAIR];
    case ACTION_CONVERT:
      return [AI_ORDER_CONVERT, AI_ACTION_CONVERT];
    case ACTION_ENTER:
      return [AI_ORDER_ENTER, AI_ACTION_ENTER];
    case ACTION_TRANSPORT:
      return [AI_ORDER_TRANSPORT, AI_ACTION_TRANSPORT];
    case ACTION_TRADE:
      return [AI_ORDER_TRADE, AI_ACTION_TRADE];
    case ACTION_HEAL:
      return [AI_ORDER_HEAL, AI_ACTION_HEAL];
    default:
      return [-1, -1];
  }
}

/** `setCurrentAction`, `setCurrentOrder`, `setCurrentTarget` (`type` the target's object group, -1 none). */
export function setAiState(e: Entity, order: number, action: number, target: number, type: number, x: number, y: number, z: number): void {
  const ai = e.ai;
  if (!ai) return;
  ai.order = order;
  setAction(ai, action);
  setTarget(ai, target, type, x, y, z);
}

/** `setCurrentAction(action)` then `setCurrentTarget(target, -1, -1, -1, -1)`, the order kept (a building's train or research). */
export function setAiAction(e: Entity, action: number, target: number): void {
  const ai = e.ai;
  if (!ai) return;
  setAction(ai, action);
  setTarget(ai, target, -1, -1, -1, -1);
}

function setAction(ai: UnitAI, action: number): void {
  ai.lastAction = ai.action;
  ai.action = action;
}

/**
 * `setCurrentTarget(o, t, x, y, z)`. The original's `setCurrentTarget(o, x, y, z)` is this with `t` the object's group
 * when `o` exists, else the type kept (src/aiuaimod.cpp:2332-2354).
 */
function setTarget(ai: UnitAI, id: number, type: number, x: number, y: number, z: number): void {
  ai.lastTarget = ai.target;
  ai.lastTargetType = ai.targetType;
  ai.target = id;
  ai.targetType = type;
  ai.targetX = f32(x);
  ai.targetY = f32(y);
  ai.targetZ = f32(z);
}

function removeCurrentTarget(ai: UnitAI): void {
  ai.lastTarget = ai.target;
  ai.lastTargetType = ai.targetType;
  ai.target = -1;
  ai.targetType = -1;
  ai.targetX = f32(-1);
  ai.targetY = f32(-1);
  ai.targetZ = f32(-1);
}

/** The object has a game action at the top of its list (`have_action`). */
export function hasAction(e: Entity): boolean {
  return !!(e.work || e.attack || e.mover?.action || e.research || e.make);
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
  // The transport's and trade's refusals go on to the game's notification (src/tplayer.cpp:1765-1774).
  if (type === NOTIFY_TRADE_REFUSED && p1 === AI_ACTION_TRADE) ctx.notify(NOTIFY_CANNOT_TRADE_WITH_ENEMY, player);
  else if (type === NOTIFY_NOT_CLOSE) ctx.notify(NOTIFY_NOT_CLOSE_ENOUGH_TO_LAND, player);
  else if (type === NOTIFY_NO_ROOM) ctx.notify(NOTIFY_NOT_ENOUGH_UNLOAD_SPACE, player);
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

  // `processMisc` (:563): the artifact's runs its idle check on every update (src/taiuaimd.cpp:2145-2162); the civilian's
  // and the priest's do nothing for a human player (src/taiuaimd.cpp:875, :1176); every other class runs the base one.
  if (ai.kind === AiClass.Artifact) {
    if (artifactIdle(ctx, e) === IDLE_TASKED) {
      removeCurrentTarget(ai);
      stopObject(ctx, e, true);
      ai.idleTimer = 0;
    }
  } else if (ai.kind !== AiClass.Civilian && ai.kind !== AiClass.Priest) processMisc(ctx, e);

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
 * `canPath(targetID, range)` (src/move_obj.cpp:1468): no when the target's tile is in another zone of the unit's zone
 * map and no tile of the unit's zone lies within `range` of it (`withinRange`, naval.md §2.2); else a tile path search
 * towards the target's tile.
 */
function canPath(ctx: GameContext, e: Entity, target: Entity, range: number): boolean {
  return canPathTo(ctx, e, toInt(target.x), toInt(target.y), range, target.id);
}

/** `canPath(point, range)` (src/move_obj.cpp): the same towards tile (gx, gy), `targetId` -1 for a point. */
function canPathTo(ctx: GameContext, e: Entity, gx: number, gy: number, range: number, targetId: number): boolean {
  if (!e.mover) return false;
  const t = typeOf(ctx, e);
  const sx = toInt(e.x);
  const sy = toInt(e.y);
  const zones = ctx.pathing.zones.of(t);
  const w = ctx.map.width;
  if (zones.at(w, gx, gy) !== zones.at(w, sx, sy) && !zones.withinRange(sx, sy, gx, gy, range)) return false;
  return ctx.pathing.findTilePath(e, t, sx, sy, gx, gy, range, targetId).found;
}

/** `canAttackUnit`: a priest's is `canConvert`. */
function canAttackUnit(ctx: GameContext, e: Entity, target: Entity): boolean {
  const ai = e.ai!;
  if (ai.kind === AiClass.Priest) return canConvert(ctx, e, target);
  if (ai.kind === AiClass.Soldier || ai.kind === AiClass.Civilian || ai.kind === AiClass.Tower) return typeOf(ctx, target).group !== GROUP_ARTIFACT;
  return true;
}

/**
 * `canAttackUnitAtNeutrality` (diplomacy.md §2): civilians never attack a neutral player's objects (src/taiuaimd.cpp:533);
 * soldiers leave its buildings, walls, civilians and fishing, trade and transport boats alone (:1681); towers the same
 * but transport boats (:2203); the rest attack anything (src/aiuaimod.cpp:1728).
 */
function canAttackUnitAtNeutrality(ai: UnitAI, group: number): boolean {
  if (ai.kind === AiClass.Civilian) return false;
  if (ai.kind === AiClass.Soldier) return ![3, 27, 4, 21, 2, 20].includes(group);
  if (ai.kind === AiClass.Tower) return ![3, 27, 4, 21, 2].includes(group);
  return true;
}

/**
 * `TribePriestUnitAIModule::canConvert` (src/taiuaimd.cpp:922-953): with full faith, any object but Town_Center1, a wall,
 * an artifact, the ruins, the Wonder or a flag; a priest only with the owner's Monotheism (attribute 27), a building only
 * with attribute 28.
 */
function canConvert(ctx: GameContext, e: Entity, target: Entity): boolean {
  if (!(e.heldAmount >= FAITH_MAX)) return false;
  const tt = typeOf(ctx, target);
  if (tt.id === 109 || tt.group === GROUP_WALL || tt.id === 159 || tt.id === 276 || tt.id === 158 || tt.id === 163 || tt.group === 30) return false;
  const attributes = ctx.attributes[e.owner]!;
  if (tt.group === GROUP_PRIEST && attributes[27]! <= 0) return false;
  if (tt.group === GROUP_BUILDING && attributes[28]! <= 0) return false;
  return true;
}

/** `attackObject` (src/aiuaimod.cpp:1752); a priest's converts (`TribePriestUnitAIModule::attackObject`, src/taiuaimd.cpp:904). */
export function attackObject(ctx: GameContext, e: Entity, targetId: number, unconditional: boolean): boolean {
  const ai = e.ai!;
  if (ai.kind === AiClass.Priest) {
    // A computer player's priest walks into range instead; humans only.
    const target = ctx.entities.get(targetId);
    return !!target && canConvert(ctx, e, target) && priestObject(ctx, e, targetId, ACTION_CONVERT, unconditional);
  }
  if (ai.kind === AiClass.Civilian) {
    // `TribeCivilianUnitAIModule::attackObject` (src/taiuaimd.cpp:513): hunted animals, predators and trees are hunted, not fought.
    const target = ctx.entities.get(targetId);
    if (!target) return false;
    const group = typeOf(ctx, target).group;
    if (group === GROUP_HUNTED_ANIMAL || group === GROUP_PREDATOR || group === GROUP_TREE) return huntObject(ctx, e, targetId, unconditional);
  }
  if (!unconditional && ai.action !== -1) return false;
  const target = ctx.entities.get(targetId);
  if (!target || !canAttackUnit(ctx, e, target)) return false;
  if (!combatAttack(ctx, e, target, unconditional)) return false;
  // `attack` may have transformed a villager; the AI record travels with the object.
  setAction(e.ai!, AI_ACTION_ATTACK);
  setTarget(e.ai!, targetId, typeOf(ctx, target).group, target.x, target.y, target.z);
  return true;
}

/**
 * `RGE_Combat_Object::moveTo(x, y, z, range)` (src/com_obj.cpp:648): the current gather/hunt/build action takes the walk
 * when it can; otherwise a fresh move replaces every action.
 */
export function objectMoveTo(ctx: GameContext, e: Entity, x: number, y: number, z: number, range: number, unconditional: boolean): boolean {
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
  setTarget(ai, -1, ai.targetType, x, y, z);
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
  /** The record's player (`VisibleUnitList[..].player`), the owner when the record was made or last changed hands. */
  owner: number;
  distance: number;
}

/**
 * `search` / `GetVisibleUnits` (unit-ai.md §3.2, visibility.md §4.2) around the unit's tile with radius (int) LOS (doubled
 * for the builder, clamped to 15): the searching player's visible-unit records of each important group, in group order
 * and list order, each at the tile and owner it had when the player started seeing it, bucketed by the searching
 * player's `unitDiplomacy` (diplomacy.md §2: 0 Gaia, 1 self, 2 ally, 3 neutral, 4 enemy), at most 256 a bucket.
 */
function search(ctx: GameContext, e: Entity): Seen[][] {
  const buckets: Seen[][] = [[], [], [], [], []];
  const ai = e.ai!;
  const groups = IMPORTANT[ai.kind];
  const v = ctx.visibility;
  if (!groups || !v || e.owner >= v.players) return buckets;
  // A unit on a DEFEND order of an object with a unit AI looks from that object, with its sight and its owner's records
  // (src/aiuaimod.cpp:1127-1138).
  const guarded = ai.order === AI_ORDER_DEFEND && ai.defendTarget !== -1 ? ctx.entities.get(ai.defendTarget) : undefined;
  const from = guarded?.ai && guarded.owner < v.players ? guarded : e;
  const t = typeOf(ctx, from);
  let radius = toInt(t.los);
  if (from === e && t.id === 118) radius += radius;
  if (radius > 15) radius = 15;
  const cx = toInt(from.x);
  const cy = toInt(from.y);
  for (const group of groups) {
    for (const r of v.recordsOf(from.owner, group)) {
      if (r.x > cx + radius || r.x < cx - radius || r.y > cy + radius || r.y < cy - radius) continue;
      const d = VISIBLE_DISTANCE[Math.abs(r.y - cy) & 15]![Math.abs(r.x - cx) & 15]!;
      if (d > radius) continue;
      const list = buckets[unitDiplomacy(ctx, e.owner, r.owner)]!;
      if (list.length >= 0x100) continue;
      list.push({ id: r.id, owner: r.owner, distance: d });
    }
  }
  return buckets;
}

/** `visibleStatus(...) == 0x0F` at the object's tile for `player` (src/aiuaimod.cpp:2408). */
function tileVisible(ctx: GameContext, player: number, o: Entity): boolean {
  return !ctx.visibility || ctx.visibility.get(player, toInt(o.x), toInt(o.y)) === TILE_VISIBLE;
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
 * with no single-player difficulty: the enemy, neutral and ally buckets, skipping the objects of any player the
 * searcher's owner calls an ally, itself included (`isAlly`, :1248, :1304, :1357), and any object aboard a transport
 * (`inside_obj`, :1248, :1357). Returns an object id or -1.
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
    if (isAlly(ctx, e.owner, o.owner) || o.inside != null) return false;
    const g = typeOf(ctx, o).group;
    if (!(allowWalls && wallOk) && g === GROUP_WALL) return false;
    if (g === GROUP_BUILDING && o.hp <= 1 && CATAPULTS.includes(t.id)) return false;
    if (!canAttackUnit(ctx, e, o)) return false;
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
    // With other candidates, the current target must stand on a tile the unit's player sees and be in reach
    // (src/aiuaimod.cpp:1289-1300).
    const blocked =
      nonCurrent !== 0 &&
      (!tileVisible(ctx, e.owner, current) || (!inAttackRange(ctx, e, current) && !canPath(ctx, e, current, weaponRange(ctx, e))));
    if (!blocked && current.state === ObjectState.Active && !isAlly(ctx, e.owner, current.owner)) {
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
    case AiClass.Hunted:
      return huntedIdle(ctx, e);
    case AiClass.Lion:
      return lionIdle(ctx, e);
    case AiClass.Artifact:
      return artifactIdle(ctx, e);
    default:
      // Civilians, buildings, priests and ships do nothing for a human; the elephant never acts when idle.
      return IDLE_NOTHING;
  }
}

/**
 * `closestObject(group, -1, state, type)` (src/aiuaimod.cpp:1506, unit-ai.md §5.1): over the search results, buckets
 * Gaia to enemy, the first record with the smallest visible-unit distance whose object is not itself, not yet pending
 * removal, and of that group, state and master (-1 any).
 */
function closestObject(ctx: GameContext, e: Entity, group = -1, state = -1, type = -1, relation = -1): number {
  return closestObjectAndPlayers(ctx, e, group, state, type, relation)[0];
}

/**
 * `closestObject` over players' objects only, Gaia's skipped: what a gazelle runs from and a lion attacks. The original
 * takes Gaia's too (a lion hunts gazelles, a gazelle runs from an elephant); the captain's decision of 2026-11-16 keeps
 * the animals still until a player's unit comes near (unit-ai.md §5).
 */
function closestPlayerObject(ctx: GameContext, e: Entity): number {
  return closestObjectAndPlayers(ctx, e, -1, -1, -1, -1, true)[0];
}

/** `desiredRelation` of `closestObject` (src/aiuaimod.cpp:1527-1530): 0 self or ally, 1 neutral, 2 enemy, 3 self, else any bucket. */
function relationBucket(relation: number, bucket: number): boolean {
  if (relation === 0) return bucket === UNIT_DIPLOMACY_ALLY || bucket === UNIT_DIPLOMACY_SELF;
  if (relation === 1) return bucket === UNIT_DIPLOMACY_NEUTRAL;
  if (relation === 2) return bucket === UNIT_DIPLOMACY_ENEMY;
  if (relation === 3) return bucket === UNIT_DIPLOMACY_SELF;
  return true;
}

/**
 * `closestObject` with `numberDifferentPlayerObjectsVisible` (src/aiuaimod.cpp:1524-1549): how many players 1-8 own a
 * record in any bucket, whatever the filters (the object's own record included).
 */
function closestObjectAndPlayers(ctx: GameContext, e: Entity, group = -1, state = -1, type = -1, relation = -1, playersOnly = false): [number, number] {
  const buckets = search(ctx, e);
  let closestId = -1;
  let closest = -1;
  const players = new Set<number>();
  for (const [b, bucket] of buckets.entries()) {
    for (const r of bucket) {
      if (r.owner >= 1 && r.owner < 9) players.add(r.owner);
      if (r.id === e.id || !relationBucket(relation, b) || (playersOnly && r.owner === 0)) continue;
      const o = ctx.entities.get(r.id);
      if (!o || o.state >= ObjectState.PendingRemoval) continue;
      if ((group !== -1 && typeOf(ctx, o).group !== group) || (type !== -1 && o.type !== type) || (state !== -1 && o.state !== state)) continue;
      if (closestId === -1 || r.distance < closest) {
        closestId = r.id;
        closest = r.distance;
      }
    }
  }
  return [closestId, players.size];
}

/** `closestAttacker` (src/aiuaimod.cpp:1475): the recorded attacker nearest by `distance_to_object`, first on a tie. */
function closestAttacker(ctx: GameContext, e: Entity): number {
  let closestId = -1;
  let closest = 0;
  for (const id of e.ai!.attackers) {
    const a = ctx.entities.get(id);
    if (!a) continue;
    const d = distanceToObject(ctx, e, a);
    if (closestId === -1 || d < closest) {
      closestId = id;
      closest = d;
    }
  }
  return closestId;
}

/**
 * `TribeArtifactUnitAIModule::processIdle` (src/taiuaimd.cpp:2128-2143): when the closest important object in the
 * owner's view is someone else's and at most one player (Gaia aside) has objects in view, the artifact becomes that
 * object's owner's. So a relic or ruin goes to the only player near it, stays while two players are, and Gaia never
 * takes it back.
 */
function artifactIdle(ctx: GameContext, e: Entity): number {
  const [id, players] = closestObjectAndPlayers(ctx, e);
  if (players > 1 || id === -1) return IDLE_NOTHING;
  const target = ctx.entities.get(id);
  if (!target || target.owner === e.owner) return IDLE_NOTHING;
  ctx.changeOwnership(e, target.owner);
  return IDLE_TASKED;
}

/** `TribeHuntedAnimalUnitAIModule::processIdle` (src/taiuaimd.cpp:89): run 3 × maximum speed away from the closest object. */
function huntedIdle(ctx: GameContext, e: Entity): number {
  const target = ctx.entities.get(closestPlayerObject(ctx, e));
  if (!target) return IDLE_NOTHING;
  const distance = mul32(maximumSpeed(e, typeOf(ctx, e)), EVASIVE_DISTANCE_SCALE);
  const dx = sub32(target.x, e.x);
  const dy = sub32(target.y, e.y);
  const length = sqrt32(add32(mul32(dx, dx), mul32(dy, dy)));
  const x = add32(-mul32(div32(dx, length), distance), e.x);
  const y = add32(-mul32(div32(dy, length), distance), e.y);
  evasiveMoveTo(ctx, e, x, y, e.z);
  return IDLE_TASKED;
}

/**
 * `TribeLionUnitAIModule::processIdle` (src/taiuaimd.cpp:320, unit-ai.md §5.3): a new 6 s timeout (one draw), then attack
 * the closest object within 2 × LOS (the multiplayer branch).
 */
function lionIdle(ctx: GameContext, e: Entity): number {
  const ai = e.ai!;
  ai.idleTimeout = 6000;
  adjustIdleTimeout(ctx, ai);
  const id = closestPlayerObject(ctx, e);
  const target = ctx.entities.get(id);
  if (!target) return IDLE_NOTHING;
  if (distanceToObject(ctx, e, target) > mul32(typeOf(ctx, e).los, 2)) return IDLE_NOTHING;
  attackObject(ctx, e, id, false);
  return IDLE_TASKED;
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
      return baseNotify(ctx, e, note);
    case AiClass.Priest:
      return priestNotify(ctx, e, note);
    case AiClass.Civilian:
      return civilianNotify(ctx, e, note);
    case AiClass.Building:
      return buildingNotify(ctx, e, note);
    case AiClass.Hunted:
    case AiClass.Elephant:
      return animalNotify(ctx, e, note);
    case AiClass.Lion:
      return lionNotify(ctx, e, note);
    case AiClass.FishingShip:
      return fishingShipNotify(ctx, e, note);
    case AiClass.TransportShip:
      return transportShipNotify(ctx, e, note);
    case AiClass.TradeShip:
      return tradeShipNotify(ctx, e, note);
    default:
      // The artifact reactions are not ported.
      return NOTE_DONE;
  }
}

/**
 * `TribeFishingShipUnitAIModule::processNotify` (src/taiuaimd.cpp:1539-1616, naval.md §5.2): when hit, the alert on the
 * first attacker and a help call for a new one, the attacker recorded; a human player's boat with an order keeps it;
 * otherwise, unless it is already moving, its order is queued again and it stops, then it runs from its attackers. Every
 * other note takes the base path.
 */
function fishingShipNotify(ctx: GameContext, e: Entity, note: Note): number {
  const ai = e.ai!;
  if (note.type !== NOTIFY_ATTACKED) return baseNotify(ctx, e, note);
  if (note.p2 <= 0) {
    playerNotify(ctx, e.owner, NOTIFY_KILLED, note.caller);
    ai.notes = [];
    return NOTE_DIED;
  }
  alertAndAskForHelp(ctx, e, note);
  if (ai.order !== -1) return NOTE_DONE;
  if (ai.action !== AI_ACTION_MOVE) {
    aiOrder(ctx, e, e.id, ai.order, ai.target, -1, ai.targetX, ai.targetY, ai.targetZ, ai.desiredDistance, false, false, ai.priority);
    stopObject(ctx, e, true);
  }
  runAwayFromAttackers(ctx, e);
  return NOTE_STOP;
}

/**
 * `TribeTradeShipUnitAIModule::processNotify` (src/taiuaimd.cpp:1232-1376, support-actions.md §7.5): when hit, the
 * fishing ship's reaction (the same code). A task request while trading looks for the closest Dock in its search results,
 * its owner's or an ally's first, then a neutral's, and trades with it; failing that, or when not trading, it stops. The
 * explore branch is for computer players' boats. Every other note takes the base path.
 */
function tradeShipNotify(ctx: GameContext, e: Entity, note: Note): number {
  const ai = e.ai!;
  if (note.type === NOTIFY_ATTACKED) return fishingShipNotify(ctx, e, note);
  if (note.type !== NOTIFY_REQUEST_TASK) return baseNotify(ctx, e, note);
  if (ai.action === AI_ACTION_TRADE) {
    for (const relation of [0, 1]) {
      const id = closestObject(ctx, e, -1, ObjectState.Active, DOCK, relation);
      if (id !== -1 && tradeWithObject(ctx, e, id)) return NOTE_TASKED;
    }
  }
  removeCurrentTarget(ai);
  stopObject(ctx, e, true);
  return NOTE_DONE;
}

/** `UnitAIModule::tradeWithObject(id, 1)` (src/aiuaimod.cpp:1921-1943): the unit's `trade`, then the action and target recorded. */
function tradeWithObject(ctx: GameContext, e: Entity, targetId: number): boolean {
  const target = ctx.entities.get(targetId);
  if (!target || !aiTrade(ctx, e, target, true)) return false;
  setAction(e.ai!, AI_ACTION_TRADE);
  setTarget(e.ai!, targetId, typeOf(ctx, target).group, target.x, target.y, target.z);
  return true;
}

/**
 * `TribeTransportShipUnitAIModule::processNotify` (src/taiuaimd.cpp:1416-1480, naval.md §7.7): when hit, the alert on the
 * first attacker and a help call for a new one, the attacker recorded; with an order it keeps it; with no action, or an
 * idle top action (state 2), it runs from its attackers. Every other note takes the base path.
 */
function transportShipNotify(ctx: GameContext, e: Entity, note: Note): number {
  const ai = e.ai!;
  if (note.type !== NOTIFY_ATTACKED) return baseNotify(ctx, e, note);
  if (note.p2 <= 0) {
    playerNotify(ctx, e.owner, NOTIFY_KILLED, note.caller);
    ai.notes = [];
    return NOTE_DIED;
  }
  alertAndAskForHelp(ctx, e, note);
  if (ai.order !== -1) return NOTE_DONE;
  const top = e.work ?? e.attack ?? e.mover?.action ?? null;
  if (!top || top.state === 2) runAwayFromAttackers(ctx, e);
  return NOTE_STOP;
}

/**
 * `TribeHuntedAnimalUnitAIModule::processNotify` and `TribeElephantUnitAIModule::processNotify` (src/taiuaimd.cpp:39, :180;
 * unit-ai.md §5.1, §5.2): when hit, record the attacker without an alert or a help call, then a hunted animal runs from
 * every attacker and an elephant attacks the closest one. Every other note takes the base path.
 */
function animalNotify(ctx: GameContext, e: Entity, note: Note): number {
  const ai = e.ai!;
  if (note.type !== NOTIFY_ATTACKED) return baseNotify(ctx, e, note);
  if (note.p2 <= 0) {
    ai.notes = [];
    return NOTE_DIED;
  }
  recordAttacker(ai, note.caller);
  if (ai.kind === AiClass.Hunted) runAwayFromAttackers(ctx, e);
  else attackObject(ctx, e, closestAttacker(ctx, e), false);
  return NOTE_STOP;
}

/**
 * `TribeLionUnitAIModule::processNotify` (src/taiuaimd.cpp:263, unit-ai.md §5.3): after its own attack completes, rest 25 s
 * (the multiplayer timeout, one draw) and stop; then, as for every note, the base reaction. The 0x1FC branch is not
 * ported: the sim's move action never sends 0x1FC.
 */
function lionNotify(ctx: GameContext, e: Entity, note: Note): number {
  const ai = e.ai!;
  if (note.type === NOTIFY_ACTION_COMPLETED && note.p1 === AI_ACTION_ATTACK) {
    ai.idleTimeout = 25000;
    adjustIdleTimeout(ctx, ai);
    removeCurrentTarget(ai);
    stopObject(ctx, e, true);
  }
  return baseNotify(ctx, e, note);
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
          if (!canAttackUnit(ctx, e, attacker) || (!inAttackRange(ctx, e, attacker) && !canPath(ctx, e, attacker, weaponRange(ctx, e)))) {
            runAwayFromAttackers(ctx, e);
            return NOTE_STOP;
          }
          attackObject(ctx, e, note.caller, true);
          return NOTE_STOP;
        }
        // A human unit keeps a unit (or tower) target; the kill-time comparison is for computer players.
        return NOTE_DONE;
      }
      if (canAttackUnit(ctx, e, attacker) && (inAttackRange(ctx, e, attacker) || canPath(ctx, e, attacker, weaponRange(ctx, e)))) {
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
        return NOTE_DONE;
      }
      // A unit standing its ground drops an attack that ended, or failed out of range, and stays (`:3005`, `:3088`, `:3170`).
      if (ai.order === AI_ORDER_STAND_GROUND && note.p1 === AI_ACTION_ATTACK) {
        removeCurrentTarget(ai);
        stopObject(ctx, e, true);
      }
      return NOTE_DONE;
    }
    case NOTIFY_STOPPED_WORKING: {
      const i = ai.attackers.indexOf(note.caller);
      if (i !== -1) ai.attackers.splice(i, 1);
      return NOTE_DONE;
    }
    case NOTIFY_OWNER_CHANGED:
      // A converted object stops everything and forgets its notes and orders (src/aiuaimod.cpp:3302-3318); no groups.
      deleteActions(ctx, e);
      newSprite(ctx, e, null);
      removeCurrentTarget(ai);
      stopObject(ctx, e, true);
      purgeNotes(ctx, e);
      ai.orders = [];
      return NOTE_DONE;
    default:
      return NOTE_DONE;
  }
}

/**
 * `purgeNotifyQueue` (src/aiuaimod.cpp:3871-3900): a queued completion of the current action the unit runs without an
 * order (a move only when it is the current action) drops the target and stops it; then the queue is emptied.
 */
export function purgeNotes(ctx: GameContext, e: Entity): void {
  const ai = e.ai!;
  for (const n of ai.notes) {
    if (n.type !== NOTIFY_ACTION_COMPLETED) continue;
    if (n.p1 !== AI_ACTION_MOVE || ai.action === n.p1 || ai.action === 0x268) {
      if (ai.order === -1 && ai.action === n.p1) {
        removeCurrentTarget(ai);
        stopObject(ctx, e, true);
        break;
      }
    }
  }
  ai.notes = [];
}

/**
 * `TribePriestUnitAIModule::processNotify` (src/taiuaimd.cpp:1058-1128) for a human owner: a failed, invalid or idle
 * convert ends (`stopObject(1)`); a heal that ends looks for the next unit to heal in reach (`bestUnitToHeal(0)`); anything
 * else of the three stops the priest (`stopObject(0)`). The owner hears each (`notifyCommander`). Every other note takes the
 * base path; the 0x1FC branch is not ported (the sim's move action never sends 0x1FC).
 */
function priestNotify(ctx: GameContext, e: Entity, note: Note): number {
  const ai = e.ai!;
  if (note.type !== NOTIFY_ACTION_FAILED && note.type !== NOTIFY_TARGET_INVALID && note.type !== NOTIFY_REQUEST_TASK) return baseNotify(ctx, e, note);
  if (ai.action === AI_ACTION_CONVERT) {
    removeCurrentTarget(ai);
    stopObject(ctx, e, true);
    playerNotify(ctx, e.owner, note.type, note.p1);
    return NOTE_DONE;
  }
  if (ai.action === AI_ACTION_HEAL) {
    const id = bestUnitToHeal(ctx, e, false);
    if (id !== -1 && priestObject(ctx, e, id, ACTION_HEAL, true)) return NOTE_STOP;
  }
  removeCurrentTarget(ai);
  stopObject(ctx, e, false);
  playerNotify(ctx, e.owner, note.type, note.p1);
  return NOTE_DONE;
}

/**
 * `TribePriestUnitAIModule::bestUnitToHeal(idleHeal)` (src/taiuaimd.cpp:962-1016): over its own and then its allies'
 * search results (Gaia's priest: up to the enemy bucket), the first bucket with a living unit short of hit points it can
 * path to, not itself and not a building, within visible distance 4 (any with `idleHeal`; 2 for Gaia's), gives the one of
 * smallest `max hp - hp / distance` (the decomp's precedence).
 */
function bestUnitToHeal(ctx: GameContext, e: Entity, idleHeal: boolean): number {
  const buckets = search(ctx, e);
  const maxLimit = e.owner === 0 ? 4 : 2;
  let best = -1;
  let bestNeed = 0;
  for (let b = 1; b <= maxLimit; b++) {
    for (const r of buckets[b]!) {
      if (r.id === e.id) continue;
      const o = ctx.entities.get(r.id);
      if (!o) continue;
      const ot = typeOf(ctx, o);
      if (ot.group === GROUP_BUILDING || !(f32(Math.trunc(ot.hitPoints)) > o.hp) || o.state >= ObjectState.Dying) continue;
      if (!idleHeal && r.distance > 4) continue;
      if (e.owner === 0 && r.distance > 2) continue;
      if (!canPath(ctx, e, o, f32(1))) continue;
      const need = sub32(f32(Math.trunc(ot.hitPoints)), div32(o.hp, f32(r.distance)));
      if (best === -1 || need < bestNeed) {
        bestNeed = need;
        best = o.id;
      }
    }
    if (best !== -1) return best;
  }
  return -1;
}

/**
 * `UnitAIModule::convertObject` / `healObject` (src/aiuaimod.cpp:1821-1858): the unit's `convert` or `heal` on the target,
 * then the action and target recorded. A non-unconditional call does nothing while it already does that.
 */
function priestObject(ctx: GameContext, e: Entity, targetId: number, type: number, unconditional: boolean): boolean {
  const ai = e.ai!;
  const action = type === ACTION_CONVERT ? AI_ACTION_CONVERT : AI_ACTION_HEAL;
  if (!unconditional && ai.action === action) return false;
  const target = ctx.entities.get(targetId);
  if (!target || !aiPriestAction(ctx, e, type, target, unconditional)) return false;
  setAction(ai, action);
  setTarget(ai, targetId, typeOf(ctx, target).group, target.x, target.y, target.z);
  return true;
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
    case NOTIFY_TARGET_INVALID:
    case NOTIFY_REQUEST_TASK:
      return civilianRetask(ctx, e, note);
    case NOTIFY_OWNER_CHANGED:
      // The class's `default` is the base path (src/taiuaimd.cpp:866); of the notes it can take only this one is ported there.
      return baseNotify(ctx, e, note);
    default:
      return NOTE_DONE;
  }
}

/**
 * `closestResourceObject(resourceType)` (src/aiuaimod.cpp:1556-1590, unit-ai.md §3.4): the closest record of the owner's
 * visible-resource list from the unit's tile; none when it lies farther than the unit's line of sight + 5. A record the
 * unit cannot path to within 1 is excluded and the search runs again, at most 100 times; after the 100th the last
 * excluded one is returned (the loop's literal end).
 */
function closestResourceObject(ctx: GameContext, e: Entity, resourceType: number): number {
  const v = ctx.visibility;
  if (!v) return -1;
  const exclude: number[] = [];
  let found: { id: number; distance: number } | null = null;
  while (exclude.length < 100) {
    found = v.closestResource(e.owner, toInt(e.x), toInt(e.y), resourceType, exclude);
    if (!found) return -1;
    if (found.distance > sub32(typeOf(ctx, e).los, RESOURCE_LOS_ADJUSTMENT)) return -1;
    const o = ctx.entities.get(found.id);
    if (o && canPath(ctx, e, o, 1)) break;
    exclude.push(found.id);
  }
  return found!.id;
}

/**
 * The civilian's target-invalid and task-request notes (src/taiuaimd.cpp:707-863, economy.md §10): a hunter or gatherer
 * takes the closest object of the group it worked (the current target's, else the last one's): from the visible-resource
 * lists for resource groups, else the closest active Farm (a Farm's request) or object of the group in its search
 * results; a waiting builder the closest own unbuilt object of the group it built, else of the other of building and
 * wall. With no new target a human player's Farmer steps 2.5 tiles off on both axes and a builder away from its target
 * walks back to the target's point. A request then waits; an invalid target ends (`action_finished`): the target goes,
 * the unit stops and the owner hears it. The computer player's branches and the explore re-task are not ported.
 */
function civilianRetask(ctx: GameContext, e: Entity, note: Note): number {
  const ai = e.ai!;
  const giveUp = (): void => {
    removeCurrentTarget(ai);
    stopObject(ctx, e, true);
    playerNotify(ctx, e.owner, note.type, note.p1);
  };
  if (ai.action === AI_ACTION_HUNT || ai.action === AI_ACTION_GATHER) {
    const hunt = ai.action === AI_ACTION_HUNT;
    const type = ai.targetType !== -1 ? ai.targetType : ai.lastTargetType;
    if (type === -1) {
      giveUp();
      return NOTE_DONE;
    }
    const farm = !hunt && note.p2 === FARM;
    const resourceType = LOS_RESOURCE_TYPE.get(type) ?? -1;
    let id: number;
    if (resourceType !== -1) id = closestResourceObject(ctx, e, resourceType);
    else if (farm) id = closestObject(ctx, e, type, ObjectState.Active, FARM);
    else id = closestObject(ctx, e, type);
    if (id !== -1) {
      if (hunt ? aiTask(ctx, e, id, ACTION_HUNT, AI_ACTION_HUNT) : aiTask(ctx, e, id, ACTION_GATHER, AI_ACTION_GATHER)) return NOTE_STOP;
      giveUp();
    } else if (farm) {
      const x = e.x > 5 ? sub32(e.x, 2.5) : add32(e.x, 2.5);
      const y = e.y > 5 ? sub32(e.y, 2.5) : add32(e.y, 2.5);
      evasiveMoveTo(ctx, e, x, y, e.z);
    }
  } else if (ai.action === AI_ACTION_BUILD) {
    let id = closestObject(ctx, e, ai.targetType, ObjectState.Unbuilt, -1, 3);
    if (id === -1) id = closestObject(ctx, e, ai.targetType === GROUP_WALL ? GROUP_BUILDING : GROUP_WALL, ObjectState.Unbuilt, -1, 3);
    const next = id === -1 ? undefined : ctx.entities.get(id);
    if (next && canPath(ctx, e, next, 1)) {
      if (aiTask(ctx, e, id, ACTION_BUILD, AI_ACTION_BUILD)) return NOTE_STOP;
    } else {
      const target = ai.target === -1 ? undefined : ctx.entities.get(ai.target);
      if (!target || distanceToObject(ctx, e, target) > 1) aiMoveTo(ctx, e, ai.targetX, ai.targetY, ai.targetZ, 1, true);
    }
  }
  if (note.type === NOTIFY_REQUEST_TASK) return NOTE_DONE;
  giveUp();
  return NOTE_DONE;
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
 * `askForHelp` (src/aiuaimod.cpp:2494, unit-ai.md §4.4): idle armed units of the owner, or of a player that calls the
 * owner an ally (src/aiuaimod.cpp:2515), within 3 tiles of the victim, among
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
      if (o.owner !== e.owner && !isAlly(ctx, o.owner, e.owner)) continue;
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
    case AI_ORDER_REPAIR:
      ok = repairObject(ctx, e, o.target, true);
      break;
    case AI_ORDER_HEAL:
      ok = priestObject(ctx, e, o.target, ACTION_HEAL, true);
      break;
    case AI_ORDER_CONVERT:
      ok = priestObject(ctx, e, o.target, ACTION_CONVERT, true);
      break;
    case AI_ORDER_DEFEND:
      ok = o.target === -1 ? defendPosition(e, o.x, o.y, o.range) : defendObject(ctx, e, o.target, o.range);
      break;
    case AI_ORDER_FOLLOW:
      ok = followObject(ctx, e, o.target, o.range);
      break;
    case AI_ORDER_ENTER:
      ok = enterObject(ctx, e, o.target);
      break;
    case AI_ORDER_TRANSPORT:
      ok = transportObject(ctx, e, o.x, o.y, o.z);
      break;
    case AI_ORDER_UNLOAD:
      ok = unloadObject(ctx, e, o.x, o.y);
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

/** `defendObject(target, range, 1)` (src/aiuaimod.cpp:2259): the DEFEND action (0x259) on an existing object. */
function defendObject(ctx: GameContext, e: Entity, targetId: number, range: number): boolean {
  const target = ctx.entities.get(targetId);
  if (!target) return false;
  const ai = e.ai!;
  setAction(ai, AI_ACTION_DEFEND);
  setTarget(ai, targetId, typeOf(ctx, target).group, target.x, target.y, target.z);
  ai.defendTarget = targetId;
  ai.desiredDistance = f32(range);
  return true;
}

/** `defendPosition(x, y, range, 1)` (src/aiuaimod.cpp:2280): the DEFEND action on a point, at the unit's own z. */
function defendPosition(e: Entity, x: number, y: number, range: number): boolean {
  const ai = e.ai!;
  setAction(ai, AI_ACTION_DEFEND);
  setTarget(ai, -1, ai.targetType, x, y, e.z);
  ai.defendTarget = -1;
  ai.desiredDistance = f32(range);
  return true;
}

/** `followObject(target, range, 1)` (src/aiuaimod.cpp:2240): the FOLLOW action (0x264) on an existing object. */
function followObject(ctx: GameContext, e: Entity, targetId: number, range: number): boolean {
  const target = ctx.entities.get(targetId);
  if (!target) return false;
  const ai = e.ai!;
  setAction(ai, AI_ACTION_FOLLOW);
  setTarget(ai, targetId, typeOf(ctx, target).group, target.x, target.y, target.z);
  ai.desiredDistance = f32(range);
  return true;
}

/**
 * `UnitAIModule::moveTo(target, range, 1)` (src/aiuaimod.cpp:2017) over `RGE_Combat_Object::moveTo` (src/com_obj.cpp:605):
 * a move to the object replaces every action, then the MOVE action and the target recorded. The original walks with
 * the master's run sprite when it has one; the sim table has only the move sprite.
 */
function aiMoveToObject(ctx: GameContext, e: Entity, target: Entity, range: number): boolean {
  if (!e.mover) return false;
  deleteActions(ctx, e);
  startMoveTo(e, target, target.x, target.y, target.z, range, null, false, ctx);
  setAction(e.ai!, AI_ACTION_MOVE);
  setTarget(e.ai!, target.id, typeOf(ctx, target).group, target.x, target.y, target.z);
  return true;
}

/** `distance_to_position` (src/stat_obj.cpp:2323): per axis the gap less the object's radius, at least 0, then the length. */
function distanceToPosition(ctx: GameContext, e: Entity, x: number, y: number): number {
  const t = typeOf(ctx, e);
  let dx = sub32(Math.abs(sub32(e.x, x)), t.radiusX);
  let dy = sub32(Math.abs(sub32(e.y, y)), t.radiusY);
  if (dx < 0) dx = 0;
  if (dy < 0) dy = 0;
  return sqrt32(add32(mul32(dx, dx), mul32(dy, dy)));
}

/** The object id the unit's top action aims at (`currentTargetID`), -1 none. */
function topActionTarget(e: Entity): number {
  if (e.attack) return e.attack.target;
  if (e.work) return e.work.target;
  return e.mover?.action?.target ?? -1;
}

/** The DEFEND or FOLLOW order ends: no defended object, no target, a stop and no order (src/aiuaimod.cpp:3530-3546). */
function endGuard(ctx: GameContext, e: Entity): void {
  const ai = e.ai!;
  ai.defendTarget = -1;
  removeCurrentTarget(ai);
  stopObject(ctx, e, true);
  ai.order = -1;
}

/**
 * The base `processMisc` (src/aiuaimod.cpp:3477-3690, unit-ai.md §4.7) for the order in force (the current order, else
 * the current action + 100). The ATTACK case is the computer player's and is not ported. DEFEND: a defended object that
 * is gone, or below active and not Gaia's, ends the order; unless attacking, or walking to the defended object, the unit
 * walks back when farther than the desired distance + 1 and it can path there; within it, it attacks the defended
 * object's closest attacker, else looks for a target (`processIdle`). FOLLOW: a followed object gone or below active
 * ends the order; once it has moved more than 1 tile on an axis from the recorded point, the point follows it and the
 * unit walks there when farther than the desired distance.
 */
function processMisc(ctx: GameContext, e: Entity): void {
  const ai = e.ai!;
  const order = ai.order !== -1 ? ai.order : ai.action !== -1 ? ai.action + 100 : -1;
  if (order === AI_ORDER_DEFEND) {
    let target: Entity | undefined;
    if (ai.defendTarget !== -1) {
      target = ctx.entities.get(ai.defendTarget);
      if (!target) return endGuard(ctx, e);
      if (ai.targetX === -1) {
        ai.targetX = target.x;
        ai.targetY = target.y;
      }
      if (target.state > ObjectState.Active && target.owner !== 0) return endGuard(ctx, e);
    }
    if (ai.action === AI_ACTION_ATTACK || (ai.action === AI_ACTION_MOVE && topActionTarget(e) === ai.defendTarget)) return;
    let distance: number;
    if (target) {
      ai.targetX = target.x;
      ai.targetY = target.y;
      ai.targetZ = target.z;
      distance = distanceToObject(ctx, e, target);
    } else distance = distanceToPosition(ctx, e, ai.targetX, ai.targetY);
    if (distance > add32(ai.desiredDistance, 1)) {
      if (target) {
        if (canPath(ctx, e, target, ai.desiredDistance)) aiMoveToObject(ctx, e, target, ai.desiredDistance);
      } else if (canPathTo(ctx, e, toInt(ai.targetX), toInt(ai.targetY), ai.desiredDistance, -1)) {
        aiMoveTo(ctx, e, ai.targetX, ai.targetY, ai.targetZ, ai.desiredDistance, true);
      }
      return;
    }
    if (target?.ai) {
      const attacker = closestAttacker(ctx, target);
      if (attacker !== -1) {
        attackObject(ctx, e, attacker, true);
        return;
      }
      processIdle(ctx, e, false);
    }
  } else if (order === AI_ORDER_FOLLOW) {
    let target: Entity | undefined;
    if (ai.target !== -1) {
      target = ctx.entities.get(ai.target);
      if (!target || target.state > ObjectState.Active) return endGuard(ctx, e);
    }
    const xDiff = target ? sub32(target.x, ai.targetX) : -10;
    const yDiff = target ? sub32(target.y, ai.targetY) : -10;
    if (xDiff >= -1 && xDiff <= 1 && yDiff >= -1 && yDiff <= 1) return;
    let distance: number;
    if (target) {
      ai.targetX = target.x;
      ai.targetY = target.y;
      ai.targetZ = target.z;
      distance = distanceToObject(ctx, e, target);
    } else distance = distanceToPosition(ctx, e, ai.targetX, ai.targetY);
    if (distance <= ai.desiredDistance) return;
    if (target) aiMoveToObject(ctx, e, target, ai.desiredDistance);
    else aiMoveTo(ctx, e, ai.targetX, ai.targetY, ai.targetZ, ai.desiredDistance, true);
  }
}

/** `repairObject` (src/aiuaimod.cpp:1884): the unit's `repair`, then the action and target recorded. */
function repairObject(ctx: GameContext, e: Entity, targetId: number, unconditional: boolean): boolean {
  const ai = e.ai!;
  if (!unconditional && ai.action === AI_ACTION_REPAIR) return false;
  const target = ctx.entities.get(targetId);
  if (!target || !aiRepair(ctx, e, target, unconditional)) return false;
  setAction(ai, AI_ACTION_REPAIR);
  setTarget(ai, targetId, typeOf(ctx, target).group, target.x, target.y, target.z);
  return true;
}

/**
 * `RGE_Player::command_stand_ground` as `do_command_group_ai_order` runs it (src/Command.cpp:628, src/player.cpp:1883):
 * an immediate STAND_GROUND order from the player, at the unit's own position, range 1, priority 100. It stops the unit,
 * which then attacks only what it can reach from where it stands.
 */
export function standGround(ctx: GameContext, e: Entity, player: number): void {
  if (!e.ai) return;
  aiOrder(ctx, e, player, AI_ORDER_STAND_GROUND, -1, -1, e.x, e.y, e.z, 1, true, false, 100);
}

/**
 * `UnitAIModule::unload(1, x, y)` (src/aiuaimod.cpp:1980): the object's `unload`, then the action (0x26D) and the
 * object itself as the target recorded.
 */
function unloadObject(ctx: GameContext, e: Entity, x: number, y: number): boolean {
  if (!unload(ctx, e, x, y)) return false;
  setAction(e.ai!, AI_ACTION_UNLOAD);
  setTarget(e.ai!, e.id, typeOf(ctx, e).group, e.x, e.y, e.z);
  return true;
}

/**
 * `UnitAIModule::enterObject(target, 1)` (src/aiuaimod.cpp:1956) over `RGE_Combat_Object::enter` (src/com_obj.cpp:767,
 * naval.md §7.2): the unit's task for the target (`getTask`, whatever its action type), a new Enter action on it in
 * place of every action, then the action (0x269) and the target recorded with the point (-1, -1, -1).
 */
function enterObject(ctx: GameContext, e: Entity, targetId: number): boolean {
  const target = ctx.entities.get(targetId);
  if (!target) return false;
  const task = getTask(ctx, e, target);
  if (task === -1) return false;
  startEnter(ctx, e, task, target);
  setAction(e.ai!, AI_ACTION_ENTER);
  setTarget(e.ai!, targetId, typeOf(ctx, target).group, -1, -1, -1);
  return true;
}

/**
 * `UnitAIModule::transportObject(x, y, z, 1)` (src/aiuaimod.cpp:1967) over `RGE_Combat_Object::transport`
 * (src/com_obj.cpp:800, naval.md §7.4): a top Transport action takes `work(none, x, y)`; otherwise a new Transport action
 * without a task replaces every action and takes `work(boat, x, y)`. Then the action (0x266) and the point recorded, the
 * target type kept.
 */
function transportObject(ctx: GameContext, e: Entity, x: number, y: number, z: number): boolean {
  if (e.work?.type === ACTION_TRANSPORT) transportWork(ctx, e, e.work, undefined, x, y);
  else transportWork(ctx, e, startTransport(ctx, e, -1, x, y), e, x, y);
  const ai = e.ai!;
  setAction(ai, AI_ACTION_TRANSPORT);
  setTarget(ai, -1, ai.targetType, x, y, z);
  return true;
}

/**
 * `TRIBE_Command::do_command_unload` (src/tcommand.cpp:513, naval.md §7.6): an immediate UNLOAD order from the owner at
 * (x, y), range 1, priority 100.
 */
export function orderUnload(ctx: GameContext, e: Entity, x: number, y: number): void {
  if (!e.ai) return;
  aiOrder(ctx, e, e.owner, AI_ORDER_UNLOAD, e.id, e.owner, x, y, 0, 1, true, false, 100);
}

/**
 * The builder's hand-over of a finished, damaged building (src/tact_bld.cpp:155-162): an immediate REPAIR order from the
 * owner on the target, range 1, priority 100.
 */
export function orderRepair(ctx: GameContext, e: Entity, target: Entity): void {
  if (!e.ai) return;
  aiOrder(ctx, e, e.owner, AI_ORDER_REPAIR, target.id, target.owner, target.x, target.y, target.z, 1, true, false, 100);
}

/**
 * `UnitAIModule::huntObject` (src/aiuaimod.cpp:1791): unless the unit is already hunting and the call is not
 * unconditional, stop, then start the hunt on the target.
 */
function huntObject(ctx: GameContext, e: Entity, targetId: number, unconditional: boolean): boolean {
  if (!unconditional && e.ai!.action === AI_ACTION_HUNT) return false;
  stopObject(ctx, e, true);
  return aiTask(ctx, e, targetId, ACTION_HUNT, AI_ACTION_HUNT);
}

/** `gatherObject` / `huntObject` / `buildObject`: start the task of that kind on the target, then record it. */
function aiTask(ctx: GameContext, e: Entity, targetId: number, kind: number, action: number): boolean {
  const target = ctx.entities.get(targetId);
  if (!target || !aiWork(ctx, e, target, kind)) return false;
  setAction(e.ai!, action);
  setTarget(e.ai!, targetId, typeOf(ctx, target).group, target.x, target.y, target.z);
  return true;
}
