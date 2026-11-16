/**
 * Buildings and training (docs/spec/economy.md §4-6): placement checks, foundations, build points and completion,
 * cancelling, costs, the production queue and the train action with its placement of the new unit.
 * Every float store is rounded to float32.
 */
import type { GameContext } from './context';
import { ObjectState, type Entity } from './entities';
import { ActionResult, facetOf } from './movement';
import { add32, div32, f32, mul32, sub32 } from './num';
import { newSprite } from './sprites';
import { buildingFacet, doTech } from './techs';
import { hasMaster, master, typeOf } from './masters';
import { spriteInfo, type SpriteInfo, type UnitType } from './units';
import { exploreObject, TILE_BLACK, unexploreObject } from './visibility';

/** One production queue record: a unit type and how many are paid for. */
export interface QueueRecord {
  unit: number;
  count: number;
}

/** `TRIBE_Action_Make_Obj` started by the queue (always pre-paid). */
export interface TrainAction {
  unit: number;
  /** `work_done`, seconds of work at rate 1. */
  workDone: number;
  /** 6 working, 1 done. */
  state: number;
  /** Started by the make command (a cheat, chat.md §7.2), not the queue: the queue empties while it runs. */
  make?: boolean;
}

export const MASTER_TYPE_BUILDING = 80;
/** `TRIBE_MASTER_TYPE_COMBAT`: masters below it have no cost (`check_obj_cost` fails). */
const MASTER_TYPE_COMBAT = 70;

/** Player attributes (include/player.h). */
export const ATTR_HEADROOM = 4;
export const ATTR_POPULATION = 11;
const ATTR_GOLD = 3;
const ATTR_GOLD_REPLACEMENT = 29;
export const ATTR_POPULATION_LIMIT = 32;

const TRAIN_WORKING = 6;
const TRAIN_DONE = 1;

/** `g_static_object_coordinate_epsilon`. */
const COORDINATE_EPSILON = f32(0.001);
/** `g_static_object_bounds_min_adjustment` / `g_static_object_bounds_max_adjustment` (±3 tiles). */
const BOUNDS = f32(3);
/** `g_build_cancel_refund_factor`. */
const CANCEL_REFUND = f32(0.5);
/** `g_make_obj_radius_adjustment`. */
const MAKE_RADIUS_ADJUSTMENT = f32(-0.01);
/** `g_make_obj_random_scale`, about 1/32767. */
const MAKE_RANDOM_SCALE = f32(3.051851e-5);

export function isBuilding(t: UnitType): boolean {
  return t.masterType === MASTER_TYPE_BUILDING;
}

/** Objects in a tile range in `tile->objects` order as far as the sim knows it: rows, columns, newest first. */
function objectsInTiles(ctx: GameContext, x0: number, y0: number, x1: number, y1: number): Entity[] {
  const found: Entity[] = [];
  for (const o of ctx.entities.all()) {
    // A passenger is on no tile.
    if (!hasMaster(ctx, o.owner, o.type) || o.inside != null) continue;
    const tx = Math.trunc(o.x);
    const ty = Math.trunc(o.y);
    if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) found.push(o);
  }
  // A tile's list takes new arrivals at its head (`add_node`, src/obj_list.cpp:57); objects that never moved arrived
  // when created, so newest first. Units that walked into a tile may sit elsewhere in the original's list.
  return found.sort((a, b) => Math.trunc(a.y) - Math.trunc(b.y) || Math.trunc(a.x) - Math.trunc(b.x) || b.id - a.id);
}

/** The ±3-tile object search box of `check_placement` and `check_destructables`, clamped to the map. */
function searchBox(ctx: GameContext, col: number, row: number): [number, number, number, number] {
  let x0 = Math.trunc(sub32(col, BOUNDS));
  let y0 = Math.trunc(sub32(row, BOUNDS));
  let x1 = Math.trunc(add32(col, BOUNDS));
  let y1 = Math.trunc(add32(row, BOUNDS));
  if (x0 < 0) x0 = 0;
  if (x1 >= ctx.map.width) x1 = ctx.map.width - 1;
  if (y0 < 0) y0 = 0;
  if (y1 >= ctx.map.height) y1 = ctx.map.height - 1;
  return [x0, y0, x1, y1];
}

