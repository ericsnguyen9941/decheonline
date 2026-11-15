/**
 * Moving units: the move action, `findPath`, `doMove` and `doTrivialMove` (docs/spec/movement.md §5, §6, §8, §9).
 * Every float store is rounded to float32 (core.md §3). Trig goes through the deterministic `trig.ts`.
 */
import { ObjectState, type Entity, type EntityStore } from './entities';
import type { TileMap } from './map';
import { add32, div32, f32, mul32, sqrt32, sub32, toInt } from './num';
import type { PathingSystem, Waypoint } from './pathing';
import { typeOf, type PlayerMasters } from './masters';
import type { CrtRand } from './rng';
import { newSprite, type SpriteContext } from './sprites';
import { atan2, cos, sin } from './trig';
import { exploreObject, unexploreObject, type VisibilityContext } from './visibility';
import { spriteInfo, type SpriteInfo, type UnitType } from './units';

const TWO_PI_F = f32(6.2831855);
const FULL_CIRCLE = 6.2831853;
const PI_D = 3.14159265;
const INV_FULL_CIRCLE = f32(0.15915494);
const QUARTER_PI_F = f32(0.7853982);
const FACET_ANGLE_F = f32(0.3926991);
const ANGLE_TOLERANCE = 0.1;
const WAIT_STEP = f32(0.1);
const HALF = f32(0.5);
const SNAP_CLOSE = f32(0.25);
/** `g_move_waypoint_distance_threshold` (src/game_globals.cpp:259). */
const WAYPOINT_DISTANCE_THRESHOLD = f32(4);
const RANGE_SLACK = f32(-0.3);
const CLIMB = f32(0.9);
const DESCEND = f32(1.03);
const MAP_EDGE = f32(0.001);
/** Default move range when the order gives none (movement.md §3). */
export const MOVE_RANGE = f32(0.4);
/** Repaths a human player's unit may make on one move, plus its user waypoints (movement.md §3). */
const CONTINUE_PATHS_HUMAN = 25;
/** `pathingCapValue`: path searches each player may start per step (movement.md §3). */
export const PATHING_CAP = 2;
/** `pathingDelayCapValue`: a unit that waited more often than this searches regardless of the cap. */
const PATHING_DELAY_CAP = 10;
const FAR = f32(100000);

/** `RGE_Action_Move_To` states used here: 1 done, 3 needs a path, 4 moving, 13 failed. */
export const MOVE_DONE = 1;
export const MOVE_NEED_PATH = 3;
export const MOVE_MOVING = 4;
export const MOVE_FAILED = 13;

/** What an action's `update` reports to its list (`RGE_ACTION_UPDATE_*`). */
export const ActionResult = { Continue: 0, Completed: 1, Remove: 2, Failed: 3, TargetInvalid: 4, TargetLost: 5 } as const;
export type ActionResult = (typeof ActionResult)[keyof typeof ActionResult];

export interface MoveAction {
  state: number;
  x: number;
  y: number;
  z: number;
  range: number;
  /** Target object id, -1 for a point. */
  target: number;
  /** Graphic shown while moving (state 4). */
  sprite: number;
  /** Sub-action of a gather/hunt/attack action: done and failed keep the sprite, a lost target is reported. */
  sub: boolean;
}

/** User waypoint: tile coordinates truncated to bytes (movement.md §5 step 2). */
export interface UserWaypoint {
  x: number;
  y: number;
  z: number;
}

/** Per-unit movement state (`RGE_Moving_Object` fields). All of it is game state: snapshotted and hashed. */
export interface Mover {
  angle: number;
  facet: number;
  /** Current speed; 0 means "not moving" and makes the next step restart from the maximum speed. */
  speed: number;
  turnTimer: number;
  collisionAvoidanceDistance: number;
  lastFacet: number;
  lastFacet2: number;
  closestDistanceToWaypoint: number;
  continueCounter: number;
  numberWaitDelays: number;
  waitingToMove: boolean;
  goalX: number;
  goalY: number;
  goalZ: number;
  actionRange: number;
  /** `targetIDValue` and the target's radii, set by the move action (movement.md §5 step 2). */
  targetId: number;
  targetRadiusX: number;
  targetRadiusY: number;
  path: Waypoint[];
  pathIndex: number;
  userWaypoints: UserWaypoint[];
  /** Never cleared by arrival, only by adding a waypoint (movement.md §5; `removeAllUserDefinedWaypoints` keeps it). */
  finalUserWaypoint: boolean;
  /** Ids of the other units ordered with this one (pathing group). */
  group: number[];
  action: MoveAction | null;
}

