/**
 * Per-player fog of war (docs/spec/visibility.md): each player's viewer counts per tile (`RGE_Visible_Map`), the shared
 * per-tile bit map (`unified_map_offsets`: bit p visible to p, bit p + 16 explored by p), the line-of-sight shapes, and
 * the visible-unit records the unit AI searches (`Visible_Unit_Manager`). Objects add and remove their line of sight
 * through `exploreObject` / `unexploreObject` at the points listed in visibility.md §3.
 */
import { ObjectState, type Entity } from './entities';
import type { Hasher } from './hash';
import { add32, f32, sub32, toInt } from './num';
import type { UnitType } from './units';

/** `get_visible` results (include/visible.h:23-25). */
export const TILE_BLACK = 0x00;
export const TILE_FOGGED = 0x80;
export const TILE_VISIBLE = 0x0f;

/** Viewer-count byte values (include/visible.h:17-20). */
const VIS_UNEXPLORED = 0xff;
const VIS_MAX_VIEWERS = 0xf9;

/** `RGE_LOS_MAX_RADIUS`. */
export const LOS_MAX_RADIUS = 16;
const EXPLORED_SHIFT = 16;
/** `- 0.01f` on the far edge of a footprint rectangle (src/stat_obj.cpp:2127-2128). */
const RECT_EPSILON = f32(0.01);

/**
 * Line-of-sight shapes as row half-widths (visibility.md §2), numeric data from `NormalLOS` / `SquareLOS`
 * (src/visible.cpp:11-143, ref aoe1-decomp@6d6d8b1). `NORMAL_HALF[r][k]` is the half-width of rows `dy = ±k`, k = 0..r:
 * the row covers `dx = -w..w`. `SQUARE_HALF[r][k]` (r >= 1) is the half-width of rows `dy = -r + k` and `dy = r - 1 - k`,
 * k = 0..r-1: the row covers `dx = -w-1..w`, so the shape is 2r tiles across. `SquareLOS[0]` is the single tile (0, 0).
 */
const NORMAL_HALF: readonly (readonly number[])[] = [
  [0],
  [1, 1],
  [2, 2, 1],
  [3, 3, 2, 1],
  [4, 4, 3, 3, 1],
  [5, 5, 5, 4, 3, 2],
  [6, 6, 6, 5, 5, 4, 2],
  [7, 7, 7, 6, 6, 5, 4, 2],
  [8, 8, 8, 7, 7, 6, 5, 4, 2],
  [9, 9, 9, 8, 8, 8, 7, 6, 5, 2],
  [10, 10, 10, 10, 9, 9, 8, 7, 6, 5, 3],
  [11, 11, 11, 11, 10, 10, 9, 9, 8, 7, 5, 3],
  [12, 12, 12, 12, 11, 11, 10, 10, 9, 8, 7, 5, 3],
  [13, 13, 13, 13, 12, 12, 12, 11, 10, 9, 8, 7, 6, 3],
  [14, 14, 14, 14, 13, 13, 13, 12, 12, 11, 10, 9, 8, 6, 3],
  [15, 15, 15, 15, 14, 14, 14, 13, 13, 12, 11, 10, 9, 8, 6, 3],
  [16, 16, 16, 16, 15, 15, 15, 14, 14, 13, 13, 12, 11, 10, 8, 6, 3],
];
const SQUARE_HALF: readonly (readonly number[])[] = [
  [],
  [0],
  [1, 1],
  [1, 2, 2],
  [1, 2, 3, 3],
  [1, 3, 3, 4, 4],
  [1, 3, 4, 4, 5, 5],
  [1, 3, 4, 5, 5, 6, 6],
  [2, 4, 5, 6, 6, 7, 7, 7],
  [2, 4, 5, 6, 7, 7, 8, 8, 8],
  [2, 4, 6, 7, 7, 8, 8, 9, 9, 9],
  [2, 4, 6, 7, 8, 8, 9, 9, 10, 10, 10],
  [2, 5, 6, 7, 8, 9, 10, 10, 10, 11, 11, 11],
  [2, 5, 7, 8, 9, 10, 10, 11, 11, 11, 12, 12, 12],
  [3, 5, 7, 8, 9, 10, 11, 11, 12, 12, 13, 13, 13, 13],
  [3, 5, 7, 9, 10, 11, 11, 12, 12, 13, 13, 14, 14, 14, 14],
  [3, 6, 7, 9, 10, 11, 12, 12, 13, 14, 14, 14, 15, 15, 15, 15],
];

