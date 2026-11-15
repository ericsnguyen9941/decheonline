/**
 * The random map modules' shared resources (`RGE_Random_Map_Module`, src/rmm_base.cpp; docs/spec/random-maps.md §5.1):
 * one list node per tile, list heads, the byte search map, `randomize_stack` and the 6-argument `find_path`.
 * Node `y * width + x` is tile (x, y); heads are numbered after the tiles and never reused, so a node left pointing at
 * a finished head (as `deinit_stack` leaves the rest of a list) cannot reach a live one.
 */
import { f32 } from './num';
import type { CrtRand } from './rng';

export const NONE = -1;

export class MapStack {
  readonly next: number[];
  readonly prev: number[];
  readonly cost: number[];
  readonly tot: number[];

  constructor(readonly width: number, readonly height: number) {
    const n = width * height;
    this.next = new Array<number>(n).fill(NONE);
    this.prev = new Array<number>(n).fill(NONE);
    this.cost = new Array<number>(n).fill(0);
    this.tot = new Array<number>(n).fill(0);
  }

  /** `init_stack`: a fresh empty head. */
  head(): number {
    this.next.push(NONE);
    this.prev.push(NONE);
    this.cost.push(0);
    this.tot.push(0);
    return this.next.length - 1;
  }

  node(x: number, y: number): number {
    return y * this.width + x;
  }

  /** `deinit_stack`: detach the list from its head; the nodes stay chained to each other. */
  deinit(head: number): void {
    const first = this.next[head]!;
    if (first !== NONE) {
      this.prev[first] = NONE;
      this.next[head] = NONE;
    }
  }

  /** `push_stack`: insert before the first node whose total cost is not below `tot` (equal costs pop newest first). */
  push(head: number, x: number, y: number, cost: number, tot: number): void {
    const node = this.node(x, y);
    this.remove(node);
    let current = this.next[head]!;
    const total = f32(tot);
    if (current !== NONE && this.tot[current]! < total) {
      let prev: number;
      do {
        prev = current;
        current = this.next[current]!;
      } while (current !== NONE && this.tot[current]! < total);
      this.add(prev, node);
    } else {
      this.add(head, node);
    }
    this.cost[node] = f32(cost);
    this.tot[node] = total;
  }

  /** `pop_stack`: unlink and return the first node, or NONE. */
  pop(head: number): number {
    const node = this.next[head]!;
    if (node === NONE) return NONE;
    this.remove(node);
    return node;
  }

  /** `add_stack_node`: link `node` right after `after` (a head or a node), unlinking it first. */
  add(after: number, node: number): void {
    if (this.next[node] !== NONE || this.prev[node] !== NONE) this.remove(node);
    const next = this.next[after]!;
    this.prev[node] = after;
    this.next[node] = next;
    if (next !== NONE) this.prev[next] = node;
    this.next[after] = node;
  }

  /** `remove_stack_node`. */
  remove(node: number): void {
    const prev = this.prev[node]!;
    const next = this.next[node]!;
    if (prev !== NONE) this.next[prev] = next;
    if (next !== NONE) this.prev[next] = prev;
    this.next[node] = NONE;
    this.prev[node] = NONE;
  }

  /** `clear_stack`: unlink every tile node (heads keep their pointers). */
  clear(): void {
    const n = this.width * this.height;
    for (let i = 0; i < n; i++) {
      this.next[i] = NONE;
      this.prev[i] = NONE;
    }
  }

  /** `check_stack`: true when the node is in a list. */
  linked(node: number): boolean {
    return this.next[node] !== NONE || this.prev[node] !== NONE;
  }

  /**
   * `randomize_stack` (src/rmm_base.cpp:371-397): twice, deal every node to one of 100 buckets by a draw, then gather
   * bucket pairs back to the front. A draw of 32767 gives bucket 100, one past the original's array; that node is
   * never gathered back (random-maps.md §5.5).
   */
  randomize(head: number, rng: CrtRand): void {
    const buckets: number[] = [];
    for (let i = 0; i <= 100; i++) buckets.push(this.head());
    for (let pass = 0; pass < 2; pass++) {
      while (this.next[head] !== NONE) {
        const j = Math.trunc((rng.rand() * 100) / 0x7fff);
        this.add(buckets[j]!, this.next[head]!);
      }
      for (let j = 0; j < 100; j += 2) {
        const a = buckets[j]!;
        const b = buckets[j + 1]!;
        while (this.next[a] !== NONE || this.next[b] !== NONE) {
          if (this.next[a] !== NONE) this.add(head, this.next[a]!);
          if (this.next[b] !== NONE) this.add(head, this.next[b]!);
        }
      }
    }
  }
}