/**
 * `RGE_Master_Static_Object::check_placement` (`src/m_s_obj.cpp:843`): 0 when `t` fits at (col, row), else the
 * reason: 7 off the map, 1 tile requirement (the Dock's shore, `tileRequirements`), 2 terrain, 5 not seen, 6 an object
 * in the way. `construction` uses the construction radius; `builtOn` ignores objects that can be built on. With
 * `visibleTo` (`check_vis`, visibility.md §5) one tile under the object must be explored or seen by that player. Slope
 * (3) is not checked yet: every tile counts as flat.
 */
export function checkPlacement(
  ctx: GameContext,
  t: UnitType,
  col: number,
  row: number,
  construction: boolean,
  builtOn: boolean,
  visibleTo = -1,
): number {
  const rx = construction ? t.clearanceX : t.radiusX;
  const ry = construction ? t.clearanceY : t.radiusY;
  const minX = sub32(col, rx);
  const maxX = sub32(add32(col, rx), COORDINATE_EPSILON);
  const minY = sub32(row, ry);
  const maxY = sub32(add32(row, ry), COORDINATE_EPSILON);
  if (!(minX >= 0) || !(maxX < ctx.map.width) || !(minY >= 0) || !(maxY < ctx.map.height)) return 7;
  if (!tileRequirements(ctx, t, col, row, minX, maxX, minY, maxY)) return 1;
  let seen = false;
  for (let x = Math.trunc(minX); x <= Math.trunc(maxX); x++) {
    for (let y = Math.trunc(minY); y <= Math.trunc(maxY); y++) {
      if (!((t.terrainTable[ctx.map.terrainAt(x, y)] ?? 0) > 0)) return 2;
      if (visibleTo >= 0 && ctx.visibility && ctx.visibility.get(visibleTo, x, y) !== TILE_BLACK) seen = true;
    }
  }
  if (visibleTo >= 0 && ctx.visibility && !seen) return 5;
  if (!(rx > 0) && !(ry > 0)) return 0;
  if (!builtOn && !(t.radiusZ > 0)) return 0;
  const [x0, y0, x1, y1] = searchBox(ctx, col, row);
  for (const o of objectsInTiles(ctx, x0, y0, x1, y1)) {
    if (o.state >= ObjectState.PendingRemoval) continue;
    const ot = typeOf(ctx, o);
    if (builtOn && ot.canBeBuiltOn === 1 && t.canBeBuiltOn === 0) continue;
    if (!(ot.radiusX > 0) || !(ot.radiusY > 0)) continue;
    if (ot.radiusZ > 0 !== t.radiusZ > 0) continue;
    const dx = Math.abs(sub32(o.x, col));
    const dy = Math.abs(sub32(o.y, row));
    if (!(dx >= add32(ot.radiusX, rx)) && !(dy >= add32(ot.radiusY, ry))) return 6;
  }
  return 0;
}

/**
 * The tile requirements of `check_placement` (src/m_s_obj.cpp:880-956, naval.md §3.1): with a centre requirement
 * (`center_tile_req1/2`, the dat's placement terrain) the centre tile must be one of the two terrains, and the ring below
 * shrinks to the centre tile; with a side requirement (`tile_req1/2`) some tile of the ring just outside the footprint (its
 * four sides, the corners not included, off-map sides skipped) must be one of those terrains. The Dock (45) needs water or
 * shallows at its centre and a beach beside the centre tile.
 */
function tileRequirements(ctx: GameContext, t: UnitType, col: number, row: number, minX: number, maxX: number, minY: number, maxY: number): boolean {
  let x1 = Math.trunc(minX);
  let x2 = Math.trunc(maxX);
  let y1 = Math.trunc(minY);
  let y2 = Math.trunc(maxY);
  const [c1, c2] = t.placementTerrain;
  if (c1 >= 0 || c2 >= 0) {
    const cx = Math.trunc(col);
    const cy = Math.trunc(row);
    const center = ctx.map.terrainAt(cx, cy);
    if (center !== c1 && center !== c2) return false;
    x1 = x2 = cx;
    y1 = y2 = cy;
  }
  const [r1, r2] = t.placementSideTerrain;
  if (r1 < 0 && r2 < 0) return true;
  const { width, height } = ctx.map;
  const is = (x: number, y: number) => {
    const terrain = ctx.map.terrainAt(x, y);
    return terrain === r1 || terrain === r2;
  };
  for (let x = x1; y1 - 1 >= 0 && x <= x2; x++) if (is(x, y1 - 1)) return true;
  for (let y = y1; x2 + 1 < width && y <= y2; y++) if (is(x2 + 1, y)) return true;
  for (let x = x2; y2 + 1 < height && x >= x1; x--) if (is(x, y2 + 1)) return true;
  for (let y = y2; x1 - 1 >= 0 && y >= y1; y--) if (is(x1 - 1, y)) return true;
  return false;
}