export function newMover(): Mover {
  return {
    angle: 0,
    facet: 0,
    speed: 0,
    turnTimer: 0,
    collisionAvoidanceDistance: 0,
    lastFacet: 0xff,
    lastFacet2: 0xff,
    closestDistanceToWaypoint: FAR,
    continueCounter: 0,
    numberWaitDelays: 0,
    waitingToMove: false,
    goalX: 0,
    goalY: 0,
    goalZ: 0,
    actionRange: 0,
    targetId: -1,
    targetRadiusX: 0,
    targetRadiusY: 0,
    path: [],
    pathIndex: 0,
    userWaypoints: [],
    finalUserWaypoint: false,
    group: [],
    action: null,
  };
}

export function copyMover(m: Mover): Mover {
  return {
    ...m,
    path: m.path.map((w) => ({ ...w })),
    userWaypoints: m.userWaypoints.map((w) => ({ ...w })),
    group: [...m.group],
    action: m.action && { ...m.action },
  };
}

/** What a moving unit needs from the world while it updates. */
export interface MoveContext extends PlayerMasters, VisibilityContext {
  map: TileMap;
  entities: EntityStore;
  pathing: PathingSystem;
  rng: CrtRand;
  /** `world_time_delta_seconds`. */
  deltaSeconds: number;
  /** Path searches the owner has started this step (reset per player update). */
  attempts: number;
}

/**
 * `RGE_Static_Object::lookupZone(x, y)` (src/stat_obj.cpp:2994): the zone of tile (x, y) in the zone map of the object's
 * terrain restriction; 0 for a negative tile.
 */
export function lookupZone(ctx: Pick<MoveContext, 'pathing' | 'masters'>, e: Entity, x: number, y: number): number {
  if (x < 0 || y < 0) return 0;
  return ctx.pathing.zones.of(typeOf(ctx, e)).at(ctx.pathing.map.width, x, y);
}

/**
 * `RGE_Moving_Object::firstTileAlongLine(s, d, r, t1, t2, 1)` (src/move_obj.cpp:1866): in twice as many half steps as
 * the longer axis has tiles, from tile s towards tile d, the first new tile of terrain t1 or t2 the object could stand on
 * (at the stepped point); null when there is none or s is d.
 */
export function firstTileAlongLine(ctx: MoveContext, e: Entity, sx: number, sy: number, dx: number, dy: number, t1: number, t2: number): [number, number] | null {
  const xDistance = f32(dx - sx);
  const yDistance = f32(dy - sy);
  if (xDistance === 0 && yDistance === 0) return null;
  const numSteps = Math.abs(yDistance) > Math.abs(xDistance) ? Math.abs(toInt(yDistance)) * 2 : Math.abs(toInt(xDistance)) * 2;
  const xStep = div32(xDistance, numSteps);
  const yStep = div32(yDistance, numSteps);
  const t = typeOf(ctx, e);
  let xTile = f32(sx);
  let yTile = f32(sy);
  let lastX = -999;
  let lastY = -999;
  for (let i = 0; i < numSteps; i++) {
    xTile = add32(xTile, xStep);
    yTile = add32(yTile, yStep);
    const tx = toInt(xTile);
    const ty = toInt(yTile);
    if (tx === lastX && ty === lastY) continue;
    lastX = tx;
    lastY = ty;
    const terrain = ctx.map.terrainAt(tx, ty);
    if ((terrain === t1 || terrain === t2) && ctx.pathing.passable(e, t, xTile, yTile)) return [tx, ty];
  }
  return null;
}

/** Wrap into [0, 2pi] and, unless `facets` is -1, snap to the facet grid (`boundAngle`, movement.md §9). */
export function boundAngle(angle: number, facets: number): number {
  let a = angle;
  if (a < 0) {
    do a = sub32(a, -TWO_PI_F);
    while (a < 0);
  } else {
    while (a > TWO_PI_F) a = sub32(a, TWO_PI_F);
  }
  if (facets === -1) return a;
  const step = facets === 8 ? QUARTER_PI_F : FACET_ANGLE_F;
  let best = step;
  let bestFacet = -1;
  for (let i = 0; i <= facets; i++) {
    let diff = sub32(a, mul32(i, step));
    if (diff < 0) diff = -diff;
    if (diff < best) {
      best = diff;
      bestFacet = i;
    }
    if (best < ANGLE_TOLERANCE) break;
  }
  return mul32(bestFacet, step);
}