/** One shape row: tiles `(dx1..dx2, dy)` around the centre. */
export interface LosRow {
  dy: number;
  dx1: number;
  dx2: number;
}

/** The rows of `NormalLOS[radius]` (or `SquareLOS`), top to bottom as the tables list them; radius clamped to 0..16. */
export function losShape(radius: number, square: boolean): LosRow[] {
  const r = Math.min(Math.max(radius, 0), LOS_MAX_RADIUS);
  if (!square) {
    const half = NORMAL_HALF[r]!;
    const rows: LosRow[] = [];
    for (let dy = -r; dy <= r; dy++) rows.push({ dy, dx1: -half[Math.abs(dy)]!, dx2: half[Math.abs(dy)]! });
    return rows;
  }
  if (r === 0) return [{ dy: 0, dx1: 0, dx2: 0 }];
  const half = SQUARE_HALF[r]!;
  const rows: LosRow[] = [];
  for (let dy = -r; dy < r; dy++) {
    const w = half[dy < 0 ? dy + r : r - 1 - dy]!;
    rows.push({ dy, dx1: -w - 1, dx2: w });
  }
  return rows;
}

const SHAPES = { normal: [] as LosRow[][], square: [] as LosRow[][] };
for (let r = 0; r <= LOS_MAX_RADIUS; r++) {
  SHAPES.normal.push(losShape(r, false));
  SHAPES.square.push(losShape(r, true));
}

/**
 * `Build_Distance_Table` (src/vis_unit.cpp:76-117, unit-ai.md §3.2): `d[dy][dx]` for |dy|, |dx| in 0..15 is the smallest
 * radius whose normal shape contains the cell, 99 when none up to 16 does.
 */
export function losDistanceTable(): number[][] {
  return Array.from({ length: 16 }, (_, dy) =>
    Array.from({ length: 16 }, (_, dx) => {
      for (let r = 0; r <= LOS_MAX_RADIUS; r++) if (dy <= r && dx <= NORMAL_HALF[r]![dy]!) return r;
      return 99;
    }),
  );
}

/** One `VISIBLE_UNIT_REC`: the object's owner and tile when the player started seeing it (never refreshed after). */
export interface VisibleRecord {
  id: number;
  owner: number;
  x: number;
  y: number;
}

export interface VisibilitySnapshot {
  width: number;
  height: number;
  /** Per player, the viewer-count byte of every tile, row-major. */
  counts: number[][];
  unified: number[];
  explored: number[];
  /** `[player][group]` record lists in list order. */
  records: VisibleRecord[][][];
}

/** The world's fog-of-war state. */
export class Visibility {
  readonly width: number;
  readonly height: number;
  readonly players: number;
  /** Per player, `RGE_Visible_Map::visible_map`: 0xFF unexplored, 0 explored and unseen, 1..0xF9 viewers. */
  readonly counts: Uint8Array[];
  /** `unified_map_offsets`: per tile, bit p while p sees it, bit p + 16 once p explored it. */
  readonly unified: Uint32Array;
  /** Per player, `numberTilesExploredValue`. */
  readonly explored: number[];
  /** `Visible_Unit_Manager::PlayerDataPtrs`: per player, per object group, the records of what the player sees. */
  readonly records: VisibleRecord[][][];