/**
 * `TRIBE_World::check_destructables(player, type, x, y, 0)` (`src/tworld.cpp:272`): objects that can be built on and
 * overlap the new object's radius are destroyed (`destroy_obj`: woken, pending removal).
 */
export function checkDestructables(ctx: GameContext, t: UnitType, col: number, row: number, destroy: (o: Entity) => void): void {
  if (!(t.radiusX > 0) && !(t.radiusY > 0)) return;
  const [x0, y0, x1, y1] = searchBox(ctx, col, row);
  for (const o of objectsInTiles(ctx, x0, y0, x1, y1)) {
    const ot = typeOf(ctx, o);
    if (ot.id === t.id || ot.canBeBuiltOn === 0) continue;
    const dx = Math.abs(sub32(o.x, col));
    const dy = Math.abs(sub32(o.y, row));
    if (dx < add32(ot.radiusX, t.radiusX) && dy < add32(ot.radiusY, t.radiusY)) destroy(o);
  }
}

/**
 * `TRIBE_Building_Object::setup` (`src/t_b_obj.cpp:144-163`), after the object's own setup: unbuilt, the construction
 * sprite, no build points, 1 hp, the owner's building facet, foundations clear what can be built on, an empty queue.
 */
export function setupBuilding(ctx: GameContext, e: Entity, t: UnitType, destroy: (o: Entity) => void): void {
  e.state = ObjectState.Unbuilt;
  if (t.creatable!.trainTime > 0) newSprite(ctx, e, t.building!.construction);
  e.buildPoints = 0;
  e.hp = 1;
  e.facet = buildingFacet(ctx, e.owner, t.id);
  checkDestructables(ctx, t, e.x, e.y, destroy);
  e.queue = [];
  e.train = null;
}

/**
 * `TRIBE_Building_Object::build` (`src/t_b_obj.cpp:700-717`): add build points, hp in proportion; completes the
 * building when the points reach the requirement. True when done (or not unbuilt).
 */
export function build(ctx: GameContext, e: Entity, work: number): boolean {
  if (e.state !== ObjectState.Unbuilt) return true;
  const t = typeOf(ctx, e);
  const required = f32(t.creatable!.trainTime);
  const maxHp = f32(t.hitPoints);
  let amount = work;
  if (add32(amount, e.buildPoints!) > required) amount = sub32(required, e.buildPoints!);
  e.hp = add32(div32(mul32(maxHp, amount), required), e.hp);
  if (e.hp > maxHp) e.hp = maxHp;
  e.buildPoints = add32(e.buildPoints!, amount);
  if (e.buildPoints >= required) {
    complete(ctx, e, t);
    return true;
  }
  return false;
}

/** Storage slots with flag 4 or more: given to the owner when built, taken back when the building dies. */
export function giveBuiltStorages(ctx: GameContext, e: Entity, t: UnitType, sign: 1 | -1): void {
  const attributes = ctx.attributes[e.owner]!;
  for (const s of t.storages) if (s.flag >= 4) attributes[s.type] = add32(sign * s.amount, attributes[s.type] ?? 0);
}

/**
 * `TRIBE_Building_Object::set_object_state(active)` (`src/t_b_obj.cpp:229-327`, economy.md §4.3): full build points,
 * one fenced `rand()` for the construction sound, the flag-4 storages to the owner, the final sprite and facet (or
 * removal for buildings that go away), the on-build object and tech, then active.
 */