/** Sprite facet of an angle; facet 0 is centred on pi/4 (`set_angle`, movement.md §9). */
export function facetOf(angle: number, sprite: SpriteInfo | null): number {
  if (!sprite || !sprite.hasFacings || sprite.facets <= 0) return 0;
  let t = sub32(angle, QUARTER_PI_F);
  t = mul32(t, sprite.facets);
  t = mul32(t, INV_FULL_CIRCLE);
  t = sub32(t, -HALF);
  if (t < 0) t = add32(t, sprite.facets);
  return toInt(t) & 0xff;
}

/** The object's main sprite (its master's standing sprite before one is shown). */
export function currentSprite(e: Entity, t: UnitType): SpriteInfo {
  return e.sprite ? spriteInfo(e.sprite.graphic) : t.standing;
}

/** `maximumSpeed`: speed times the current sprite's base speed when that is positive. */
export function maximumSpeed(e: Entity, t: UnitType): number {
  const s = currentSprite(e, t);
  return s.baseSpeed > 0 ? mul32(t.speed, s.baseSpeed) : t.speed;
}

/** Facing drawn at creation: one `rand()` when the sprite has facings (movement.md §9, §11). */
export function initialFacing(e: Entity, t: UnitType, m: Mover, rng: CrtRand): void {
  const s = currentSprite(e, t);
  m.angle = 0;
  if (s.hasFacings && s.facets > 1) {
    const k = Math.trunc((rng.rand() * s.facets) / 0x7fff);
    let a = f32((FULL_CIRCLE / s.facets) * k);
    if (a < 0) a = sub32(a, -TWO_PI_F);
    else if (a > TWO_PI_F) a = sub32(a, TWO_PI_F);
    m.angle = a;
  }
  m.facet = facetOf(m.angle, s);
}

/** Tile centre of a coordinate, as the original writes it: `(float)floor(x) - (-0.5)`. */
function centre(v: number): number {
  return f32(Math.floor(v) + 0.5);
}

function length32(dx: number, dy: number): number {
  return sqrt32(add32(mul32(dx, dx), mul32(dy, dy)));
}

/**
 * `teleport`: unstamp, clamp to the map, move, restamp (movement.md §4). z is the ground's height there (`rz`,
 * `TileMap.groundZ`) for a ground object; a flying one (`movement_type` 1) keeps the given z unless the ground is
 * higher. Returns `rz`. `new_location` moves the line of sight (visibility.md §3.2): on a new tile it is removed at
 * the old position, then added at the new one if the object is active. `placed` is the first placement of a new
 * object, which has no old position.
 */
export function teleport(ctx: MoveContext, e: Entity, t: UnitType, x: number, y: number, z: number, placed = false): number {
  ctx.pathing.unstamp(e, t);
  const maxX = sub32(ctx.map.width, MAP_EDGE);
  const maxY = sub32(ctx.map.height, MAP_EDGE);
  const nx = f32(Math.min(Math.max(x, 0), maxX));
  const ny = f32(Math.min(Math.max(y, 0), maxY));
  const moved = placed || tileOf(nx, ctx.map.width) !== tileOf(e.x, ctx.map.width) || tileOf(ny, ctx.map.height) !== tileOf(e.y, ctx.map.height);
  if (moved && !placed) unexploreObject(ctx, e, t, false);
  e.x = nx;
  e.y = ny;
  const rz = ctx.map.groundZ(nx, ny);
  e.z = !t.flying || rz > f32(z) ? rz : f32(z);
  if (moved && e.state === ObjectState.Active) exploreObject(ctx, e, t, false);
  // `RGE_Combat_Object::teleport`: the object's visible-unit records follow it to its new tile.
  if (moved && !placed && t.masterType >= 50) ctx.visibility?.moveRecords(e.id, t.group, toInt(e.x), toInt(e.y));
  ctx.pathing.stamp(e, t);
  return rz;
}

/** The tile index of a coordinate, clamped to the map (src/stat_obj.cpp:1503-1511). */
function tileOf(v: number, size: number): number {
  return Math.min(Math.max(toInt(v), 0), size - 1);
}

function pathingAllowed(ctx: MoveContext, m: Mover): boolean {
  return m.numberWaitDelays > PATHING_DELAY_CAP || ctx.attempts < PATHING_CAP;
}

function currentWaypoint(m: Mover): Waypoint | null {
  return m.pathIndex > -1 && m.pathIndex < m.path.length ? m.path[m.pathIndex]! : null;
}

/** `Path::moveToNextWaypoint`: advance unless at the last waypoint. */
function nextWaypoint(m: Mover): boolean {
  if (m.pathIndex < m.path.length - 1) {
    m.pathIndex++;
    return true;
  }
  m.pathIndex = m.path.length - 1;
  return false;
}

