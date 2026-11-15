/**
 * Attacking (docs/spec/combat.md §2-§5, sprites.md §5): the attack action (a hunt's sub-action or a unit's own), the
 * hit roll, damage to units, buildings and other objects, missiles and the attack flare. Every float store is rounded
 * to float32; trig goes through `trig.ts`.
 */
import { isBuilding } from './buildings';
import type { GameContext } from './context';
import { isAlly } from './diplomacy';
import { ObjectState, type Entity } from './entities';
import { deleteActions, transform } from './gather';
import { master, typeOf, type PlayerMasters } from './masters';
import { ActionResult, currentSprite, endAction, facetOf, maximumSpeed, startMoveTo, updateMover } from './movement';
import { add32, div32, f32, i16, mul32, sqrt32, sub32, toInt } from './num';
import { framePassed, newSprite } from './sprites';
import { atan2, cos, sin } from './trig';
import { AI_ACTION_ATTACK, AI_ORDER_STAND_GROUND, GROUP_BUILDING, GROUP_WALL, notifyObject, NOTIFY_ACTION_COMPLETED, NOTIFY_ACTION_FAILED, NOTIFY_ATTACKED, NOTIFY_TARGET_INVALID } from './unit-ai';
import { spriteInfo, type SpriteInfo, type UnitType } from './units';
import { TILE_BLACK, TILE_FOGGED } from './visibility';

/** `RGE_Action_Attack` states (combat.md §3.2). */
export const ATTACK_DONE = 1;
export const ATTACK_TARGET_LOST = 2;
export const ATTACK_MOVING = 4;
export const ATTACK_WAITING = 6;
export const ATTACK_ATTACKING = 7;
export const ATTACK_FAILED = 13;
export const ATTACK_INVALID = 14;

export interface AttackAction {
  state: number;
  target: number;
  /** Remembered target point. */
  x: number;
  y: number;
  z: number;
  range: number;
  minRange: number;
  timer: number;
  needToAttack: boolean;
  moveSprite: number;
  fightSprite: number;
  waitSprite: number;
  sub: boolean;
  /** `indirect_fire_flag`: 2 for a ground attack (commands.md §5), spent by walking; absent on an object attack (0). */
  indirect?: number;
}

/** `RGE_Action_Missile` state: 3 aim, 4 flying, 1 done. */
export interface MissileAction {
  state: number;
  target: number;
  launcher: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  timer: number;
  ballisticVelocity: number;
  ballisticAcceleration: number;
  /** `RGE_Missile_Object::max_range`. */
  maxRange: number;
}

const RANGE_SLACK = f32(-0.3);
const MISSILE_RANGE_SLACK = f32(-6);
const DEFAULT_RANGE = f32(0.4);
const TIME_SCALE = f32(0.001);
const TWO_PI_F = f32(6.2831855);
const FULL_CIRCLE = 6.2831853;
const PI_D = 3.14159265;
const INV_FULL_CIRCLE = f32(0.15915494);
const HALF = f32(0.5);
const MELEE_LOW = f32(0.6666);
const MISSILE_SPAN = f32(3);
const MISSILE_DZ = f32(-0.1);
/** `OBJECT_GROUP_CLIFF`. */
const GROUP_CLIFF = 0x22;
/** `g_angle_negative_two_pi`. */
const NEG_TWO_PI = f32(-6.2831855);
/**
 * `TRIBE_Cliff_Higher_Check_Table` (src/game_globals.cpp:432), per cliff facet: the angle windows `[from1, to1]` and
 * `[from2, to2]` (-1 none) in which the target lies below the cliff. The table's line offsets only feed
 * `lines_intersect`, which always returns 1 (src/t_c_obj.cpp:758), so they are left out.
 */
const CLIFF_HIGHER: readonly (readonly [number, number, number, number])[] = (
  [
    [3.14, 4.71, -1, -1],
    [1.58, 4.7, -1, -1],
    [1.58, 4.7, -1, -1],
    [1.57, 3.14, -1, -1],
    [0.01, 3.13, -1, -1],
    [0.01, 3.13, -1, -1],
    [0, 1.57, -1, -1],
    [4.72, 6.28, 0, 1.56],
    [4.72, 6.28, 0, 1.56],
    [4.71, 6.28, -1, -1],
    [3.15, 6.27, -1, -1],
    [3.15, 6.27, -1, -1],
    [0, 1.57, -1, -1],
    [4.71, 6.28, -1, -1],
    [3.14, 4.71, -1, -1],
    [1.57, 3.14, -1, -1],
    [0.01, 3.13, -1, -1],
    [0.01, 3.13, -1, -1],
    [1.58, 4.7, -1, -1],
    [1.58, 4.7, -1, -1],
    [3.15, 6.27, -1, -1],
    [3.15, 6.27, -1, -1],
    [4.72, 6.28, 0, 1.56],
    [4.72, 6.28, 0, 1.56],
    [1.57, 3.14, -1, -1],
  ] as const
).map(([from1, to1, from2, to2]) => [f32(from1), f32(to1), f32(from2), f32(to2)] as const);
/** `OBJECT_GROUP_CIVILIAN`: the only killers whose kills keep their food (`produceWhenKilledBy`). */
const GROUP_CIVILIAN = 4;
/** Player attribute 0x14: kills; 0x2B: razings. */
const ATTR_KILLS = 20;
const ATTR_RAZINGS = 43;
/** `MASTER_OBJECT_MAN`: what a civilian becomes to attack (src/com_obj.cpp:548). */
const MAN = 83;
/** `MASTER_OBJECT_FLARE`: the minimap flare a ranged attack shows its target's owner. */
const FLARE = 112;
/** War Elephant, Chariot, Scythe Chariot, Armored Elephant: their blast spares their owner's objects (src/t_c_obj.cpp:935-941). */
const BLAST_SPARES_OWN = [46, 40, 339, 345];
/** Stone Thrower, Catapult, Heavy Catapult: a led target's speed counts as 1 at most (src/act_misl.cpp:80-86). */
const CATAPULTS = [35, 36, 280];
/** Archer groups and tower ids that take a building down 0.1 hp a hit at the least (src/t_b_obj.cpp:784-793). */
const ARCHER_GROUPS = [0, 23, 26, 36];
const TOWERS = [79, 69, 199, 383, 380];
const BUILDING_MIN_LOSS_ARCHER = f32(0.1);