function complete(ctx: GameContext, e: Entity, t: UnitType): void {
  const b = t.building!;
  e.buildPoints = f32(t.creatable!.trainTime);
  ctx.rng.srand(ctx.rng.rand());
  giveBuiltStorages(ctx, e, t, 1);
  if (b.disappearsWhenBuilt) {
    // `die_die_die`.
    ctx.wake(e);
    e.hp = 0;
  } else {
    // The foundation's footprint gives way to the building's line of sight (src/t_b_obj.cpp:253-254).
    unexploreObject(ctx, e, t, true);
    exploreObject(ctx, e, t, false);
    newSprite(ctx, e, t.standing);
    e.facet = buildingFacet(ctx, e.owner, t.id);
    if (b.connect) connectWall(ctx, e);
  }
  if (b.makeObject > -1) ctx.create(e.owner, b.makeObject, e.x, e.y, e.z);
  // No building in the sim's table turns terrain (`on_build_make_tile`, farms do not either).
  if (b.techId > -1) doTech(ctx, e.owner, b.techId);
  e.state = ObjectState.Active;
}

/** The literal `RGE_Moving_Object::rotate` turns by (src/move_obj.cpp:2146-2156). */
const ROTATE_CIRCLE = 6.2831853;

/**
 * `TRIBE_Building_Object::check` (`src/t_b_obj.cpp:465-533`, economy.md §4.8.2): on the tiles north (row - 1), west
 * (col - 1), east (col + 1) and south (row + 1), the first object of the same master in the tile's list, kept only
 * when it has the same owner. Any state counts: a foundation is a neighbour.
 */
export function wallNeighbours(ctx: GameContext, e: Entity): (Entity | null)[] {
  const x = Math.trunc(e.x);
  const y = Math.trunc(e.y);
  const id = typeOf(ctx, e).id;
  const at = (tx: number, ty: number): Entity | null => {
    const o = objectsInTiles(ctx, tx, ty, tx, ty).find((n) => typeOf(ctx, n).id === id);
    return o && o.owner === e.owner ? o : null;
  };
  return [y > 0 ? at(x, y - 1) : null, x > 0 ? at(x - 1, y) : null, x < ctx.map.width - 1 ? at(x + 1, y) : null, y < ctx.map.height - 1 ? at(x, y + 1) : null];
}

/** `RGE_Moving_Object::rotate(amount)` then `new_angle` (`src/move_obj.cpp:2141-2160`, :492): turn `amount` facets. */
function rotate(e: Entity, amount: number, s: SpriteInfo): void {
  const m = e.mover!;
  let a = add32(f32((amount * ROTATE_CIRCLE) / s.facets), m.angle);
  while (a < 0) a = add32(a, f32(ROTATE_CIRCLE));
  while (a >= ROTATE_CIRCLE) a = sub32(a, f32(ROTATE_CIRCLE));
  m.angle = a;
  e.facet = facetOf(a, s);
}

/**
 * The facet choice of `connect` / `connect2` (`src/t_b_obj.cpp:544-550`, :571-577): neighbours north and south only
 * turn the wall to facet 1, west and east only to facet 0, anything else (an end, a corner, a crossing, alone) to 2.
 */
function turnToNeighbours(e: Entity, n: (Entity | null)[], s: SpriteInfo): void {
  const [north, west, east, south] = n;
  if (north && south && !west && !east) rotate(e, 1 - e.facet!, s);
  else if (west && east && !north && !south) rotate(e, -e.facet!, s);
  else rotate(e, 2 - e.facet!, s);
}

/**
 * `TRIBE_Building_Object::connect` (`src/t_b_obj.cpp:535-563`, economy.md §4.8.2): a wall showing a 3-facet sprite
 * takes the facet of its angle (`set_angle`), turns to the facet its neighbours call for, then each neighbour does the
 * same (`connect2`); any other sprite gets facet 0. Called when a wall is built and when it is upgraded.
 */
export function connectWall(ctx: GameContext, e: Entity): void {
  if (!e.sprite || !e.mover) return;
  const s = spriteInfo(e.sprite.graphic);
  if (s.facets !== 3) {
    e.facet = 0;
    return;
  }
  e.facet = facetOf(e.mover.angle, s);
  const n = wallNeighbours(ctx, e);
  turnToNeighbours(e, n, s);
  for (const o of n) if (o) connectNeighbour(ctx, o);
}

