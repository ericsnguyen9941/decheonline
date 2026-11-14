/**
 * The obstruction map, `passable` and the tile A* (`PathingSystem` in the original, docs/spec/movement.md §4, §7).
 * Integer costs are in 1/16 tile. The search keeps the original's quirks on purpose: the heap pop sifts only while
 * `hole < n / 2`, the heuristic overestimates diagonals, there is no closed set, a turn costs +1, and a failed search
 * still returns a path to the tile that came closest.
 */
import type { Entity } from './entities';
import type { Hasher } from './hash';
import type { TileMap } from './map';
import { add32, f32, mul32, sub32, toInt } from './num';
import { unitType, type UnitType } from './units';

/** Obstruction cells per tile along each axis (movement.md §3). */
export const CELLS_PER_TILE = 4;
/** `numberPathingIterations` for "Path Finding: low", the default (movement.md §3). */
export const DEFAULT_PATHING_ITERATIONS = 2500;
const HARD_ITERATION_CAP = 20000;
/** Max waypoints in a path: an insert is refused once the path holds more than 1000 (movement.md §3). */
const MAX_WAYPOINTS = 1001;

/** `D[i] = (int)(0.5 + i * 1.4142 * 16)`: the heuristic's diagonal cost table (movement.md §3). */
const DIAGONAL = Array.from({ length: 256 }, (_, i) => Math.trunc(0.5 + i * 1.4142 * 16));
/** Neighbour offsets in expansion order (movement.md §7.4 step 5). */
const DIR_X = [-1, 0, 1, 1, 1, 0, -1, -1];
const DIR_Y = [-1, -1, -1, 0, 1, 1, 1, 0];
/** Per arrival direction (8 = none), the directions never tried next: the reverse and its two neighbours. */
const FACET_SKIP_MASK = [56, 112, 224, 193, 131, 7, 14, 28, 0];
const NO_FACET = 0xff;

const F100 = f32(100);
const F_ROUNDING = f32(0.00005);
const F100_LARGE = f32(100.000053);
const HALF = f32(0.5);

/** Octile estimate with the diagonal table (`estimate`, movement.md §7.1). */
export function estimate(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  const diagonal = Math.min(dx, dy);
  return DIAGONAL[diagonal & 0xff]! + 16 * (Math.max(dx, dy) - diagonal);
}

/** `trunc(16 * sqrt(dx^2 + dy^2))` for integer deltas: path costs and the iteration cap. */
function scaledDistance(dx: number, dy: number): number {
  return Math.trunc(Math.sqrt(dx * dx + dy * dy) * 16);
}

/** Iteration cap of one search (movement.md §7.3): whole-tile distance times the budget, / 10 up to 10 tiles, else / 100. */
export function iterationCap(sx: number, sy: number, gx: number, gy: number, budget: number, owner: number): number {
  const dist = Math.trunc(scaledDistance(gx - sx, gy - sy) / 16);
  let cap = Math.trunc((dist * budget) / (dist <= 10 ? 10 : 100));
  if (owner === 0 && cap > 100) cap = 100;
  return cap;
}

export interface Waypoint {
  x: number;
  y: number;
  z: number;
  /** Arrival direction of the tile in the search, 0xff for none. */
  facet: number;
}

export interface PathResult {
  /** The search reached the goal (a failed search still leaves a partial path). */
  found: boolean;
  /** `[start, turn points..., end tile]`, each at tile + offset; empty when the search was refused. */
  path: Waypoint[];
}

/**
 * The search's open list: a 1-based binary heap of (x, y, total) with a sentinel in slot 0, kept with the original's
 * operations, including its broken pop (movement.md §7.4 step 4, §13.5).
 */
export class OpenList {
  x = new Int32Array(1024);
  y = new Int32Array(1024);
  total = new Int32Array(1024);
  size = 0;

  constructor() {
    this.total[0] = -2000000000;
  }