  constructor(width: number, height: number, players: number) {
    this.width = width;
    this.height = height;
    this.players = players;
    this.counts = Array.from({ length: players }, () => new Uint8Array(width * height).fill(VIS_UNEXPLORED));
    this.unified = new Uint32Array(width * height);
    this.explored = new Array<number>(players).fill(0);
    this.records = Array.from({ length: players }, () => []);
  }

  /**
   * `RGE_Visible_Map::explore_terrain` (visibility.md §2.2): one more viewer on every tile of the shape around (tx, ty);
   * returns how many tiles were explored for the first time.
   */
  explore(player: number, tx: number, ty: number, radius: number, square: boolean): number {
    const rows = (square ? SHAPES.square : SHAPES.normal)[Math.min(radius, LOS_MAX_RADIUS)]!;
    let revealed = 0;
    for (const row of rows) {
      const y = ty + row.dy;
      if (y < 0 || y >= this.height) continue;
      revealed += this.addRow(player, y, Math.max(tx + row.dx1, 0), Math.min(tx + row.dx2, this.width - 1));
    }
    return revealed;
  }

  /** `unexplore_terrain`: one viewer fewer on the same shape; tiles stay explored. */
  unexplore(player: number, tx: number, ty: number, radius: number, square: boolean): void {
    const rows = (square ? SHAPES.square : SHAPES.normal)[Math.min(radius, LOS_MAX_RADIUS)]!;
    for (const row of rows) {
      const y = ty + row.dy;
      if (y < 0 || y >= this.height) continue;
      this.removeRow(player, y, Math.max(tx + row.dx1, 0), Math.min(tx + row.dx2, this.width - 1));
    }
  }

  /** `explore_terrain_sq`: the same on the rectangle (x1, y1)-(x2, y2), clipped to the map. */
  exploreRect(player: number, x1: number, y1: number, x2: number, y2: number): number {
    if (x1 >= this.width || x2 < 0 || y1 >= this.height || y2 < 0) return 0;
    let revealed = 0;
    for (let y = Math.max(y1, 0); y <= Math.min(y2, this.height - 1); y++) {
      revealed += this.addRow(player, y, Math.max(x1, 0), Math.min(x2, this.width - 1));
    }
    return revealed;
  }

  /** `unexplore_terrain_sq`. */
  unexploreRect(player: number, x1: number, y1: number, x2: number, y2: number): void {
    if (x1 >= this.width || x2 < 0 || y1 >= this.height || y2 < 0) return;
    for (let y = Math.max(y1, 0); y <= Math.min(y2, this.height - 1); y++) {
      this.removeRow(player, y, Math.max(x1, 0), Math.min(x2, this.width - 1));
    }
  }

  private addRow(player: number, y: number, x1: number, x2: number): number {
    const counts = this.counts[player]!;
    const visibleBit = 1 << player;
    const exploredBit = 1 << (player + EXPLORED_SHIFT);
    let revealed = 0;
    for (let i = y * this.width + x1, end = y * this.width + x2; i <= end; i++) {
      let v = (counts[i]! + 1) & 0xff;
      if (v === 0) {
        revealed++;
        this.explored[player]!++;
        this.unified[i]! |= exploredBit;
        v = 1;
      }
      if (v === 1) this.unified[i]! |= visibleBit;
      if (v === VIS_MAX_VIEWERS + 1) v = VIS_MAX_VIEWERS;
      counts[i] = v;
    }
    return revealed;
  }

  private removeRow(player: number, y: number, x1: number, x2: number): void {
    const counts = this.counts[player]!;
    const visibleBit = 1 << player;
    for (let i = y * this.width + x1, end = y * this.width + x2; i <= end; i++) {
      let v = (counts[i]! - 1) & 0xff;
      if (v === 0xff) v = 0;
      if (v === 0) this.unified[i]! &= ~visibleBit;
      counts[i] = v;
    }
  }