/** Search from the unit's tile to its first user waypoint, or the goal tile. */
function search(ctx: MoveContext, e: Entity, t: UnitType, m: Mover): boolean {
  const first = m.userWaypoints[0];
  const gx = first ? first.x : toInt(m.goalX);
  const gy = first ? first.y : toInt(m.goalY);
  const r = ctx.pathing.findTilePath(e, t, toInt(e.x), toInt(e.y), gx, gy, m.actionRange, m.targetId);
  m.path = r.path;
  m.pathIndex = 0;
  return r.found;
}

function atCentre(e: Entity): boolean {
  return e.x - Math.floor(e.x) === 0.5 && e.y - Math.floor(e.y) === 0.5;
}

/** `findPath` results used here: `PathFound`, `WaitingOnPathingCap`. */
const PathResult = { Found: 0, Waiting: 1 } as const;
type PathResult = (typeof PathResult)[keyof typeof PathResult];

/** `findPath` (movement.md §6): the first search of a move. */
function findPath(ctx: MoveContext, e: Entity, t: UnitType, m: Mover): PathResult {
  if (t.radiusZ <= 0) {
    m.waitingToMove = false;
    m.group = [];
    m.path = [
      { x: e.x, y: e.y, z: e.z, facet: 0xff },
      { x: m.goalX, y: m.goalY, z: m.goalZ, facet: 0xff },
    ];
    m.pathIndex = 1;
    m.closestDistanceToWaypoint = FAR;
    return PathResult.Found;
  }
  if (!pathingAllowed(ctx, m)) {
    m.numberWaitDelays++;
    return PathResult.Waiting;
  }
  ctx.attempts++;
  m.numberWaitDelays = 0;
  m.waitingToMove = false;
  m.continueCounter = m.userWaypoints.length + CONTINUE_PATHS_HUMAN;
  m.closestDistanceToWaypoint = FAR;
  const found = search(ctx, e, t, m);
  if (!found && m.path.length === 1) {
    const cx = centre(e.x);
    const cy = centre(e.y);
    if (ctx.pathing.passable(e, t, cx, cy) && !atCentre(e)) {
      teleport(ctx, e, t, cx, cy, e.z);
      return PathResult.Waiting;
    }
  }
  m.pathIndex = 0;
  nextWaypoint(m);
  return PathResult.Found;
}

/** Drop user waypoints from the front until one is out of reach; false when none is left (movement.md §8.1 step 5). */
function dropReachedUserWaypoints(e: Entity, m: Mover, radiusDistance: number): boolean {
  for (;;) {
    m.userWaypoints.shift();
    const next = m.userWaypoints[0];
    if (!next) return false;
    const d = length32(sub32(next.x, e.x), sub32(next.y, e.y));
    if (sub32(add32(radiusDistance, m.actionRange), RANGE_SLACK) < d) return true;
  }
}

/** Stop this step; with fewer than two user waypoints the move fails (0), else retry later (1). */
function stall(m: Mover): number {
  m.speed = 0;
  if (m.userWaypoints.length < 2) return 0;
  m.continueCounter += 5;
  return 1;
}

/** Repath from the unit's position inside `doMove`; returns a doMove result, or null to go on stepping. */
function repath(ctx: MoveContext, e: Entity, t: UnitType, m: Mover): number | null {
  if (!pathingAllowed(ctx, m)) {
    m.speed = 0;
    m.numberWaitDelays++;
    return 1;
  }
  ctx.attempts++;
  m.numberWaitDelays = 0;
  const found = search(ctx, e, t, m);
  m.group = [];
  if (!found && m.path.length === 1) {
    const cx = centre(e.x);
    const cy = centre(e.y);
    if (!ctx.pathing.passable(e, t, cx, cy) || atCentre(e)) return stall(m);
    teleport(ctx, e, t, cx, cy, e.z);
  }
  m.pathIndex = 0;
  if (!nextWaypoint(m)) return stall(m);
  return null;
}

/** Turn towards (dx, dy) by whole facets while off by more than `threshold` facets. */
function turnLoop(t: UnitType, m: Mover, angleDelta: number, facetDelta: number, facets: number, threshold: number, stopOnTimer: boolean) {
  const step = f32(FULL_CIRCLE / facets);
  let fd = facetDelta;
  while ((stopOnTimer || m.turnTimer <= 0) && (fd > threshold || fd < -threshold)) {
    m.turnTimer = add32(m.turnTimer, t.turnSpeed);
    if (angleDelta >= 0) {
      fd = sub32(fd, 1);
      m.angle = add32(m.angle, step);
    } else {
      fd = sub32(fd, -1);
      m.angle = sub32(m.angle, step);
    }
    if (stopOnTimer && m.turnTimer > 0) break;
  }
}