  /** Append and sift up on strict `<`. */
  push(x: number, y: number, total: number): void {
    let i = ++this.size;
    if (i >= this.total.length) this.grow();
    const { x: hx, y: hy, total: ht } = this;
    while (total < ht[i >> 1]!) {
      hx[i] = hx[i >> 1]!;
      hy[i] = hy[i >> 1]!;
      ht[i] = ht[i >> 1]!;
      i >>= 1;
    }
    hx[i] = x;
    hy[i] = y;
    ht[i] = total;
  }

  /** Last entry to slot 1, then sift down only while `hole < size / 2`, so small heaps are not re-sorted. */
  pop(): void {
    const { x: hx, y: hy, total: ht } = this;
    const n = --this.size;
    const mx = hx[n + 1]!;
    const my = hy[n + 1]!;
    const mt = ht[n + 1]!;
    let hole = 1;
    while (hole < Math.trunc(n / 2)) {
      let child = hole * 2;
      if (child < n && ht[child + 1]! < ht[child]!) child++;
      if (mt < ht[child]!) break;
      hx[hole] = hx[child]!;
      hy[hole] = hy[child]!;
      ht[hole] = ht[child]!;
      hole = child;
    }
    hx[hole] = mx;
    hy[hole] = my;
    ht[hole] = mt;
  }

  private grow(): void {
    const twice = (a: Int32Array) => {
      const b = new Int32Array(a.length * 2);
      b.set(a);
      return b;
    };
    this.x = twice(this.x);
    this.y = twice(this.y);
    this.total = twice(this.total);
  }
}

/** The per-tile search arrays and the obstruction map of one map. Only the obstruction counts are game state. */
export class PathingSystem {
  /** Per cell a saturating counter 0..3, indexed `cx * cellsY + cy`. A cell is blocked when non-zero. */
  readonly cells: Uint8Array;
  readonly cellsX: number;
  readonly cellsY: number;
  /** Budget per search (`numberPathingIterations`). */
  iterations = DEFAULT_PATHING_ITERATIONS;

  private readonly cost: Int32Array;
  private readonly facet: Uint8Array;
  private readonly visited: Uint32Array;
  private generation = 0;
  private readonly open = new OpenList();

  constructor(
    readonly map: TileMap,
    readonly objects: { get(id: number): Entity | undefined },
  ) {
    // One spare cell row/column: a footprint's exclusive maximum can reach 4 * size.
    this.cellsX = map.width * CELLS_PER_TILE + 1;
    this.cellsY = map.height * CELLS_PER_TILE + 1;
    this.cells = new Uint8Array(this.cellsX * this.cellsY);
    const tiles = map.width * map.height;
    this.cost = new Int32Array(tiles);
    this.facet = new Uint8Array(tiles);
    this.visited = new Uint32Array(tiles);
  }

  obstruction(cx: number, cy: number): number {
    if (cx < 0 || cy < 0 || cx >= this.cellsX || cy >= this.cellsY) return 0;
    return this.cells[cx * this.cellsY + cy]!;
  }

  private bump(cx: number, cy: number, by: 1 | -1): void {
    if (cx < 0 || cy < 0 || cx >= this.cellsX || cy >= this.cellsY) return;
    const i = cx * this.cellsY + cy;
    const v = this.cells[i]! + by;
    if (v >= 0 && v <= 3) this.cells[i] = v;
  }

  private footprint(e: Entity, t: UnitType, by: 1 | -1): void {
    const minX = Math.max(0, toInt(mul32(sub32(e.x, t.radiusX), 4)));
    const minY = Math.max(0, toInt(mul32(sub32(e.y, t.radiusY), 4)));
    const maxX = toInt(mul32(add32(t.radiusX, e.x), 4));
    const maxY = toInt(mul32(add32(t.radiusY, e.y), 4));
    for (let x = minX; x < maxX; x++) for (let y = minY; y < maxY; y++) this.bump(x, y, by);
  }