  /**
   * `RGE_Visible_Map::get_visible` (visibility.md §1.3): `TILE_VISIBLE` while one of the player's mutual allies sees the
   * tile, `TILE_FOGGED` once one explored it, else `TILE_BLACK`. Every other player is an enemy and allied line of sight
   * is off, so the mutual masks hold the player's own bits only.
   */
  get(player: number, col: number, row: number): number {
    const cell = this.unified[row * this.width + col]!;
    if (cell & (1 << player)) return TILE_VISIBLE;
    if (cell & (1 << (player + EXPLORED_SHIFT))) return TILE_FOGGED;
    return TILE_BLACK;
  }

  /** `unified_map_offsets[row][col]`. */
  cell(col: number, row: number): number {
    return this.unified[row * this.width + col]!;
  }

  /**
   * `Visible_Unit_Manager::Update_Unit_Info` (visibility.md §4.1): for each player whose visible bit differs between
   * `prior` and `next`, add a record of the object at (x, y) to the end of that player's list for `group`, or remove its
   * record by moving the list's last record into its place.
   */
  updateUnitInfo(id: number, owner: number, x: number, y: number, group: number, prior: number, next: number): void {
    let changed = (prior ^ next) & 0xffff;
    for (let p = 0; p < this.players && changed !== 0; p++, changed >>>= 1) {
      if ((changed & 1) === 0) continue;
      const lists = this.records[p]!;
      const list = (lists[group] ??= []);
      if (next & (1 << p)) list.push({ id, owner, x, y });
      else {
        const i = list.findIndex((r) => r.id === id);
        if (i === -1) continue;
        const last = list.pop()!;
        if (i < list.length) list[i] = last;
      }
    }
  }

  /** The records `player` holds for object group `group`, in list order. */
  recordsOf(player: number, group: number): readonly VisibleRecord[] {
    return this.records[player]![group] ?? [];
  }

  hashInto(h: Hasher): void {
    h.u32(this.width).u32(this.height);
    for (const counts of this.counts) {
      for (let i = 0; i < counts.length; i += 4) {
        h.u32(counts[i]! | ((counts[i + 1] ?? 0) << 8) | ((counts[i + 2] ?? 0) << 16) | ((counts[i + 3] ?? 0) << 24));
      }
    }
    for (const c of this.unified) h.u32(c);
    for (const n of this.explored) h.u32(n);
    for (const lists of this.records) {
      h.u32(lists.length);
      for (const list of lists) {
        h.u32(list?.length ?? 0);
        for (const r of list ?? []) h.u32(r.id).u32(r.owner).u32(r.x).u32(r.y);
      }
    }
  }

  toJSON(): VisibilitySnapshot {
    return {
      width: this.width,
      height: this.height,
      counts: this.counts.map((c) => Array.from(c)),
      unified: Array.from(this.unified),
      explored: [...this.explored],
      records: this.records.map((lists) => Array.from(lists, (list) => (list ?? []).map((r) => ({ ...r })))),
    };
  }

  static fromJSON(s: VisibilitySnapshot): Visibility {
    const v = new Visibility(s.width, s.height, s.counts.length);
    s.counts.forEach((c, p) => v.counts[p]!.set(c));
    v.unified.set(s.unified);
    s.explored.forEach((n, p) => (v.explored[p] = n));
    s.records.forEach((lists, p) => lists.forEach((list, g) => (v.records[p]![g] = list.map((r) => ({ ...r })))));
    return v;
  }
}

/** What the object-side calls need: the world's fog of war (absent in bare test contexts, where nothing is explored). */
export interface VisibilityContext {
  visibility?: Visibility;
}

/**
 * A building is unbuilt until its build points reach the requirement (`built`, src/t_b_obj.cpp:248); before setup it
 * has none.
 */
function unbuilt(e: Entity, t: UnitType): boolean {
  return t.masterType === 80 && !(e.buildPoints !== undefined && e.buildPoints >= (t.creatable?.trainTime ?? 0));
}