/** `TRIBE_Building_Object::connect2` (`src/t_b_obj.cpp:565-582`): `connect` from the facet it has, without recursing. */
function connectNeighbour(ctx: GameContext, e: Entity): void {
  if (!e.sprite || !e.mover) return;
  const s = spriteInfo(e.sprite.graphic);
  if (s.facets !== 3) {
    e.facet = 0;
    return;
  }
  turnToNeighbours(e, wallNeighbours(ctx, e), s);
}

/**
 * The unbuilt part of `TRIBE_Building_Object::update` (`src/t_b_obj.cpp:334-347`), before the object's own update:
 * the construction frame follows the build points, and the building completes once they reach the requirement.
 */
export function updateConstruction(ctx: GameContext, e: Entity, t: UnitType): void {
  if (e.state !== ObjectState.Unbuilt) return;
  const required = f32(t.creatable!.trainTime);
  // `sprite->facet_num`: the facets of the sprite shown (the construction sprite's, 4 for the sim's buildings).
  const frames = e.sprite ? spriteInfo(e.sprite.graphic).facets : 0;
  const frame = Math.trunc(div32(mul32(frames, e.buildPoints!), required)) & 0xff;
  if (frame < frames && frame !== e.facet) e.facet = frame;
  if (required <= e.buildPoints!) complete(ctx, e, t);
}

/**
 * `TRIBE_Building_Object::cancel_build` (`src/t_b_obj.cpp:672-697`, economy.md §4.4): refund the flagged costs scaled
 * by half the unbuilt fraction, then hp 0 (the building dies on its next update).
 */
export function cancelBuild(ctx: GameContext, e: Entity): void {
  const t = typeOf(ctx, e);
  const required = f32(t.creatable!.trainTime);
  let percent = 0;
  if (!(e.state >= ObjectState.Active || e.hp <= 0)) percent = mul32(div32(sub32(required, e.buildPoints!), required), CANCEL_REFUND);
  if (percent > 1) percent = 1;
  const attributes = ctx.attributes[e.owner]!;
  for (const c of t.creatable!.costs) if (c.flag !== 0) attributes[c.type] = add32(mul32(Math.trunc(c.amount), percent), attributes[c.type]!);
  e.hp = 0;
}

/**
 * `TRIBE_Player::check_obj_cost` (`src/tplayer.cpp:1031`, economy.md §6.1): can the player pay `modifier` times the
 * cost of `id`? With `ignorePop` the population slot (attribute 4) is not checked.
 */
export function checkObjCost(ctx: GameContext, player: number, id: number, modifier: number, ignorePop: boolean): boolean {
  const attributes = ctx.attributes[player]!;
  const t = ctx.masters[player]?.[id];
  if (!t || t.masterType < MASTER_TYPE_COMBAT || !t.creatable) return false;
  const replace = attributes[ATTR_GOLD_REPLACEMENT]! >= 1;
  let gold = replace ? attributes[ATTR_GOLD]! : 0;
  for (const c of t.creatable.costs) {
    const cost = mul32(c.amount, modifier);
    if (c.type === ATTR_HEADROOM && !ignorePop && attributes[ATTR_POPULATION]! >= attributes[ATTR_POPULATION_LIMIT]!) return false;
    if (replace && c.type === ATTR_GOLD) {
      gold = sub32(gold, cost);
      if (gold < 0) return false;
    }
    if (attributes[c.type]! < cost && (c.type !== ATTR_HEADROOM || !ignorePop)) {
      if (c.flag === 0 || add32(gold, attributes[c.type]!) < cost) return false;
      gold = sub32(gold, sub32(cost, attributes[c.type]!));
    }
  }
  return true;
}

/** `pay_obj_cost` (`src/tplayer.cpp:1080`): check, then take every flagged slot; a shortfall comes out of gold. */
export function payObjCost(ctx: GameContext, player: number, id: number, modifier: number, ignorePop: boolean): boolean {
  if (!checkObjCost(ctx, player, id, modifier, ignorePop)) return false;
  const attributes = ctx.attributes[player]!;
  for (const c of master(ctx, player, id).creatable!.costs) {
    if (c.flag === 0 || (ignorePop && c.type === ATTR_HEADROOM)) continue;
    const amount = mul32(c.amount, modifier);
    if (amount > attributes[c.type]!) {
      attributes[ATTR_GOLD] = sub32(attributes[ATTR_GOLD]!, sub32(amount, attributes[c.type]!));
      attributes[c.type] = 0;
    } else attributes[c.type] = sub32(attributes[c.type]!, amount);
  }
  return true;
}