  /** `addToObstructionMap`: only colliding units, only once. Returns whether it stamped. */
  stamp(e: Entity, t: UnitType): boolean {
    const m = e.mover;
    if (t.radiusZ <= 0 || !m || m.stamped) return false;
    this.footprint(e, t, 1);
    m.stamped = true;
    return true;
  }

  /** `removeFromObstructionMap`. Returns whether it was stamped. */
  unstamp(e: Entity, t: UnitType): boolean {
    const m = e.mover;
    if (t.radiusZ <= 0 || !m || !m.stamped) return false;
    this.footprint(e, t, -1);
    m.stamped = false;
    return true;
  }

  /** Terrain rule of `passable` step 2 for one tile; out-of-map tiles fail. */
  private tileOk(t: UnitType, tx: number, ty: number): boolean {
    if (!this.map.inBounds(tx, ty)) return false;
    // No tile borders exist yet, so the underlay exception (border_type & 0x0f != 0) never applies.
    return (t.terrainTable[this.map.terrainAt(tx, ty) & 0x1f] ?? 0) > 0;
  }

  private cellsClear(minX: number, maxX: number, minY: number, maxY: number): boolean {
    if (maxY - minY - 1 < 0) return true;
    for (let cx = minX; cx < maxX; cx++) for (let cy = minY; cy < maxY; cy++) if (this.obstruction(cx, cy) !== 0) return false;
    return true;
  }

  /** `passable(obj, x, y, checkTerrain)` (movement.md §4.1): footprint at (x, y) against terrain and other units. */
  passable(e: Entity, t: UnitType, x: number, y: number, checkTerrain = true): boolean {
    const ox = sub32(x, Math.floor(x));
    const oy = sub32(y, Math.floor(y));
    // The +-100 / 400 offsets make the truncation act as floor (movement.md §4.1 step 1).
    let minX = toInt(x) * 4 - toInt(mul32(sub32(add32(ox, F100), t.radiusX), -4)) - 400;
    let minY = toInt(y) * 4 - toInt(mul32(sub32(add32(oy, F100), t.radiusY), -4)) - 400;
    const maxX = toInt(x) * 4 - toInt(mul32(add32(add32(t.radiusX, ox), F100), -4)) - 400;
    const maxY = toInt(y) * 4 - toInt(mul32(add32(add32(t.radiusY, oy), F100), -4)) - 400;
    if (minX < 0) minX++;
    if (minY < 0) minY++;
    if (checkTerrain) {
      if (maxX >> 2 >= this.map.width || maxY >> 2 >= this.map.height) return false;
      for (let ty = minY >> 2; ty <= maxY >> 2; ty++) {
        for (let tx = minX >> 2; tx <= maxX >> 2; tx++) if (!this.tileOk(t, tx, ty)) return false;
      }
    }
    const was = this.unstamp(e, t);
    const clear = this.cellsClear(minX, maxX, minY, maxY);
    if (was) this.stamp(e, t);
    return clear;
  }

  /**
   * `findTilePath` from tile (sx, sy) to tile (gx, gy) for a point move (no target object), copying the result into
   * a waypoint list (movement.md §7). `range` is the action range; `group` the unit's pathing group, unstamped during
   * the search when `continueCounter >= 10`.
   */
  findTilePath(e: Entity, t: UnitType, sx: number, sy: number, gx: number, gy: number, range: number): PathResult {
    const m = e.mover!;
    const w = this.map.width;
    // Both axes are compared with the x size (movement.md §7.1).
    if (sx < 0 || sy < 0 || sx > w || sy > w || gx < 0 || gy < 0 || gx > w || gy > w) return { found: false, path: [] };
    if (range > 1 && estimate(gx, gy, sx, sy) < mul32(range, 16)) return { found: true, path: [] };

    const selfStamped = this.unstamp(e, t);
    let offX: number;
    let offY: number;
    if (this.passable(e, t, f32(Math.floor(e.x) + 0.5), f32(Math.floor(e.y) + 0.5))) {
      offX = HALF;
      offY = HALF;
    } else {
      offX = sub32(e.x, Math.floor(e.x));
      offY = sub32(e.y, Math.floor(e.y));
    }

    const unstamped: Entity[] = [];
    if (m.continueCounter >= 10) {
      for (const id of m.group) {
        const other = id === e.id ? undefined : this.objects.get(id);
        const om = other?.mover;
        if (!other || !om) continue;
        if (om.waitingToMove || om.speed !== 0 || om.collisionAvoidanceDistance > 0) {
          if (this.unstamp(other, unitType(other.type))) unstamped.push(other);
        }
      }
    }

    const result = this.run(e, t, sx, sy, gx, gy, range, offX, offY);

    for (const other of unstamped) this.stamp(other, unitType(other.type));
    if (selfStamped) this.stamp(e, t);
    return result;
  }