function length32(dx: number, dy: number): number {
  return sqrt32(add32(mul32(dx, dx), mul32(dy, dy)));
}

/** `distance_to_object` (src/stat_obj.cpp:2299): edge to edge. */
export function distanceToObject(ctx: PlayerMasters, e: Entity, target: Entity): number {
  const a = typeOf(ctx, e);
  const b = typeOf(ctx, target);
  let gx = sub32(sub32(Math.abs(sub32(target.x, e.x)), a.radiusX), b.radiusX);
  let gy = sub32(sub32(Math.abs(sub32(target.y, e.y)), a.radiusY), b.radiusY);
  if (gx < 0) gx = 0;
  if (gy < 0) gy = 0;
  return length32(gx, gy);
}

/** `angle_to_object` (src/move_obj.cpp:340): the turn still needed, in facets of the current sprite. */
function angleToObject(ctx: PlayerMasters, e: Entity, x: number, y: number): number {
  const s = currentSprite(e, typeOf(ctx, e));
  if (!s.hasFacings || s.facets <= 0) return 0;
  let a = f32(atan2(sub32(y, e.y), sub32(x, e.x)));
  if (a < 0) a = sub32(a, -TWO_PI_F);
  a = sub32(a, e.mover!.angle);
  if (a > PI_D) a = sub32(a, TWO_PI_F);
  if (a < -PI_D) a = sub32(a, -TWO_PI_F);
  return mul32(mul32(s.facets, INV_FULL_CIRCLE), a);
}

/**
 * `turn_towards` (src/move_obj.cpp:368): true when facing within half a facet; otherwise turn one facet, at most once
 * per `turn_speed` seconds of world time, and test again.
 */
export function turnTowards(ctx: GameContext, e: Entity, x: number, y: number): boolean {
  const m = e.mover!;
  let delta = angleToObject(ctx, e, x, y);
  if (delta <= 0.5 && delta >= -0.5) return true;
  const now = mul32(f32(ctx.worldTime), TIME_SCALE);
  if (sub32(now, e.turnTowardsTime ?? 0) < typeOf(ctx, e).turnSpeed) return false;
  const s = currentSprite(e, typeOf(ctx, e));
  const step = f32(FULL_CIRCLE / s.facets);
  m.angle = delta < 0 ? sub32(m.angle, step) : add32(m.angle, step);
  if (m.angle < 0) m.angle = sub32(m.angle, -TWO_PI_F);
  else if (m.angle > TWO_PI_F) m.angle = sub32(m.angle, TWO_PI_F);
  m.facet = facetOf(m.angle, s);
  e.turnTowardsTime = now;
  delta = angleToObject(ctx, e, x, y);
  return delta <= 0.5 && delta >= -0.5;
}

/**
 * Make an `RGE_Action_Attack` on `target` and run `first_in_stack` (combat.md §3.1): a unit that can move starts by
 * walking into range. Null sprites default to the master's move, fight and standing sprites; a range of 0 to the
 * weapon range, or 0.4.
 */
export function startAttack(
  ctx: GameContext,
  e: Entity,
  target: Entity,
  moveSprite: SpriteInfo | null,
  fightSprite: SpriteInfo | null,
  range: number,
  sub: boolean,
): AttackAction {
  const t = typeOf(ctx, e);
  const c = t.combat!;
  let r = f32(range);
  if (r === 0) r = c.range === 0 ? DEFAULT_RANGE : c.range;
  const a: AttackAction = {
    state: 0,
    target: target.id,
    // Not latched: an attack on an object starts at (-1, -1, -1) (src/act_atak.cpp:55-57), so the first
    // `ready_to_attack` measures the distance.
    x: f32(-1),
    y: f32(-1),
    z: f32(-1),
    range: r,
    minRange: c.minRange,
    timer: 0,
    needToAttack: false,
    moveSprite: (moveSprite ?? t.walking ?? t.standing).graphic,
    fightSprite: (fightSprite ?? c.attackSprite ?? t.standing).graphic,
    waitSprite: t.standing.graphic,
    sub,
  };
  e.attack = a;
  firstInStack(ctx, e, a);
  return a;
}

/** `RGE_Action_Attack::first_in_stack` (src/act_atak.cpp:168): a unit that can move starts by walking into range. */
function firstInStack(ctx: GameContext, e: Entity, a: AttackAction): void {
  if (!holdsPosition(e, typeOf(ctx, e))) setAttackState(ctx, e, a, ATTACK_MOVING);
  else if (!readyToAttack(ctx, e, a)) {
    if (a.state === 0) setAttackState(ctx, e, a, ATTACK_WAITING);
  } else {
    e.attackTimer = typeOf(ctx, e).combat!.reloadTime;
    setAttackState(ctx, e, a, ATTACK_ATTACKING);
  }
}

/**
 * `RGE_Combat_Object::attack(x, y, z, unconditional)` (src/com_obj.cpp:569; commands.md §5), Attack Ground's way in: a
 * ground attack on (x, y, 0) with the weapon range (0 → 0.4) and `indirect_fire_flag` 2 replaces every action. No
 * civilian transformation, no unit-AI order. False without a mover or a combat block (as `combatAttack`).
 */