/** Footprint rectangle of an object for the square (`explore_type` 1) calls (src/stat_obj.cpp:2125-2129). */
function footprint(e: Entity, t: UnitType): [number, number, number, number] {
  return [
    toInt(sub32(e.x, t.radiusX)),
    toInt(sub32(e.y, t.radiusY)),
    toInt(sub32(add32(e.x, t.radiusX), RECT_EPSILON)),
    toInt(sub32(add32(e.y, t.radiusY), RECT_EPSILON)),
  ];
}

/**
 * `RGE_Static_Object::explore_terrain(owner, type, los)` with `TRIBE_Building_Object`'s override (visibility.md §3.1):
 * radius `los`, or (int) master LOS when -1; nothing unless > 0. Type 0 is the normal shape around the object's tile;
 * type 1 (forced for an unbuilt building) is its footprint rectangle, when both radii are positive.
 */
export function exploreObject(ctx: VisibilityContext, e: Entity, t: UnitType, square: boolean, los = -1): number {
  const v = ctx.visibility;
  const radius = los === -1 ? toInt(t.los) : los;
  if (!v || !(radius > 0)) return 0;
  if (!square && !unbuilt(e, t)) return v.explore(e.owner, toInt(e.x), toInt(e.y), radius, false);
  if (!(t.radiusX > 0 && t.radiusY > 0)) return 0;
  const [x1, y1, x2, y2] = footprint(e, t);
  return v.exploreRect(e.owner, x1, y1, x2, y2);
}

/** `RGE_Static_Object::unexplore_terrain(owner, type, los)`: the reverse of `exploreObject`, with no building override. */
export function unexploreObject(ctx: VisibilityContext, e: Entity, t: UnitType, square: boolean, los = -1): void {
  const v = ctx.visibility;
  const radius = los === -1 ? toInt(t.los) : los;
  if (!v || !(radius > 0)) return;
  if (!square) return v.unexplore(e.owner, toInt(e.x), toInt(e.y), radius, false);
  if (!(t.radiusX > 0 && t.radiusY > 0)) return;
  const [x1, y1, x2, y2] = footprint(e, t);
  v.unexploreRect(e.owner, x1, y1, x2, y2);
}

/**
 * The line-of-sight part of `RGE_Static_Object::set_object_state` (src/stat_obj.cpp:1938-1949, visibility.md §3.3), run
 * before the state changes: an active object starting to die trades its sight for its footprint; reaching pending
 * removal takes the footprint away.
 */
export function stateChanged(ctx: VisibilityContext, e: Entity, t: UnitType, next: number): void {
  if (next >= ObjectState.Dying && e.state === ObjectState.Active) {
    unexploreObject(ctx, e, t, false);
    if (t.los > 0) exploreObject(ctx, e, t, true);
  }
  if (e.state < ObjectState.PendingRemoval && next === ObjectState.PendingRemoval && t.los > 0) unexploreObject(ctx, e, t, true);
}

/**
 * The visible-unit part of `RGE_Combat_Object::update` (src/com_obj.cpp:432-451, visibility.md §4.1): after its actions
 * a combat object reads the unified cell of its tile and, when it changed since its last update, updates its records.
 */
export function refreshSighting(ctx: VisibilityContext, e: Entity, t: UnitType): void {
  const v = ctx.visibility;
  if (!v) return;
  const x = toInt(e.x);
  const y = toInt(e.y);
  const next = v.cell(x, y);
  const prior = e.sighted ?? 0;
  e.sighted = next;
  if (next !== prior) v.updateUnitInfo(e.id, e.owner, x, y, t.group, prior, next);
}

/** `~RGE_Combat_Object` (src/com_obj.cpp:40-45): a removed combat object leaves every list it is in. */
export function forgetSighting(ctx: VisibilityContext, e: Entity, t: UnitType): void {
  const v = ctx.visibility;
  if (!v || !e.sighted) return;
  v.updateUnitInfo(e.id, e.owner, toInt(e.x), toInt(e.y), t.group, e.sighted, 0);
  e.sighted = 0;
}