  private run(
    e: Entity,
    t: UnitType,
    sx: number,
    sy: number,
    gx: number,
    gy: number,
    range: number,
    offX: number,
    offY: number,
  ): PathResult {
    const { width: w, height: h } = this.map;
    const gen = ++this.generation;
    const { cost, facet, visited } = this;
    const at = (x: number, y: number) => y * w + x;
    const arrival = (i: number) => (visited[i] === gen ? facet[i]! : NO_FACET);

    const startH = estimate(gx, gy, sx, sy);
    cost[at(sx, sy)] = startH;
    const open = this.open;
    open.size = 0;
    open.push(sx, sy, startH);
    let bestX = sx;
    let bestY = sy;
    let bestTotal = startH;
    const tolerance = range >= 1 ? toInt(mul32(range, 16)) : 16;

    // Swept-footprint deltas in tiles and cells from the waypoint offset (movement.md §7.2; same floor trick as passable).
    const fxl = sub32(add32(offX, F100), t.radiusX);
    const fyl = sub32(add32(offY, F100), t.radiusY);
    const rxo = add32(t.radiusX, offX);
    const ryo = add32(t.radiusY, offY);
    const dLeft = toInt(add32(fxl, F_ROUNDING)) - 100;
    const dUp = toInt(add32(fyl, F_ROUNDING)) - 100;
    const dRight = toInt(add32(rxo, F100_LARGE)) - 100;
    const dDown = toInt(add32(ryo, F100_LARGE)) - 100;
    const dLeft4 = -400 - toInt(mul32(fxl, -4));
    const dUp4 = -400 - toInt(mul32(fyl, -4));
    const dRight4 = -400 - toInt(mul32(add32(rxo, F100), -4));
    const dDown4 = -400 - toInt(mul32(add32(ryo, F100), -4));

    const cap = iterationCap(sx, sy, gx, gy, this.iterations, e.owner);
    let iterations = 0;
    while (open.size > 0) {
      if (this.iterations !== -1 && iterations > cap) break;
      if (iterations > HARD_ITERATION_CAP) break;
      const bx = open.x[1]!;
      const by = open.y[1]!;
      const b = at(bx, by);
      const est = scaledDistance(gx - bx, gy - by);
      if (est < tolerance) return this.copyPath(e, sx, sy, offX, offY, true);
      if (est < bestTotal) {
        bestTotal = est;
        bestX = bx;
        bestY = by;
      }
      open.pop();

      const from = arrival(b);
      const skip = FACET_SKIP_MASK[from === NO_FACET ? 8 : from]!;
      for (let i = 0; i < 8; i++) {
        if (skip & (1 << i)) continue;
        const nx = bx + DIR_X[i]!;
        const ny = by + DIR_Y[i]!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (nx === sx && ny === sy) continue;
        const ni = at(nx, ny);
        let total = estimate(gx, gy, nx, ny) + scaledDistance(nx - bx, ny - by) + cost[b]! - estimate(gx, gy, bx, by);
        if (visited[ni] === gen && cost[ni]! <= total) continue;

        // The box swept by the footprint between B and N, in tiles and in cells.
        const loX = Math.min(bx, nx);
        const hiX = Math.max(bx, nx);
        const loY = Math.min(by, ny);
        const hiY = Math.max(by, ny);
        let minScanX = loX + dLeft;
        let minScanY = loY + dUp;
        const maxScanX = hiX + dRight;
        const maxScanY = hiY + dDown;
        let minX4 = loX * 4 + dLeft4;
        let minY4 = loY * 4 + dUp4;
        const maxX4 = hiX * 4 + dRight4;
        const maxY4 = hiY * 4 + dDown4;
        if (minScanX < 0) minScanX++;
        if (minScanY < 0) minScanY++;
        if (minX4 < 0) minX4++;
        if (minY4 < 0) minY4++;
        if (!this.sweepTerrainOk(t, minScanX, minScanY, maxScanX, maxScanY, sx, sy)) continue;
        if (!this.cellsClear(minX4, maxX4, minY4, maxY4)) continue;

        if (i !== from) total++;
        cost[ni] = total;
        facet[ni] = i;
        visited[ni] = gen;
        open.push(nx, ny, total);
      }
      iterations++;
    }

    // Exhausted or capped: path to the tile that came closest, and report failure (movement.md §7.5).
    open.push(bestX, bestY, 0);
    return this.copyPath(e, sx, sy, offX, offY, false);
  }

