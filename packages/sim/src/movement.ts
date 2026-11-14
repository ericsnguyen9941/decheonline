/**
 * Moving units: the move action, `findPath`, `doMove` and `doTrivialMove` (docs/spec/movement.md §5, §6, §8, §9).
 * Every float store is rounded to float32 (core.md §3). Trig goes through the deterministic `trig.ts`.
 */
import type { Entity, EntityStore } from './entities';
import type { TileMap } from './map';
import { add32, div32, f32, mul32, sqrt32, sub32, toInt } from './num';
import type { PathingSystem, Waypoint } from './pathing';
import type { CrtRand } from './rng';
import { atan2, cos, sin } from './trig';
import { unitType, type SpriteInfo, type UnitType } from './units';

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

export interface MoveAction {
  state: number;
  x: number;
  y: number;
  z: number;
  range: number;
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
  /** The current sprite is the walking (move) sprite, else the standing one. */
  walking: boolean;
  turnTimer: number;
  collisionAvoidanceDistance: number;
  lastFacet: number;
  lastFacet2: number;
  closestDistanceToWaypoint: number;
  continueCounter: number;
  numberWaitDelays: number;
  waitingToMove: boolean;
  /** Footprint is in the obstruction map. */
  stamped: boolean;
  goalX: number;
  goalY: number;
  goalZ: number;
  actionRange: number;
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
    walking: false,
    turnTimer: 0,
    collisionAvoidanceDistance: 0,
    lastFacet: 0xff,
    lastFacet2: 0xff,
    closestDistanceToWaypoint: FAR,
    continueCounter: 0,
    numberWaitDelays: 0,
    waitingToMove: false,
    stamped: false,
    goalX: 0,
    goalY: 0,
    goalZ: 0,
    actionRange: 0,
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
export interface MoveContext {
  map: TileMap;
  entities: EntityStore;
  pathing: PathingSystem;
  rng: CrtRand;
  /** `world_time_delta_seconds`. */
  deltaSeconds: number;
  /** Path searches the owner has started this step (reset per player update). */
  attempts: number;
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

export function currentSprite(t: UnitType, m: Mover): SpriteInfo {
  return m.walking ? (t.walking ?? t.standing) : t.standing;
}

/** `maximumSpeed`: speed times the current sprite's base speed when that is positive. */
export function maximumSpeed(t: UnitType, m: Mover): number {
  const s = currentSprite(t, m);
  return s.baseSpeed > 0 ? mul32(t.speed, s.baseSpeed) : t.speed;
}

/** Facing drawn at creation: one `rand()` when the sprite has facings (movement.md §9, §11). */
export function initialFacing(t: UnitType, m: Mover, rng: CrtRand): void {
  const s = currentSprite(t, m);
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
 * `teleport`: unstamp, clamp to the map, move, restamp (movement.md §4). The map is flat (no elevation drawing or
 * slope heights yet), so z is kept as given.
 */
export function teleport(ctx: MoveContext, e: Entity, t: UnitType, x: number, y: number, z: number): void {
  ctx.pathing.unstamp(e, t);
  const maxX = sub32(ctx.map.width, MAP_EDGE);
  const maxY = sub32(ctx.map.height, MAP_EDGE);
  e.x = f32(Math.min(Math.max(x, 0), maxX));
  e.y = f32(Math.min(Math.max(y, 0), maxY));
  e.z = f32(z);
  ctx.pathing.stamp(e, t);
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
  const r = ctx.pathing.findTilePath(e, t, toInt(e.x), toInt(e.y), gx, gy, m.actionRange);
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
    m.speed = maximumSpeed(t, m);
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
  const sprite = currentSprite(t, m);
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
  else m.speed = maximumSpeed(t, m);
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
  // No target object: target radii are 0.
  dX = sub32(dX, t.radiusX);
  dY = sub32(dY, t.radiusY);
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
  // The 3-tile extra range needs two user waypoints in one zone; zones are not ported and no order gives two yet.
  const extra = 0;
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

/** Give `e` a new move order to (x, y): `move_to` replaces the current action (movement.md §5). */
export function orderMove(e: Entity, x: number, y: number, rng: CrtRand): void {
  const m = e.mover;
  if (!m) return;
  const t = unitType(e.type);
  // The old action's destructor clears user waypoints and stops the unit.
  m.userWaypoints = [];
  m.speed = 0;
  m.action = { state: MOVE_NEED_PATH, x: f32(x), y: f32(y), z: 0, range: MOVE_RANGE };
  if (maximumSpeed(t, m) === 0) setState(m, t, MOVE_FAILED, rng);
}

/**
 * `RGE_Action_Move_To::set_state`: moving shows the move sprite, done or failed the standing one again. A sprite that
 * actually changes is a new active sprite, which draws its random start frame (docs/spec/sprites.md §4).
 */
function setState(m: Mover, t: UnitType, state: number, rng: CrtRand): void {
  m.action!.state = state;
  const walking = state === MOVE_MOVING ? true : state === MOVE_DONE || state === MOVE_FAILED ? false : m.walking;
  if (walking === m.walking) return;
  m.walking = walking;
  if (t.walking) showSprite(currentSprite(t, m), rng);
}

/** A new active sprite of `s` (`RGE_Active_Animated_Sprite`): one `rand()` for a random start frame. */
export function showSprite(s: SpriteInfo, rng: CrtRand): void {
  // The frame it picks is animation state the sim does not keep yet; the draw is what other rules see.
  if (s.randomStart) rng.rand();
}

/** End the action: the list drops it, its destructor clears user waypoints and stops the unit. */
function endAction(m: Mover): void {
  m.action = null;
  m.userWaypoints = [];
  m.speed = 0;
}

/** `RGE_Action_Move_To::update` (movement.md §5), once per step for a unit with a move action. */
export function updateMover(ctx: MoveContext, e: Entity): void {
  const m = e.mover;
  const action = m?.action;
  if (!m || !action) return;
  const t = unitType(e.type);
  switch (action.state) {
    case MOVE_NEED_PATH: {
      m.goalX = action.x;
      m.goalY = action.y;
      m.goalZ = action.z;
      if (!m.finalUserWaypoint) {
        // Truncated to bytes: a negative coordinate wraps to 255 (movement.md §5 step 4).
        m.userWaypoints.push({ x: toInt(action.x) & 0xff, y: toInt(action.y) & 0xff, z: toInt(action.z) & 0xff });
        m.finalUserWaypoint = true;
      }
      m.actionRange = action.range;
      if (findPath(ctx, e, t, m) === PathResult.Found) setState(m, t, MOVE_MOVING, ctx.rng);
      return;
    }
    case MOVE_MOVING: {
      const r = doMove(ctx, e, t, m);
      if (r === 0 || r === 2) {
        setState(m, t, MOVE_DONE, ctx.rng);
        endAction(m);
      }
      return;
    }
    default:
      setState(m, t, action.state, ctx.rng);
      endAction(m);
  }
}