/**
 * `doTrivialMove(x, y)` (movement.md §8.2-8.5): turn, step, collide. Returns 0 moved or waiting, 1 stop this step
 * (pathing cap), 2 waypoint unreachable, 4 give up, 5 arrived.
 */
export function doTrivialMove(ctx: MoveContext, e: Entity, t: UnitType, m: Mover, x: number, y: number): number {
  let alreadyMoving = true;
  if (m.speed === 0) {
    alreadyMoving = false;
    m.speed = maximumSpeed(e, t);
  }
  const distance = mul32(ctx.deltaSeconds, m.speed);
  if (m.collisionAvoidanceDistance > 0) {
    m.collisionAvoidanceDistance = sub32(m.collisionAvoidanceDistance, distance);
    if (m.collisionAvoidanceDistance > 0) {
      m.speed = 0;
      return 0;
    }
    m.collisionAvoidanceDistance = -1;
  }
  if (t.turnSpeed > 0) m.turnTimer = m.turnTimer >= 0 ? sub32(m.turnTimer, ctx.deltaSeconds) : 0;
  const sprite = currentSprite(e, t);
  const facets = sprite.facets;

  let dx = alreadyMoving ? sub32(x, e.x) : sub32(x, centre(e.x));
  let dy = alreadyMoving ? sub32(y, e.y) : sub32(y, centre(e.y));
  let target = boundAngle(f32(atan2(dy, dx)), -1);
  let angleDelta = sub32(target, m.angle);
  while (angleDelta < -PI_D) angleDelta = sub32(angleDelta, -TWO_PI_F);
  while (angleDelta > PI_D) angleDelta = sub32(angleDelta, TWO_PI_F);
  let facetDelta = mul32(mul32(angleDelta, facets), INV_FULL_CIRCLE);
  m.angle = boundAngle(m.angle, facets);
  turnLoop(t, m, angleDelta, facetDelta, facets, 0.8, false);
  m.angle = boundAngle(m.angle, facets);
  m.facet = facetOf(m.angle, sprite);
  let vx = mul32(f32(cos(m.angle)), distance);
  let vy = mul32(f32(sin(m.angle)), distance);
  let nx = add32(e.x, vx);
  let ny = add32(e.y, vy);

  if (t.radiusZ > 0 && !ctx.pathing.passable(e, t, nx, ny)) {
    if (m.collisionAvoidanceDistance === 0) return collisionWait(ctx, m);
    // Already waited once: snap to the tile centre, then repath and try the new heading (movement.md §8.3).
    m.collisionAvoidanceDistance = 0;
    const cx = centre(e.x);
    const cy = centre(e.y);
    if (ctx.pathing.passable(e, t, cx, cy)) teleport(ctx, e, t, cx, cy, e.z);
    const goal = m.targetId === -1 ? undefined : ctx.entities.get(m.targetId);
    if (goal) {
      const reach = sub32(add32(length32(t.radiusX, t.radiusY), m.actionRange), RANGE_SLACK);
      if (length32(sub32(goal.x, e.x), sub32(goal.y, e.y)) < reach) return 5;
    }
    if (!ctx.pathing.passable(e, t, x, y)) return 2;
    m.continueCounter--;
    if (m.continueCounter < 1) return 4;
    if (!pathingAllowed(ctx, m)) {
      m.numberWaitDelays++;
      return 1;
    }
    ctx.attempts++;
    m.numberWaitDelays = 0;
    const found = search(ctx, e, t, m);
    if (!found && m.path.length === 1) {
      const sx = centre(e.x);
      const sy = centre(e.y);
      if (ctx.pathing.passable(e, t, sx, sy)) {
        if (atCentre(e)) return 4;
        teleport(ctx, e, t, sx, sy, e.z);
      }
    }
    m.pathIndex = 0;
    if (!nextWaypoint(m)) return 4;
    m.closestDistanceToWaypoint = FAR;
    const wp = currentWaypoint(m)!;
    dx = alreadyMoving ? sub32(wp.x, e.x) : sub32(wp.x, centre(e.x));
    dy = alreadyMoving ? sub32(wp.y, e.y) : sub32(wp.y, centre(e.y));
    target = boundAngle(f32(atan2(dy, dx)), -1);
    // No wrap into [-pi, pi] on this path.
    angleDelta = sub32(target, m.angle);
    facetDelta = mul32(mul32(angleDelta, facets), INV_FULL_CIRCLE);
    if (m.turnTimer > 0) {
      m.speed = 0;
      return 0;
    }
    turnLoop(t, m, angleDelta, facetDelta, facets, 0.9, true);
    m.angle = boundAngle(m.angle, facets);
    m.facet = facetOf(m.angle, sprite);
    vx = mul32(f32(cos(m.angle)), distance);
    vy = mul32(f32(sin(m.angle)), distance);
    nx = add32(e.x, vx);
    ny = add32(e.y, vy);
    if (!ctx.pathing.passable(e, t, nx, ny)) return collisionWait(ctx, m);
  }

  // Waypoint arrival (movement.md §8.4).
  const zBefore = e.z;
  const wp = currentWaypoint(m);
  let cur: number;
  if (wp) {
    cur = length32(sub32(wp.x, e.x), sub32(wp.y, e.y));
    const after = length32(sub32(wp.x, nx), sub32(wp.y, ny));
    const overshoot = m.closestDistanceToWaypoint < after && cur < SNAP_CLOSE;
    const zigzag = m.lastFacet2 === m.facet && m.lastFacet2 !== m.lastFacet && cur < HALF;
    if (overshoot || zigzag) {
      if (!ctx.pathing.passable(e, t, wp.x, wp.y)) return 2;
      teleport(ctx, e, t, wp.x, wp.y, wp.z);
    } else {
      teleport(ctx, e, t, nx, ny, e.z);
    }
  } else {
    cur = length32(sub32(y, ny), sub32(x, nx));
    teleport(ctx, e, t, nx, ny, e.z);
  }

  // Speed for the next step (movement.md §8.5).
  const slope = sub32(zBefore, e.z);
  let multiplier = f32(1);
  m.lastFacet2 = m.lastFacet;
  m.lastFacet = m.facet;
  m.closestDistanceToWaypoint = cur;
  if (slope < -0.02) multiplier = CLIMB;
  else if (slope > 0.02) multiplier = DESCEND;
  else m.speed = maximumSpeed(e, t);
  multiplier = mul32(multiplier, terrainSpeed(ctx, e, t));
  if (multiplier > 0) m.speed = mul32(m.speed, multiplier);
  return 0;
}