  /** Terrain sweep of a step; the scan bounds are bytes in the original, so they wrap like `& 0xff`. */
  private sweepTerrainOk(t: UnitType, minX: number, minY: number, maxX: number, maxY: number, sx: number, sy: number): boolean {
    const x0 = minX & 0xff;
    const y0 = minY & 0xff;
    const x1 = maxX & 0xff;
    const y1 = maxY & 0xff;
    if (x1 >= this.map.width || y1 >= this.map.height) return false;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tx === sx && ty === sy) continue;
        if (!this.tileOk(t, tx, ty)) return false;
      }
    }
    return true;
  }

  /**
   * `copyPath` (movement.md §7.5): walk back from the heap top along arrival directions to the start tile, keeping
   * a waypoint where the direction changes. A path over the waypoint limit is killed and the search fails.
   */
  private copyPath(e: Entity, sx: number, sy: number, offX: number, offY: number, found: boolean): PathResult {
    const w = this.map.width;
    const gen = this.generation;
    const facetAt = (x: number, y: number) => (this.visited[y * w + x] === gen ? this.facet[y * w + x]! : NO_FACET);
    let x = this.open.x[1]!;
    let y = this.open.y[1]!;
    let current = facetAt(x, y);
    let previous = NO_FACET;
    const reversed: Waypoint[] = [];
    const waypoint = (): Waypoint => ({ x: add32(x, offX), y: add32(y, offY), z: e.z, facet: current });
    for (let guard = 0; guard <= w * this.map.height; guard++) {
      if (x === sx && y === sy) {
        reversed.push(waypoint());
        return reversed.length > MAX_WAYPOINTS ? { found: false, path: [] } : { found, path: reversed.reverse() };
      }
      if (current !== previous) {
        reversed.push(waypoint());
        if (reversed.length > MAX_WAYPOINTS) return { found: false, path: [] };
      }
      if (current === NO_FACET) break;
      x -= DIR_X[current]!;
      y -= DIR_Y[current]!;
      previous = current;
      current = facetAt(x, y);
    }
    return { found: false, path: [] };
  }

  hashInto(h: Hasher): void {
    // 16 two-bit counters per word.
    h.u32(this.cellsX).u32(this.cellsY);
    for (let i = 0; i < this.cells.length; i += 16) {
      let word = 0;
      for (let j = 0; j < 16 && i + j < this.cells.length; j++) word |= this.cells[i + j]! << (2 * j);
      h.u32(word);
    }
  }
}
