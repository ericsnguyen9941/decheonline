import { describe, expect, test } from 'vitest';
import { findPath, MapStack, NONE } from './rmm-base';
import { scriptedRand } from './rmm-testing';

/** The nodes on `head`'s list, in order. */
function list(stack: MapStack, head: number): number[] {
  const out: number[] = [];
  for (let n = stack.next[head]!; n !== NONE; n = stack.next[n]!) out.push(n);
  return out;
}

describe('MapStack (src/rmm_base.cpp push/pop/add/remove/deinit)', () => {
  test('push keeps the list sorted by total cost; equal costs go before the older node', () => {
    const s = new MapStack(4, 4);
    const h = s.head();
    s.push(h, 0, 0, 0, 5);
    s.push(h, 1, 0, 0, 3);
    s.push(h, 2, 0, 0, 5);
    s.push(h, 3, 0, 0, 9);
    expect(list(s, h)).toEqual([1, 2, 0, 3]);
    expect([s.pop(h), s.pop(h), s.pop(h), s.pop(h), s.pop(h)]).toEqual([1, 2, 0, 3, NONE]);
  });

  test('a node is in one list at most: pushing it again moves it', () => {
    const s = new MapStack(4, 4);
    const a = s.head();
    const b = s.head();
    s.push(a, 1, 1, 0, 0);
    s.push(a, 2, 1, 0, 0);
    s.push(b, 1, 1, 0, 0);
    expect(list(s, a)).toEqual([6]);
    expect(list(s, b)).toEqual([5]);
  });

  test('push stores the costs as floats', () => {
    const s = new MapStack(2, 2);
    const h = s.head();
    s.push(h, 1, 0, 0.1, 0.1);
    expect(s.cost[1]).toBe(Math.fround(0.1));
    expect(s.tot[1]).toBe(Math.fround(0.1));
  });

  test('deinit detaches the list from its head but the nodes stay linked to each other', () => {
    const s = new MapStack(4, 1);
    const h = s.head();
    s.push(h, 0, 0, 0, 0);
    s.push(h, 1, 0, 0, 0);
    s.deinit(h);
    expect(s.next[h]).toBe(NONE);
    expect(s.prev[1]).toBe(NONE);
    expect(s.next[1]).toBe(0);
    expect(s.linked(0)).toBe(true);
  });

  test('clear unlinks every tile node', () => {
    const s = new MapStack(3, 3);
    const h = s.head();
    for (let i = 0; i < 9; i++) s.push(h, i % 3, Math.trunc(i / 3), 0, i);
    s.clear();
    expect(Array.from({ length: 9 }, (_, i) => s.linked(i))).toEqual(new Array(9).fill(false));
  });
});

describe('randomize_stack (src/rmm_base.cpp:371)', () => {
  test('two passes: one draw per node per pass deals it to bucket r*100/32767; buckets are gathered in pairs to the front', () => {
    const s = new MapStack(3, 1);
    const h = s.head();
    for (let x = 2; x >= 0; x--) s.push(h, x, 0, 0, 0);
    expect(list(s, h)).toEqual([0, 1, 2]);
    // Pass 1: 0 -> bucket 0, 1 -> bucket 50, 2 -> bucket 0 (bucket 0 is then [2, 0]). Gathering adds each node at the
    // front: 2, then 0, then 1 -> [1, 0, 2]. Pass 2: all to bucket 1 -> bucket 1 is [2, 0, 1] -> gathered [1, 0, 2].
    const r = scriptedRand([0, 16384, 0, 400, 400, 400]);
    s.randomize(h, r);
    expect(r.used).toBe(6);
    expect(list(s, h)).toEqual([1, 0, 2]);
  });

  test('a draw of 32767 deals the node to bucket 100, past the original array: it is never gathered back', () => {
    // Empiresx.exe 1.0a 0x46d5d0: bucket 100 is the return address slot; its `next` is the caller's saved ebp, which
    // is 0 there, so the node only leaves the list (random-maps.md §5.5).
    const s = new MapStack(3, 1);
    const h = s.head();
    for (let x = 2; x >= 0; x--) s.push(h, x, 0, 0, 0);
    const r = scriptedRand([0, 32767, 0, 0, 0]);
    s.randomize(h, r);
    expect(r.used).toBe(5);
    expect(list(s, h).sort()).toEqual([0, 2]);
    expect(s.linked(1)).toBe(true);
  });
});