/** `g_rmm_path_*` (src/game_globals.cpp:290-294). */
const PATH_TERRAIN_ADJUSTMENT = f32(-1.36);
const PATH_VERTICAL = f32(0.41);
const PATH_VERTICAL_SMALL = f32(0.4);

/**
 * The 6-argument `find_path` (src/rmm_base.cpp:409-657): a best-first search over the search map from (x, y) to the
 * target, marking each reached tile with the direction it was entered from (4 left, 5 right, 6 up, 7 down, 8-11
 * diagonals; 1 blocked, 2 the target, 3 the start). Returns the tile next to the target the path ends on, or null.
 * `terrain` is the cost per terrain id, 0 impassable.
 */
export function findPath(
  stack: MapStack,
  search: Uint8Array,
  terrainAt: (x: number, y: number) => number,
  head: number,
  x: number,
  y: number,
  endX: number,
  endY: number,
  terrain: readonly number[],
): [number, number] | null {
  const w = stack.width;
  const maxX = stack.width - 1;
  const maxY = stack.height - 1;
  let pathCost = f32(0);
  stack.clear();
  search.fill(0);
  search[y * w + x] = 3;
  search[endY * w + endX] = 2;
  const costOf = (t: number) => terrain[t] ?? 0;
  if (!(costOf(terrainAt(endX, endY)) > 0)) return null;
  for (;;) {
    const dx = x - endX;
    const dy = y - endY;
    const cost = f32(Math.sqrt(dx * dx + dy * dy));
    if (cost === 0) {
      const first = stack.next[head]!;
      if (first !== NONE) stack.prev[first] = NONE;
      return [endX, endY];
    }
    let down = false;
    let up = false;
    let side: boolean;
    let hcost = 0;
    // One straight neighbour: 'open' when it was pushed now or is reachable from before.
    const straight = (nx: number, ny: number, mark: number): boolean | [number, number] => {
      const state = search[ny * w + nx]!;
      if (state === 0) {
        const c = costOf(terrainAt(nx, ny));
        if (c > 0) {
          const calc = f32(pathCost + c);
          search[ny * w + nx] = mark;
          stack.push(head, nx, ny, calc, f32(calc + hcost));
          return true;
        }
        search[ny * w + nx] = 1;
        return false;
      }
      if (state === 2) {
        search[ny * w + nx] = mark;
        return [nx, ny];
      }
      return state !== 1;
    };
    const diagonal = (nx: number, ny: number, mark: number, open: boolean, adjust: number): [number, number] | null => {
      const state = search[ny * w + nx]!;
      if (state === 0) {
        const c = costOf(terrainAt(nx, ny));
        if (!(c > 0)) search[ny * w + nx] = 1;
        else if (open) {
          const calc = f32(pathCost - f32(c * PATH_TERRAIN_ADJUSTMENT));
          search[ny * w + nx] = mark;
          stack.push(head, nx, ny, calc, f32(calc + f32(hcost - adjust)));
        }
      } else if (state === 2) {
        search[ny * w + nx] = mark;
        return [nx, ny];
      }
      return null;
    };
    if (y < maxY) {
      hcost = f32(cost - (y < endY ? 1 : -1));
      const r = straight(x, y + 1, 7);
      if (Array.isArray(r)) return r;
      down = r;
    }
    if (y > 0) {
      hcost = f32(cost - (endY < y ? 1 : -1));
      const r = straight(x, y - 1, 6);
      if (Array.isArray(r)) return r;
      up = r;
    }
    if (x > 0) {
      hcost = f32(cost - (endX < x ? 1 : -1));
      const r = straight(x - 1, y, 4);
      if (Array.isArray(r)) return r;
      side = r;
      if (y > 0) {
        const d = diagonal(x - 1, y - 1, 8, up && side, endY < y ? PATH_VERTICAL : -PATH_VERTICAL);
        if (d) return d;
      }
      if (y < maxY) {
        const d = diagonal(x - 1, y + 1, 9, down && side, y < endY ? PATH_VERTICAL : -PATH_VERTICAL);
        if (d) return d;
      }
    }
    if (x < maxX) {
      hcost = f32(cost - (x < endX ? 1 : -1));
      const r = straight(x + 1, y, 5);
      if (Array.isArray(r)) return r;
      side = r;
      if (y > 0) {
        const d = diagonal(x + 1, y - 1, 10, up && side, endY < y ? PATH_VERTICAL_SMALL : -PATH_VERTICAL_SMALL);
        if (d) return d;
      }
      if (y < maxY) {
        const d = diagonal(x + 1, y + 1, 11, down && side, y < endY ? PATH_VERTICAL_SMALL : -PATH_VERTICAL_SMALL);
        if (d) return d;
      }
    }
    const node = stack.pop(head);
    if (node === NONE) return null;
    x = node % w;
    y = Math.trunc(node / w);
    pathCost = stack.cost[node]!;
  }
}