/** First blocked step: wait `0.1 * (rand() % 6) + 0.5 / speed` tiles of travel (movement.md §8.3). */
function collisionWait(ctx: MoveContext, m: Mover): number {
  const k = mul32(ctx.rng.rand() % 6, WAIT_STEP);
  m.collisionAvoidanceDistance = m.speed > 0 ? sub32(k, div32(-HALF, m.speed)) : sub32(k, -HALF);
  m.speed = 0;
  return 0;
}

function terrainSpeed(ctx: MoveContext, e: Entity, t: UnitType): number {
  const terrain = ctx.map.terrainAt(toInt(e.x), toInt(e.y)) & 0x1f;
  return t.terrainTable[terrain] ?? 0;
}

/** `doMove` (movement.md §8.1). Returns 0 failed, 1 continue, 2 arrived. */
function doMove(ctx: MoveContext, e: Entity, t: UnitType, m: Mover): number {
  m.waitingToMove = false;
  let dX = sub32(m.goalX, e.x);
  let dY = sub32(m.goalY, e.y);
  if (dX < 0) dX = -dX;
  if (dY < 0) dY = -dY;
  dX = sub32(dX, add32(m.targetRadiusX, t.radiusX));
  dY = sub32(dY, add32(m.targetRadiusY, t.radiusY));
  if (dX < 0) dX = 0;
  if (dY < 0) dY = 0;
  const distanceToGoal = length32(dX, dY);
  if (m.actionRange > 0 && distanceToGoal <= m.actionRange) {
    m.speed = 0;
    m.userWaypoints = [];
    m.group = [];
    return 2;
  }
  if (distanceToGoal < 0.5) {
    const wp = currentWaypoint(m);
    const trivialDistance = wp ? length32(sub32(wp.x, e.x), sub32(wp.y, e.y)) : distanceToGoal;
    if (trivialDistance === 0) {
      m.group = [];
      return 2;
    }
    const r = doTrivialMove(ctx, e, t, m, m.goalX, m.goalY);
    if (r === 0) return 1;
    if (r === 1 || r === 6) {
      m.speed = 0;
      return 1;
    }
    if (r !== 5) m.speed = 0;
    m.userWaypoints = [];
    m.group = [];
    return 2;
  }

  const radiusDistance = length32(t.radiusY, t.radiusX);
  let more = true;
  const wp = currentWaypoint(m);
  if (!wp) more = false;
  else if (length32(sub32(wp.x, e.x), sub32(wp.y, e.y)) === 0) {
    if (ctx.pathing.passable(e, t, wp.x, wp.y)) teleport(ctx, e, t, wp.x, wp.y, wp.z);
    more = nextWaypoint(m);
    m.closestDistanceToWaypoint = FAR;
  }
  // Two user waypoints in one zone add 3 tiles to the arrival range (src/move_obj.cpp:763-770).
  let extra = 0;
  if (m.userWaypoints.length > 1 && distanceToGoal > WAYPOINT_DISTANCE_THRESHOLD) {
    const [first, second] = m.userWaypoints;
    if (lookupZone(ctx, e, toInt(first!.x), toInt(first!.y)) === lookupZone(ctx, e, toInt(second!.x), toInt(second!.y))) extra = 3;
  }
  if (!more) {
    if (distanceToGoal <= add32(add32(extra, radiusDistance), m.actionRange)) {
      m.speed = 0;
      m.userWaypoints = [];
      m.group = [];
      return 2;
    }
    if (!dropReachedUserWaypoints(e, m, radiusDistance)) return 0;
    const before = m.continueCounter;
    m.continueCounter = before - 1;
    if (m.continueCounter < 1) {
      m.speed = 0;
      if (m.userWaypoints.length < 2) return 0;
      m.continueCounter = before + 4;
      return 1;
    }
    const r = repath(ctx, e, t, m);
    if (r !== null) return r;
    m.closestDistanceToWaypoint = FAR;
  }

  const target = currentWaypoint(m);
  if (!target) return stall(m);
  const r = doTrivialMove(ctx, e, t, m, target.x, target.y);
  if (r === 5) {
    m.userWaypoints = [];
    m.group = [];
    return 2;
  }
  if (r === 0) return 1;
  if (r === 1) {
    m.speed = 0;
    return 1;
  }
  if (r === 2) {
    if (nextWaypoint(m)) return 1;
    if (!dropReachedUserWaypoints(e, m, radiusDistance)) return 0;
    const rr = repath(ctx, e, t, m);
    return rr ?? 1;
  }
  return stall(m);
}