describe('find_path (src/rmm_base.cpp:409)', () => {
  const W = 8;
  const grass = (terrain: Uint8Array) => (x: number, y: number) => terrain[y * W + x]!;
  const costs = [1, 7, 1, 0, 2];

  test('reaches the target and marks each tile with the direction it was entered from', () => {
    const terrain = new Uint8Array(W * W);
    const s = new MapStack(W, W);
    const search = new Uint8Array(W * W);
    const head = s.head();
    expect(findPath(s, search, grass(terrain), head, 1, 1, 5, 1, costs)).toEqual([5, 1]);
    // Walk back from the target: 4 means the tile was entered from x+1, 5 from x-1, 6 from y+1, 7 from y-1, 8-11
    // diagonals; the start is 3.
    let [x, y] = [5, 1];
    const steps: number[] = [];
    for (let guard = 0; guard < 20; guard++) {
      const mark = search[y * W + x]!;
      steps.push(mark);
      if (mark === 3) break;
      if (mark === 4) x++;
      else if (mark === 5) x--;
      else if (mark === 6) y++;
      else if (mark === 7) y--;
      else throw new Error(`mark ${mark}`);
    }
    expect([x, y]).toEqual([1, 1]);
    expect(steps).toEqual([5, 5, 5, 5, 3]);
  });

  test('an impassable target fails at once with only the start and target marked', () => {
    const terrain = new Uint8Array(W * W);
    terrain[2 * W + 6] = 3;
    const s = new MapStack(W, W);
    const search = new Uint8Array(W * W);
    expect(findPath(s, search, grass(terrain), s.head(), 1, 1, 6, 2, costs)).toBeNull();
    expect([...search].filter((v) => v !== 0).sort()).toEqual([2, 3]);
  });

  test('goes round an impassable wall and fails when the target is walled in', () => {
    const terrain = new Uint8Array(W * W);
    for (let y = 0; y < W - 1; y++) terrain[y * W + 4] = 3;
    const s = new MapStack(W, W);
    const search = new Uint8Array(W * W);
    expect(findPath(s, search, grass(terrain), s.head(), 1, 1, 6, 1, costs)).toEqual([6, 1]);
    terrain[(W - 1) * W + 4] = 3;
    expect(findPath(s, search, grass(terrain), s.head(), 1, 1, 6, 1, costs)).toBeNull();
  });

  test('a diagonal step needs both straight neighbours open, but a diagonal target is reached anyway', () => {
    // Start (1,1) walled in on its four straight sides and three diagonals; only (2,2) is open.
    const enclosed = new Uint8Array(W * W);
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [2, 1],
      [0, 2],
      [1, 2],
    ] as const)
      enclosed[y * W + x] = 3;
    const s = new MapStack(W, W);
    const search = new Uint8Array(W * W);
    // (2,2) is never pushed, so (3,3) cannot be reached.
    expect(findPath(s, search, grass(enclosed), s.head(), 1, 1, 3, 3, costs)).toBeNull();
    expect(search[2 * W + 2]).toBe(0);
    // The target itself is taken from any neighbour, diagonal or not (src/rmm_base.cpp:541-546).
    expect(findPath(s, search, grass(enclosed), s.head(), 1, 1, 2, 2, costs)).toEqual([2, 2]);
    expect(search[2 * W + 2]).toBe(11);
  });
});