/** `reimburse_obj_cost` (`src/tplayer.cpp:1101`): give back every flagged slot in full. */
export function reimburseObjCost(ctx: GameContext, player: number, id: number): void {
  const t = master(ctx, player, id);
  if (t.masterType < MASTER_TYPE_COMBAT || !t.creatable) return;
  const attributes = ctx.attributes[player]!;
  for (const c of t.creatable.costs) if (c.flag !== 0) attributes[c.type] = add32(attributes[c.type]!, c.amount);
}

/**
 * `add_to_production_queue` (`src/t_b_obj.cpp:800-860`, economy.md §5.1): a different unit type than the last record
 * empties the queue with refunds first; each unit is paid when queued, stopping at the first one the player cannot
 * afford. The building does not have to be the unit's training place (decomp-marked bug, kept).
 */
export function addToQueue(ctx: GameContext, e: Entity, unit: number, count: number): void {
  const queue = e.queue!;
  const last = queue[queue.length - 1];
  if (!last || last.unit !== unit) {
    while (queue.length > 0) removeFromQueue(ctx, e, queue[0]!.unit, 1);
    if (!checkObjCost(ctx, e.owner, unit, 1, true)) return;
    const record: QueueRecord = { unit, count: 0 };
    for (let i = 0; i < count; i++) {
      if (!checkObjCost(ctx, e.owner, unit, 1, true)) break;
      payObjCost(ctx, e.owner, unit, 1, true);
      record.count++;
    }
    queue.push(record);
    return;
  }
  for (let i = 0; i < count; i++) {
    if (!checkObjCost(ctx, e.owner, unit, 1, true)) break;
    payObjCost(ctx, e.owner, unit, 1, true);
    last.count++;
  }
}

/**
 * `remove_from_production_queue` (`src/t_b_obj.cpp:862-920`): on the last record of that type, refund up to `count`
 * units and subtract `count`; an emptied record goes, and emptying the first one stops its training.
 */
export function removeFromQueue(ctx: GameContext, e: Entity, unit: number, count: number): void {
  const queue = e.queue!;
  for (let index = queue.length - 1; index >= 0; index--) {
    const record = queue[index]!;
    if (record.unit !== unit) continue;
    for (let n = record.count <= count ? record.count : count; n > 0; n--) reimburseObjCost(ctx, e.owner, unit);
    record.count -= count;
    if (record.count <= 0) {
      queue.splice(index, 1);
      // `action_stop` then `delete_list`: the queue's train action is pre-paid, so stopping refunds nothing.
      if (index === 0) e.train = null;
    }
    return;
  }
}

/** `advance_production_queue` (`src/t_b_obj.cpp:922`): one unit of the first record is done. */
function advanceQueue(e: Entity): void {
  const queue = e.queue!;
  const first = queue[0];
  if (!first) return;
  first.count--;
  if (first.count <= 0) queue.shift();
}

/** `empty_production_queue` (`src/t_b_obj.cpp:939`): a dying building drops its queue without refunds. */
export function emptyQueue(e: Entity): void {
  if (e.queue) e.queue.length = 0;
  e.train = null;
}

/**
 * `update_production_queue` (`src/t_b_obj.cpp:959-1029`, economy.md §5.1), after the building's own update: with no
 * train action, start one for the first record when the population is below its limit and there is headroom; then
 * advance the action, and the queue when it ends. While the building researches (its own action; the make command is
 * not ported) the queue goes instead: `remove_from_production_queue(id, -1)` adds 1 to the record's short count until
 * it wraps negative, so each record is removed without a refund, and the queue's train action is stopped unpaid.
 */