export function attackGround(ctx: GameContext, e: Entity, x: number, y: number): boolean {
  const t = typeOf(ctx, e);
  const c = t.combat;
  if (!e.mover || !c) return false;
  deleteActions(ctx, e);
  const a: AttackAction = {
    state: 0,
    target: -1,
    x: f32(x),
    y: f32(y),
    z: 0,
    range: c.range === 0 ? DEFAULT_RANGE : c.range,
    minRange: c.minRange,
    timer: 0,
    needToAttack: false,
    moveSprite: (t.walking ?? t.standing).graphic,
    fightSprite: (c.attackSprite ?? t.standing).graphic,
    waitSprite: t.standing.graphic,
    sub: false,
    indirect: 2,
  };
  e.attack = a;
  firstInStack(ctx, e, a);
  return true;
}

/** `RGE_Action_Attack::set_state` (src/act_atak.cpp:195): every change first deletes the sub-action. */
export function setAttackState(ctx: GameContext, e: Entity, a: AttackAction, state: number): void {
  if (e.mover?.action) endAction(e.mover);
  a.state = state;
  const c = typeOf(ctx, e).combat!;
  switch (state) {
    case ATTACK_TARGET_LOST:
      if (a.indirect) a.indirect = 0;
      return;
    case ATTACK_MOVING: {
      // Each walk spends one of a ground attack's two (src/act_atak.cpp:205-207).
      if (a.indirect) a.indirect--;
      const target = a.target === -1 ? null : (ctx.entities.get(a.target) ?? null);
      startMoveTo(e, target, a.x, a.y, a.z, a.range, spriteInfo(a.moveSprite), true, ctx);
      a.timer = 0;
      return;
    }
    case ATTACK_WAITING:
      if (a.indirect && a.target !== -1) a.indirect = 0;
      if (readyToAttack(ctx, e, a)) {
        e.attackTimer = c.reloadTime;
        setAttackState(ctx, e, a, ATTACK_ATTACKING);
        return;
      }
      // `ready_to_attack` may itself have switched to 4 or 13.
      if (a.state !== ATTACK_WAITING) return;
      newSprite(ctx, e, spriteInfo(c.projectileUnitId === -1 ? a.fightSprite : a.waitSprite));
      return;
    case ATTACK_ATTACKING:
      newSprite(ctx, e, spriteInfo(a.fightSprite));
      a.needToAttack = true;
      return;
    case ATTACK_DONE:
    case ATTACK_FAILED:
    case ATTACK_INVALID:
      newSprite(ctx, e, spriteInfo(a.waitSprite));
      return;
  }
}

/**
 * `ready_to_attack` (combat.md §3.4). A target owned by a player, other than a building or wall, must stand on a tile
 * the attacker's player sees, or on a fogged one if its master's `fog_flag` is set; else the attack fails
 * (src/act_atak.cpp:465-477, visibility.md §5).
 */
function readyToAttack(ctx: GameContext, e: Entity, a: AttackAction): boolean {
  const target = a.target === -1 ? undefined : ctx.entities.get(a.target);
  if (!turnTowards(ctx, e, target ? target.x : a.x, target ? target.y : a.y)) return false;
  const t = typeOf(ctx, e);
  if (target && target.owner > 0 && ctx.visibility) {
    const tt = typeOf(ctx, target);
    if (tt.group !== GROUP_BUILDING && tt.group !== GROUP_WALL) {
      const seen = ctx.visibility.get(e.owner, toInt(target.x), toInt(target.y));
      if (seen === TILE_BLACK || (seen === TILE_FOGGED && tt.fogFlag === 0)) {
        setAttackState(ctx, e, a, ATTACK_FAILED);
        return false;
      }
    }
  }
  const reach = sub32(add32(length32(t.radiusX, t.radiusY), a.range), RANGE_SLACK);
  let ready = false;
  if (!target) {
    let gx = sub32(Math.abs(sub32(a.x, e.x)), t.radiusX);
    let gy = sub32(Math.abs(sub32(a.y, e.y)), t.radiusY);
    if (gx < 0) gx = 0;
    if (gy < 0) gy = 0;
    const d = length32(gx, gy);
    if (d < a.minRange) return tooClose(ctx, e, a);
    ready = d <= reach;
  } else {
    const dx = sub32(target.x, a.x);
    const dy = sub32(target.y, a.y);
    const dz = sub32(target.z, a.z);
    if (dx <= HALF && dx >= -HALF && dy <= HALF && dy >= -HALF && dz <= HALF && dz >= -HALF) ready = true;
    else {
      const d = distanceToObject(ctx, e, target);
      if (d < a.minRange) return tooClose(ctx, e, a);
      if (d <= reach) {
        a.x = target.x;
        a.y = target.y;
        a.z = target.z;
        ready = true;
      }
    }
  }
  if (!ready) {
    setAttackState(ctx, e, a, holdsPosition(e, t) ? ATTACK_FAILED : ATTACK_MOVING);
    return false;
  }
  return (e.attackTimer ?? 0) <= 0;
}

/** Too close: a mobile unit that is not standing its ground just waits (src/act_atak.cpp:499-512). */
function tooClose(ctx: GameContext, e: Entity, a: AttackAction): boolean {
  if (!holdsPosition(e, typeOf(ctx, e))) return false;
  setAttackState(ctx, e, a, ATTACK_FAILED);
  return false;
}

/**
 * The attacker does not move to its target: it cannot move, or its unit AI's current order is STAND_GROUND
 * (`first_in_stack` and `ready_to_attack`, src/act_atak.cpp:168-187, 499-530).
 */
function holdsPosition(e: Entity, t: UnitType): boolean {
  return maximumSpeed(e, t) === 0 || e.ai?.order === AI_ORDER_STAND_GROUND;
}