/** `RGE_Static_Object::inRange` (src/stat_obj.cpp:2268): edge-to-edge distance strictly below `range`. */
export function inRange(ctx: PlayerMasters, e: Entity, target: Entity, range: number): boolean {
  const a = typeOf(ctx, e);
  const b = typeOf(ctx, target);
  let dX = sub32(target.x, e.x);
  let dY = sub32(target.y, e.y);
  if (dX < 0) dX = -dX;
  if (dY < 0) dY = -dY;
  let x = sub32(sub32(dX, a.radiusX), b.radiusX);
  let y = sub32(sub32(dY, a.radiusY), b.radiusY);
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  return add32(mul32(x, x), mul32(y, y)) < mul32(range, range);
}

/** The master's move sprite, or its standing sprite (`RGE_Action_Move_To` ctor, src/act_move.cpp:35-41). */
function defaultMoveSprite(t: UnitType): number {
  return (t.walking ?? t.standing).graphic;
}

/**
 * Make an `RGE_Action_Move_To` to a target object or point and run its `first_in_stack` (movement.md §5): already
 * in range of the target → done, cannot move → failed, else state 3. A range <= 0 becomes 0.4; a null sprite the
 * master's move sprite.
 */
export function startMoveTo(
  e: Entity,
  target: Entity | null,
  x: number,
  y: number,
  z: number,
  range: number,
  sprite: SpriteInfo | null,
  sub: boolean,
  ctx: SpriteContext,
): MoveAction | null {
  const m = e.mover;
  if (!m) return null;
  const t = typeOf(ctx, e);
  const r = range <= 0 ? MOVE_RANGE : f32(range);
  m.action = {
    state: MOVE_NEED_PATH,
    x: f32(target ? target.x : x),
    y: f32(target ? target.y : y),
    z: f32(target ? target.z : z),
    range: r,
    target: target ? target.id : -1,
    sprite: sprite ? sprite.graphic : defaultMoveSprite(t),
    sub,
  };
  if (target && inRange(ctx, e, target, r)) setState(ctx, e, MOVE_DONE);
  else if (maximumSpeed(e, t) === 0) setState(ctx, e, MOVE_FAILED);
  return m.action;
}

/** Give `e` a new move order to (x, y): `move_to` replaces the current action (movement.md §5). */
export function orderMove(ctx: SpriteContext, e: Entity, x: number, y: number): void {
  const m = e.mover;
  if (!m) return;
  // The old action's destructor clears user waypoints and stops the unit.
  endAction(m);
  startMoveTo(e, null, x, y, 0, MOVE_RANGE, null, false, ctx);
}