export function updateQueue(ctx: GameContext, e: Entity): void {
  const queue = e.queue;
  if (!queue || (queue.length === 0 && !e.train?.make)) return;
  if (e.research) {
    emptyQueue(e);
    return;
  }
  if (e.train?.make) {
    // The building's main action is a make: `remove_from_production_queue(id, -1)` drops every record unrefunded.
    queue.length = 0;
    if (updateTrain(ctx, e, e.train) !== ActionResult.Continue) e.train = null;
    return;
  }
  if (!e.train) {
    const attributes = ctx.attributes[e.owner]!;
    if (attributes[ATTR_POPULATION]! >= attributes[ATTR_POPULATION_LIMIT]!) return;
    if (!(attributes[ATTR_HEADROOM]! > 0)) return;
    // Pre-paid: `first_in_stack` goes straight to working.
    e.train = { unit: queue[0]!.unit, workDone: 0, state: TRAIN_WORKING };
  }
  const r = updateTrain(ctx, e, e.train);
  if (r === ActionResult.Failed || r === ActionResult.Completed || r === ActionResult.Remove) {
    e.train = null;
    advanceQueue(e);
  }
}

/**
 * `TRIBE_Action_Make_Obj::update` (`src/tact_mob.cpp:102-152`, economy.md §5.2): the building's work rate adds up;
 * at the unit's train time the unit is placed, or its cost refunded when there is no room.
 */
function updateTrain(ctx: GameContext, e: Entity, a: TrainAction): ActionResult {
  if (a.state === TRAIN_DONE) return ActionResult.Remove;
  // STEROIDS (`quick_build`, chat.md §7.2) sets the work to 1000.
  a.workDone = ctx.quickBuild ? f32(1000) : add32(mul32(typeOf(ctx, e).action!.workRate, ctx.deltaSeconds), a.workDone);
  if (f32(master(ctx, e.owner, a.unit).creatable!.trainTime) <= a.workDone) {
    a.state = TRAIN_DONE;
    if (!placeUnit(ctx, e, a.unit)) reimburseObjCost(ctx, e.owner, a.unit);
    return ActionResult.Remove;
  }
  return ActionResult.Continue;
}

/**
 * `TRIBE_Action_Make_Obj::place_obj` (`src/tact_mob.cpp:161-222`, economy.md §5.4): up to 3 rings of 60 random tries
 * around the building; each try draws a side, then (sides 0-3) an offset along it. The first free spot gets the unit.
 */
export function placeUnit(ctx: GameContext, e: Entity, unit: number): Entity | null {
  const proto = master(ctx, e.owner, unit);
  const own = typeOf(ctx, e);
  const rng = ctx.rng;
  let rx = sub32(add32(own.radiusX, proto.radiusX), MAKE_RADIUS_ADJUSTMENT);
  let rx2 = add32(rx, rx);
  let ry = sub32(add32(own.radiusY, proto.radiusY), MAKE_RADIUS_ADJUSTMENT);
  let ry2 = add32(ry, ry);
  let x = -1;
  let y = -1;
  const offset = (len: number, r: number) => sub32(mul32(mul32(rng.rand(), len), MAKE_RANDOM_SCALE), r);
  for (let ring = 0; ring < 3; ring++) {
    for (let tries = 0; tries < 60; ) {
      const side = tries < 40 ? Math.trunc((rng.rand() * 2) / 0x7fff) : Math.trunc((rng.rand() * 2) / 0x7fff) + 2;
      switch (side) {
        case 0:
          y = add32(e.y, ry);
          x = add32(e.x, offset(rx2, rx));
          break;
        case 1:
          x = sub32(e.x, rx);
          y = add32(e.y, offset(ry2, ry));
          break;
        case 2:
          x = add32(e.x, rx);
          y = add32(e.y, offset(ry2, ry));
          break;
        case 3:
          y = sub32(e.y, ry);
          x = add32(e.x, offset(rx2, rx));
          break;
      }
      if (checkPlacement(ctx, proto, x, y, false, false, e.owner) === 0) return ctx.create(e.owner, unit, x, y, e.z);
      tries++;
    }
    rx = add32(rx, add32(proto.radiusX, proto.radiusX));
    ry = add32(ry, add32(proto.radiusY, proto.radiusY));
    rx2 = add32(rx2, mul32(proto.radiusX, 4));
    ry2 = add32(ry2, mul32(proto.radiusY, 4));
  }
  return null;
}