/** `RGE_Action_Attack::update` (combat.md §3.2, sprites.md §5.2). */
export function updateAttack(ctx: GameContext, e: Entity): ActionResult {
  const a = e.attack;
  if (!a) return ActionResult.Remove;
  a.timer = add32(a.timer, ctx.deltaSeconds);
  if (a.target !== -1) {
    const target = ctx.entities.get(a.target);
    if (!target || target.state >= ObjectState.Dying) {
      a.target = -1;
      setAttackState(ctx, e, a, ATTACK_TARGET_LOST);
      return ActionResult.TargetLost;
    }
    // A target whose owner the attacker's owner (not Gaia) now calls an ally is invalid (src/act_atak.cpp:282-290,
    // diplomacy.md §2).
    if (e.owner !== 0 && isAlly(ctx, e.owner, target.owner)) {
      setAttackState(ctx, e, a, ATTACK_DONE);
      if (!a.sub) notifyObject(ctx, e, e.id, NOTIFY_TARGET_INVALID, AI_ACTION_ATTACK);
      return ActionResult.TargetInvalid;
    }
    // So is a target aboard a transport (src/act_atak.cpp:292-300, naval.md §7.3).
    if (target.inside != null) {
      setAttackState(ctx, e, a, ATTACK_DONE);
      if (!a.sub) notifyObject(ctx, e, e.id, NOTIFY_TARGET_INVALID, AI_ACTION_ATTACK, target.id);
      return ActionResult.TargetInvalid;
    }
  }
  switch (a.state) {
    case ATTACK_DONE:
      return ActionResult.Remove;
    case ATTACK_TARGET_LOST:
      if (e.sprite?.looped) {
        a.target = -1;
        if (!a.sub) notifyObject(ctx, e, e.id, NOTIFY_ACTION_COMPLETED, AI_ACTION_ATTACK);
        setAttackState(ctx, e, a, ATTACK_DONE);
        return a.sub ? ActionResult.TargetLost : ActionResult.Completed;
      }
      return ActionResult.Continue;
    case ATTACK_MOVING:
      switch (updateMover(ctx, e)) {
        case ActionResult.Remove:
        case ActionResult.Completed:
          setAttackState(ctx, e, a, ATTACK_WAITING);
          return ActionResult.Continue;
        case ActionResult.Failed:
          setAttackState(ctx, e, a, ATTACK_FAILED);
          if (!a.sub) notifyObject(ctx, e, e.id, NOTIFY_ACTION_FAILED, AI_ACTION_ATTACK);
          return ActionResult.Failed;
        case ActionResult.TargetInvalid:
          setAttackState(ctx, e, a, ATTACK_INVALID);
          if (!a.sub) notifyObject(ctx, e, e.id, NOTIFY_TARGET_INVALID, AI_ACTION_ATTACK);
          return ActionResult.TargetInvalid;
        default:
          return ActionResult.Continue;
      }
    case ATTACK_WAITING:
      if (readyToAttack(ctx, e, a)) {
        e.attackTimer = typeOf(ctx, e).combat!.reloadTime;
        setAttackState(ctx, e, a, ATTACK_ATTACKING);
      }
      return ActionResult.Continue;
    case ATTACK_ATTACKING: {
      if (!a.needToAttack) {
        if ((e.attackTimer ?? 0) <= 0) {
          // A ground attack (`indirect_fire_flag` set) has no target and goes on firing (src/act_atak.cpp:362).
          if (a.target === -1 && !a.indirect) {
            setAttackState(ctx, e, a, ATTACK_TARGET_LOST);
            return ActionResult.Continue;
          }
          e.attackTimer = typeOf(ctx, e).combat!.reloadTime;
          setAttackState(ctx, e, a, ATTACK_WAITING);
          // `set_state(6)` may have moved on to 13 or 4 (src/act_atak.cpp:345-350).
          const now = a.state as number;
          if (now === ATTACK_FAILED || now === ATTACK_MOVING) return ActionResult.Continue;
          setAttackState(ctx, e, a, ATTACK_ATTACKING);
        }
        if (!a.needToAttack) {
          if (!e.sprite?.looped && (currentSprite(e, typeOf(ctx, e)).flags & 1) !== 0) return ActionResult.Continue;
          setAttackState(ctx, e, a, a.target === -1 && !a.indirect ? ATTACK_TARGET_LOST : ATTACK_WAITING);
          return ActionResult.Continue;
        }
      }
      const c = typeOf(ctx, e).combat!;
      const frame = c.frameDelay !== 0 ? c.frameDelay : toInt(mul32(currentSprite(e, typeOf(ctx, e)).frames, HALF)) << 16 >> 16;
      if (e.sprite && framePassed(e.sprite, frame)) {
        // `RGE_Action_Attack::do_attack` (src/act_atak.cpp:542): the target, or else the target point.
        const target = a.target === -1 ? undefined : ctx.entities.get(a.target);
        if (target) launch(ctx, e, target);
        else launchAt(ctx, e, a.x, a.y, a.z);
        a.needToAttack = false;
      }
      return ActionResult.Continue;
    }
    case ATTACK_FAILED:
      // Every update in state 13 tells the unit, sub-action or not (src/act_atak.cpp:399-401).
      notifyObject(ctx, e, e.id, NOTIFY_ACTION_FAILED, AI_ACTION_ATTACK);
      return ActionResult.Failed;
    default:
      return ActionResult.Continue;
  }
}

/**
 * `TRIBE_Combat_Object::attack` then `RGE_Combat_Object::attack(target, attacker)` (combat.md §4.1-§4.2): a missile
 * user aiming at a player's object first shows that player a flare at its own position; melee hits now, a missile user
 * throws.
 */