/**
 * `RGE_Action_Move_To::set_state`: moving shows the move sprite; done or failed show the standing sprite again unless
 * this is a sub-action. A sprite that actually changes is a new active sprite (docs/spec/sprites.md §2, §4).
 */
function setState(ctx: SpriteContext, e: Entity, state: number): void {
  const a = e.mover!.action!;
  a.state = state;
  if (state === MOVE_MOVING) newSprite(ctx, e, spriteInfo(a.sprite));
  else if ((state === MOVE_DONE || state === MOVE_FAILED) && !a.sub) newSprite(ctx, e, null);
}

/** End the action: the list drops it, its destructor clears user waypoints and stops the unit. */
export function endAction(m: Mover): void {
  m.action = null;
  m.userWaypoints = [];
  m.speed = 0;
}

/** The target moved more than a tile on either axis from the stored goal (src/act_move.cpp:182-188). */
function targetMoved(a: MoveAction, target: Entity | undefined): boolean {
  if (!target) return false;
  const dx = sub32(a.x, target.x);
  const dy = sub32(a.y, target.y);
  return dx < -1 || dx > 1 || dy < -1 || dy > 1;
}

/**
 * `RGE_Action_Move_To::update` (movement.md §5), once per step for a unit whose current action (or sub-action) is a
 * move. A top-level move that completes or fails is ended here.
 */
export function updateMover(ctx: MoveContext, e: Entity): ActionResult {
  const m = e.mover;
  if (!m?.action) return ActionResult.Remove;
  const r = updateMoveTo(ctx, e, m, m.action);
  if (!m.action.sub && r !== ActionResult.Continue) endAction(m);
  return r;
}

function updateMoveTo(ctx: MoveContext, e: Entity, m: Mover, action: MoveAction): ActionResult {
  const t = typeOf(ctx, e);
  let target: Entity | undefined;
  if (action.target !== -1) {
    target = ctx.entities.get(action.target);
    if (!target || target.state >= ObjectState.PendingRemoval) {
      action.target = -1;
      return action.sub ? ActionResult.TargetLost : ActionResult.TargetInvalid;
    }
  }
  switch (action.state) {
    case MOVE_NEED_PATH: {
      if (target && inRange(ctx, e, target, action.range)) {
        setState(ctx, e, MOVE_DONE);
        m.waitingToMove = false;
        m.group = [];
        return ActionResult.Completed;
      }
      if (target) {
        action.x = target.x;
        action.y = target.y;
        action.z = target.z;
      }
      m.goalX = action.x;
      m.goalY = action.y;
      m.goalZ = action.z;
      if (!m.finalUserWaypoint) {
        // Truncated to bytes: a negative coordinate wraps to 255 (movement.md §5 step 4).
        m.userWaypoints.push({ x: toInt(action.x) & 0xff, y: toInt(action.y) & 0xff, z: toInt(action.z) & 0xff });
        m.finalUserWaypoint = true;
      }
      m.actionRange = action.range;
      const tt = target && typeOf(ctx, target);
      m.targetId = target ? target.id : -1;
      m.targetRadiusX = tt ? tt.radiusX : 0;
      m.targetRadiusY = tt ? tt.radiusY : 0;
      if (findPath(ctx, e, t, m) === PathResult.Found) setState(ctx, e, MOVE_MOVING);
      return ActionResult.Continue;
    }
    case MOVE_MOVING: {
      if (targetMoved(action, target)) return retarget(ctx, e, m, action);
      const r = doMove(ctx, e, t, m);
      if (r === 0) {
        setState(ctx, e, MOVE_DONE);
        return ActionResult.Failed;
      }
      if (r === 2) {
        if (targetMoved(action, target)) return retarget(ctx, e, m, action);
        setState(ctx, e, MOVE_DONE);
        return ActionResult.Completed;
      }
      return ActionResult.Continue;
    }
    case MOVE_DONE:
      return ActionResult.Remove;
    default:
      setState(ctx, e, action.state);
      return ActionResult.Failed;
  }
}

/** The target moved: back to state 3 and update twice more in the same step (src/act_move.cpp:223-228). */
function retarget(ctx: MoveContext, e: Entity, m: Mover, action: MoveAction): ActionResult {
  action.state = MOVE_NEED_PATH;
  updateMoveTo(ctx, e, m, action);
  updateMoveTo(ctx, e, m, action);
  return ActionResult.Continue;
}