export function launch(ctx: GameContext, e: Entity, target: Entity): void {
  const t = typeOf(ctx, e);
  const c = t.combat!;
  if (c.projectileUnitId >= 0 && target.owner > 0) ctx.create(target.owner, FLARE, e.x, e.y, e.z);
  if (c.projectileUnitId < 0) {
    doAttack(ctx, e, target, e.x, e.y);
    return;
  }
  throwMissile(ctx, e, target.id, target.x, target.y, target.z);
}

/**
 * `RGE_Combat_Object::attack(x, y, z, attacker)` (src/com_obj.cpp:237; commands.md §5): a missile user throws at the
 * point, with no flare; a melee unit does nothing.
 */
function launchAt(ctx: GameContext, e: Entity, x: number, y: number, z: number): void {
  if (typeOf(ctx, e).combat!.projectileUnitId < 0) return;
  throwMissile(ctx, e, -1, x, y, z);
}

/** Spawn the missile at the weapon offset and `init_missile` (combat.md §4.2, §5.1): aimed at once, or done (state 1). */
function throwMissile(ctx: GameContext, e: Entity, targetId: number, x: number, y: number, z: number): void {
  const t = typeOf(ctx, e);
  const c = t.combat!;
  const maxRange = sub32(add32(length32(t.radiusX, t.radiusY), c.range), MISSILE_RANGE_SLACK);
  const angle = e.mover!.angle;
  const co = f32(cos(angle));
  const si = f32(sin(angle));
  const [offX, offY, offZ] = c.displacement;
  const mx = sub32(add32(e.x, mul32(co, offY)), mul32(si, offX));
  const my = add32(add32(e.y, mul32(si, offY)), mul32(co, offX));
  const missile = ctx.create(e.owner, c.projectileUnitId, mx, my, add32(e.z, offZ));
  const action: MissileAction = {
    state: 3,
    target: targetId,
    launcher: e.id,
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    timer: 0,
    ballisticVelocity: 0,
    ballisticAcceleration: 0,
    maxRange,
  };
  missile.missile = action;
  // `first_in_stack(1)` (src/act_misl.cpp:33-43): no target and no point means done.
  if (targetId === -1 && (x === -1 || y === -1)) die(ctx, missile, action);
  else aim(ctx, missile, action);
}

/**
 * `do_attack` (combat.md §4.3) at the point (x, y), the attacker's own position for melee and the missile's at impact.
 * A `TRIBE_Combat_Object` (master type 70, 80) with a blast radius and a range under 0.99 splashes around the point,
 * sparing the target, then rolls for the target; any other attacker with a blast radius only blasts the point; else one
 * hit roll, then damage on a hit.
 */
export function doAttack(ctx: GameContext, attacker: Entity, target: Entity, x: number, y: number): void {
  const t = typeOf(ctx, attacker);
  const c = t.combat!;
  if (c.blastWidth > 0) {
    if (!isTribe(t) || c.range >= f32(0.99)) {
      areaAttack(ctx, attacker, x, y, null);
      return;
    }
    areaAttack(ctx, attacker, x, y, target);
  }
  if (hitRoll(ctx) > c.accuracy) return;
  damage(ctx, target, attacker, attackModifier(ctx, attacker, target));
}

/** `rand() × 100 / 0x7FFF`, C integer division: 0..100. */
function hitRoll(ctx: GameContext): number {
  return Math.trunc((ctx.rng.rand() * 100) / 0x7fff);
}

/** `TRIBE_Combat_Object`s are the dat's master types 70 and 80 (src/tmplayer.cpp:19-27); a missile (60) is an RGE one. */
function isTribe(t: UnitType): boolean {
  return t.masterType >= 70;
}

/**
 * `area_attack` (combat.md §4.4; `TRIBE_Combat_Object`, src/t_c_obj.cpp:894, or the RGE base, src/com_obj.cpp:117, for
 * a missile): every object in the tiles around (x, y) whose edge lies within the blast radius, other than `ignore` and
 * the attacker, with `area_effect_object_level` at least the blast's level, gets its own hit roll and the attacker's full
 * damage. A War Elephant, Chariot, Scythe Chariot or Armored Elephant spares its owner's objects; a `TRIBE` victim left
 * below 1 hp loses its carried resource. Tile lists are taken as each tile's objects by descending id.
 */
export function areaAttack(ctx: GameContext, attacker: Entity, x: number, y: number, ignore: Entity | null): void {
  const t = typeOf(ctx, attacker);
  const c = t.combat!;
  const r = c.blastWidth;
  if (!(r > 0)) return;
  const r2 = mul32(r, r);
  const { width, height } = ctx.map;
  const x0 = Math.max(0, i16(toInt(sub32(x, r))) - 2);
  const x1 = Math.min(width, i16(toInt(add32(x, r))) + 2);
  const y0 = Math.max(0, i16(toInt(sub32(y, r))) - 2);
  const y1 = Math.min(height, i16(toInt(add32(y, r))) + 2);
  const tribe = isTribe(t);
  const sparesOwn = tribe && BLAST_SPARES_OWN.includes(t.id);
  const listed: { o: Entity; tile: number }[] = [];
  for (const o of ctx.entities.all()) {
    // A passenger is on no tile.
    if (!ctx.masters[o.owner]?.[o.type] || o.inside != null) continue;
    const col = Math.min(Math.max(toInt(o.x), 0), width - 1);
    const row = Math.min(Math.max(toInt(o.y), 0), height - 1);
    if (col < x0 || col >= x1 || row < y0 || row >= y1) continue;
    listed.push({ o, tile: row * width + col });
  }
  listed.sort((a, b) => a.tile - b.tile || b.o.id - a.o.id);
  for (const { o } of listed) {
    if (o === ignore || o === attacker || (sparesOwn && o.owner === attacker.owner)) continue;
    const ot = typeOf(ctx, o);
    if (ot.blastDefense < c.blastLevel) continue;
    let dx = Math.abs(sub32(o.x, x));
    let dy = Math.abs(sub32(o.y, y));
    dx = dx > ot.radiusX ? sub32(dx, ot.radiusX) : 0;
    dy = dy > ot.radiusY ? sub32(dy, ot.radiusY) : 0;
    if (!(r2 > add32(mul32(dx, dx), mul32(dy, dy)))) continue;
    if (i16(hitRoll(ctx)) > c.accuracy) continue;
    damage(ctx, o, attacker, attackModifier(ctx, attacker, o));
    if (tribe && o.hp < 1) {
      // `set_attribute_amount(0, 0, 1)`: none held, then the clamp to `attribute_max_amount`.
      o.heldAmount = ot.resourceCapacity < 0 ? f32(ot.resourceCapacity) : 0;
    }
  }
}

/**
 * `calc_attack_modifier` (combat.md §2.3): ×1.5 for a ranged attacker higher than its target, ×0.6666 for a lower melee
 * one; always 1 for a missile (`RGE_Combat_Object::calc_attack_modifier`, src/com_obj.cpp:113), the source when its
 * launcher is gone.
 */
function attackModifier(ctx: GameContext, attacker: Entity, target: Entity): number {
  if (!isTribe(typeOf(ctx, attacker))) return 1;
  const c = typeOf(ctx, attacker).combat!;
  if (c.projectileUnitId >= 0) return higherThanTarget(ctx, attacker, target) ? f32(1.5) : 1;
  return attacker.z < target.z ? MELEE_LOW : 1;
}

/**
 * `higher_than_target` (src/t_c_obj.cpp:803; combat.md §2.3): a higher `world_z`, or else a cliff count along the line
 * to the target: in `2 × |(int)major delta|` steps, at each new tile the first cliff on it or on one of its two
 * neighbours across the minor axis counts +1 when the direction to the target lies in that cliff facet's angle window,
 * else -1 (`higher_check_for_cliff`, :762). Higher when the count ends above 0.
 */
function higherThanTarget(ctx: GameContext, e: Entity, target: Entity): boolean {
  if (e.z > target.z) return true;
  const dx = sub32(target.x, e.x);
  const dy = sub32(target.y, e.y);
  if (dx === 0 && dy === 0) return false;
  let steps = Math.abs(dy) > Math.abs(dx) ? Math.abs(toInt(dy)) * 2 : Math.abs(toInt(dx)) * 2;
  if (steps === 0) return false;
  const xStep = div32(dx, steps);
  const yStep = div32(dy, steps);
  // Stepping mostly along x the side tiles are across y, and the other way round.
  const [sideX, sideY] = Math.abs(xStep) > Math.abs(yStep) ? [0, 1] : [1, 0];
  const { width, height } = ctx.map;
  let cliffs: Map<number, Entity> | null = null;
  let angle = -1;
  let count = 0;
  const check = (col: number, row: number): boolean => {
    if (col < 0 || row < 0 || col >= width || row >= height) return false;
    cliffs ??= cliffsByTile(ctx);
    const cliff = cliffs.get(row * width + col);
    if (!cliff) return false;
    if (angle === -1) {
      angle = f32(atan2(sub32(target.y, e.y), sub32(target.x, e.x)));
      if (angle < 0) angle = sub32(angle, NEG_TWO_PI);
    }
    const w = CLIFF_HIGHER[cliff.facet ?? 0];
    if (!w || ((angle < w[0] || angle > w[1]) && (angle < w[2] || angle > w[3]))) count--;
    else count++;
    return true;
  };
  let x = e.x;
  let y = e.y;
  let priorX = -999;
  let priorY = -999;
  for (; steps > 0; steps--) {
    x = add32(x, xStep);
    y = add32(y, yStep);
    const col = toInt(x);
    const row = toInt(y);
    if (col === priorX && row === priorY) continue;
    priorX = col;
    priorY = row;
    if (!check(col, row) && !check(col - sideX, row - sideY)) check(col + sideX, row + sideY);
  }
  return count > 0;
}

/**
 * The cliff (`OBJECT_GROUP_CLIFF`) each tile's object list finds first: lists add at the front and cliffs never move,
 * so the newest cliff on the tile.
 */
function cliffsByTile(ctx: GameContext): Map<number, Entity> {
  const cliffs = new Map<number, Entity>();
  const { width, height } = ctx.map;
  for (const o of ctx.entities.all()) {
    if (ctx.masters[o.owner]?.[o.type]?.group !== GROUP_CLIFF) continue;
    const tile = Math.min(Math.max(toInt(o.y), 0), height - 1) * width + Math.min(Math.max(toInt(o.x), 0), width - 1);
    const seen = cliffs.get(tile);
    if (!seen || seen.id < o.id) cliffs.set(tile, o);
  }
  return cliffs;
}

/** `calculateDamage` (combat.md §2.2) with the defence terrain multiplier 1. */
function armouredDamage(ctx: PlayerMasters, attacker: Entity, target: Entity, modifier: number): number {
  const weapon = typeOf(ctx, attacker).combat!;
  const defence = typeOf(ctx, target).combat!;
  let total = 0;
  for (const w of weapon.attacks) {
    let armour = defence.baseArmour;
    for (const a of defence.armours) if (a.group === w.group) armour = a.amount;
    const d = mul32(sub32(w.amount, armour), modifier);
    if (d > 0) total = add32(total, d);
  }
  return total;
}

/**
 * `damage` on the target (combat.md §2.1): static objects (`src/stat_obj.cpp:2161`), buildings
 * (`TRIBE_Building_Object::damage`, `src/t_b_obj.cpp:771`) and other combat objects (`TRIBE_Combat_Object::damage`,
 * `src/t_c_obj.cpp:212`).
 */
function damage(ctx: GameContext, target: Entity, attacker: Entity, modifier: number): void {
  const tt = typeOf(ctx, target);
  if (!tt.combat) {
    // `RGE_Static_Object::damage`: plain sum of the weapon values, no armour, no minimum; a kill wakes it.
    let total = 0;
    for (const w of typeOf(ctx, attacker).combat!.attacks) total = add32(mul32(w.amount, modifier), total);
    target.hp = sub32(target.hp, total);
    if (target.hp < 1) {
      target.hp = 0;
      ctx.wake(target);
    }
    return;
  }
  const before = target.hp;
  if (isBuilding(tt)) {
    if (before <= 0) return;
    combatDamage(ctx, target, attacker, modifier);
    const at = typeOf(ctx, attacker);
    const least = ARCHER_GROUPS.includes(at.group) || TOWERS.includes(at.id) ? BUILDING_MIN_LOSS_ARCHER : 1;
    if (sub32(before, target.hp) < least) target.hp = sub32(before, least);
    if (target.owner > 0 && target.hp < 1) {
      const razings = ctx.attributes[attacker.owner]!;
      razings[ATTR_RAZINGS] = add32(razings[ATTR_RAZINGS]!, 1);
    }
    return;
  }
  if (before < 1) return;
  combatDamage(ctx, target, attacker, modifier);
  if (target.hp < 1 && typeOf(ctx, attacker).group !== GROUP_CIVILIAN) target.heldAmount = 0;
  if (sub32(before, target.hp) < 1) target.hp = sub32(before, 1);
  if (target.owner > 0 && target.hp < 1) {
    const kills = ctx.attributes[attacker.owner]!;
    kills[ATTR_KILLS] = add32(kills[ATTR_KILLS]!, 1);
  }
}

/**
 * `RGE_Combat_Object::damage` (src/com_obj.cpp:292): take the armoured damage, tell the target's unit AI who hit it and
 * the hp left (as an int, before the clamp), then clamp below 1 to 0.
 */
function combatDamage(ctx: GameContext, target: Entity, attacker: Entity, modifier: number): void {
  target.hp = sub32(target.hp, armouredDamage(ctx, attacker, target, modifier));
  notifyObject(ctx, target, attacker.id, NOTIFY_ATTACKED, attacker.id, Math.trunc(target.hp));
  if (target.hp < 1) target.hp = 0;
}

/**
 * `RGE_Combat_Object::attack(targetID, unconditional)` (src/com_obj.cpp:520), the unit AI's way in: keep an attack
 * already on the target, else a civilian becomes a Villager (`MASTER_OBJECT_MAN`) and a new attack with the weapon range
 * replaces every action. False without a target.
 */
export function combatAttack(ctx: GameContext, e: Entity, target: Entity, unconditional: boolean): boolean {
  const top = e.attack && !e.work ? e.attack : null;
  if (top && top.target === target.id) {
    if (!unconditional) return true;
    return attackWork(ctx, e, target);
  }
  if (!e.mover || !typeOf(ctx, e).combat) return false;
  if (typeOf(ctx, e).group === GROUP_CIVILIAN) transform(ctx, e, master(ctx, e.owner, MAN));
  const c = typeOf(ctx, e).combat!;
  deleteActions(ctx, e);
  startAttack(ctx, e, target, null, null, c.range, false);
  return true;
}

/** `RGE_Action_Attack::work` (src/act_atak.cpp:405): the same target keeps a running attack; any other is chased. */
export function attackWork(ctx: GameContext, e: Entity, target: Entity): boolean {
  const a = e.attack!;
  if (target.id === a.target && (a.state === ATTACK_MOVING || a.state === ATTACK_WAITING || a.state === ATTACK_ATTACKING)) return true;
  if (a.indirect) a.indirect = 0;
  a.target = target.id;
  a.x = target.x;
  a.y = target.y;
  a.z = target.z;
  setAttackState(ctx, e, a, ATTACK_MOVING);
  return true;
}

/** `RGE_Action_Missile::set_state(3)` (combat.md §5.2): aim at the target and fly (state 4). */
function aim(ctx: GameContext, e: Entity, a: MissileAction): void {
  const t = typeOf(ctx, e);
  const mi = t.missile!;
  const target = a.target === -1 ? undefined : ctx.entities.get(a.target);
  const tx = target ? target.x : a.x;
  const ty = target ? target.y : a.y;
  const tz = target ? add32(mul32(typeOf(ctx, target).radiusZ, HALF), target.z) : a.z;
  let dx = sub32(tx, e.x);
  let dy = sub32(ty, e.y);
  const dz = sub32(tz, e.z);
  const len = (x: number, y: number) => sqrt32(add32(add32(mul32(x, x), mul32(y, y)), mul32(dz, dz)));
  let d = len(dx, dy);
  let targetSpeed = target?.mover?.speed ?? 0;
  if (mi.targetting === 1 && target && targetSpeed > 0) {
    const launcher = a.launcher === -1 ? undefined : ctx.entities.get(a.launcher);
    if (launcher && CATAPULTS.includes(typeOf(ctx, launcher).id) && targetSpeed > 1) targetSpeed = 1;
    const angle = target.mover!.angle;
    const tvx = mul32(f32(cos(angle)), targetSpeed);
    const tvy = mul32(f32(sin(angle)), targetSpeed);
    const k = add32(sub32(d, len(add32(dx, tvx), add32(dy, tvy))), t.speed);
    if (k > mul32(t.speed, HALF)) {
      const adjust = div32(d, k);
      dx = add32(dx, mul32(tvx, adjust));
      dy = add32(dy, mul32(tvy, adjust));
      d = len(dx, dy);
    }
  }
  if (mi.type === 0 || mi.type === 3) {
    a.vx = mi.type === 0 ? div32(dx, d) : dx;
    a.vy = mi.type === 0 ? div32(dy, d) : dy;
    a.vz = mi.type === 0 ? div32(dz, d) : dz;
    e.mover!.angle = f32(atan2(a.vy, a.vx));
    e.mover!.facet = facetOf(e.mover!.angle, currentSprite(e, typeOf(ctx, e)));
    if (mi.type === 0) a.timer = 0;
  }
  if (mi.ballistics > 0) {
    const time = mul32(t.speed > 0 ? div32(d, t.speed) : 0, HALF);
    const acceleration = -mul32(d, mi.ballistics);
    a.ballisticAcceleration = div32(add32(acceleration, acceleration), mul32(time, time));
    a.ballisticVelocity = -mul32(time, a.ballisticAcceleration);
  } else {
    a.ballisticVelocity = 0;
    a.ballisticAcceleration = 0;
  }
  a.state = 4;
}

/** `RGE_Action_Missile::update` (combat.md §5.3) for hit info 0 (only the intended target can be hit). */
export function updateMissile(ctx: GameContext, e: Entity): ActionResult {
  const a = e.missile;
  if (!a) return ActionResult.Remove;
  const t = typeOf(ctx, e);
  const mi = t.missile!;
  const dt = ctx.deltaSeconds;
  const s = mul32(t.speed, dt);
  const live = (id: number) => {
    const o = id === -1 ? undefined : ctx.entities.get(id);
    return o && o.state < ObjectState.Dying ? o : undefined;
  };
  if (!live(a.target)) a.target = -1;
  if (!live(a.launcher)) a.launcher = -1;
  if (a.state === 1) return ActionResult.Remove;
  if (a.state !== 4) return ActionResult.Continue;
  let vx = 0;
  let vy = 0;
  let vz = 0;
  if (mi.type === 0) {
    a.timer = add32(a.timer, s);
    vx = mul32(a.vx, s);
    vy = mul32(a.vy, s);
    vz = mul32(a.vz, s);
    if (a.timer >= a.maxRange) die(ctx, e, a);
  } else if (mi.type === 3) {
    vx = a.vx;
    vy = a.vy;
    vz = a.vz;
  }
  if (mi.ballistics > 0) {
    const change = mul32(a.ballisticAcceleration, dt);
    const average = add32(a.ballisticVelocity, mul32(change, HALF));
    a.ballisticVelocity = add32(a.ballisticVelocity, change);
    vz = add32(vz, mul32(average, dt));
  }
  const hitGround = missileMove(ctx, e, a, vx, vy, vz);
  const source = (a.launcher === -1 ? undefined : ctx.entities.get(a.launcher)) ?? e;
  const target = a.target === -1 ? undefined : ctx.entities.get(a.target);
  if ((mi.type === 0 || mi.type === 2) && target && collides(ctx, e, target, s)) {
    doAttack(ctx, source, target, e.x, e.y);
    die(ctx, e, a);
  } else if (mi.type === 3 && target) {
    doAttack(ctx, source, target, e.x, e.y);
    die(ctx, e, a);
  }
  // Hitting the ground: `area_attack` at the missile, which does nothing without a blast radius.
  if (hitGround && (a.state as number) !== 1) {
    areaAttack(ctx, source, e.x, e.y, null);
    die(ctx, e, a);
  }
  return ActionResult.Continue;
}

/** `missile_move` (src/misl_obj.cpp:77-92): true when it ends on the ground (`teleport`'s `rz` is its `world_z`). */
function missileMove(ctx: GameContext, e: Entity, a: MissileAction, vx: number, vy: number, vz: number): boolean {
  const nx = add32(e.x, vx);
  const ny = add32(e.y, vy);
  const nz = add32(e.z, vz);
  if (nx < 0 || nx >= ctx.map.width || ny < 0 || ny >= ctx.map.height) die(ctx, e, a);
  e.x = f32(Math.min(Math.max(nx, 0), sub32(ctx.map.width, f32(0.001))));
  e.y = f32(Math.min(Math.max(ny, 0), sub32(ctx.map.height, f32(0.001))));
  const rz = ctx.map.groundZ(e.x, e.y);
  e.z = !typeOf(ctx, e).flying || rz > nz ? rz : nz;
  return rz === e.z;
}

/** `make_object_collision_list` (src/misl_obj.cpp:94) for one candidate: within 3 tiles and inside the swept box. */
function collides(ctx: PlayerMasters, e: Entity, o: Entity, s: number): boolean {
  const t = typeOf(ctx, e);
  const ot = typeOf(ctx, o);
  if (t.radiusX <= 0 || t.radiusY <= 0 || ot.radiusX <= 0 || ot.radiusY <= 0) return false;
  const minX = Math.max(0, toInt(sub32(e.x, MISSILE_SPAN)));
  const minY = Math.max(0, toInt(sub32(e.y, MISSILE_SPAN)));
  const maxX = toInt(add32(e.x, MISSILE_SPAN));
  const maxY = toInt(add32(e.y, MISSILE_SPAN));
  const tx = toInt(o.x);
  const ty = toInt(o.y);
  if (tx < minX || tx > maxX || ty < minY || ty > maxY) return false;
  const dz = sub32(o.z, e.z);
  if (dz < -sub32(ot.radiusZ, MISSILE_DZ) || dz > sub32(t.radiusZ, MISSILE_DZ)) return false;
  return Math.abs(sub32(o.x, e.x)) <= add32(add32(ot.radiusX, t.radiusX), s) && Math.abs(sub32(o.y, e.y)) <= add32(add32(ot.radiusY, t.radiusY), s);
}

/** State 1: `die_die_die` — hp 0; the object's own update then runs it through dying to removal. */
function die(ctx: GameContext, e: Entity, a: MissileAction): void {
  a.state = 1;
  e.hp = 0;
  ctx.wake(e);
}
