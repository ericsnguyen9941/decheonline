import { describe, expect, test } from 'vitest';
import { generateShallows, makeTribeConnections } from './rmm-shallows';
import { afterDraws, nextDraws, rmmFixture } from './rmm-testing';

const W = 20;
const TERRAIN_WATER = 1;
const TERRAIN_SHALLOWS = 4;

/** A 20x20 grass map with columns 8..11 water. */
function strait(seed: number) {
  const f = rmmFixture(W, W, seed);
  for (let y = 0; y < W; y++) for (let x = 8; x <= 11; x++) f.map.terrain[y * W + x] = TERRAIN_WATER;
  return f;
}

/** True when a 4-connected walk over tiles that are not water or deep water joins the two tiles. */
function walkable(terrain: Uint8Array, from: [number, number], to: [number, number]): boolean {
  const seen = new Uint8Array(W * W);
  const queue = [from[1] * W + from[0]];
  seen[queue[0]!] = 1;
  while (queue.length > 0) {
    const i = queue.shift()!;
    if (i === to[1] * W + to[0]) return true;
    const x = i % W;
    for (const [n, ok] of [
      [i - 1, x > 0],
      [i + 1, x < W - 1],
      [i - W, i >= W],
      [i + W, i < W * (W - 1)],
    ] as const) {
      if (ok && !seen[n] && terrain[n] !== TERRAIN_WATER && terrain[n] !== 22) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  return false;
}

describe('Shallows::make_tribe_connections (src/rmm_shal.cpp:65)', () => {
  test('a ford of shallows joins two lands across a strait', () => {
    const f = strait(11);
    expect(walkable(f.map.terrain, [3, 10], [16, 10])).toBe(false);
    makeTribeConnections(f.m, f.stack, f.search, [3, 10], [16, 10]);
    expect(walkable(f.map.terrain, [3, 10], [16, 10])).toBe(true);
    const shallows = f.map.terrain.reduce((n, t) => n + (t === TERRAIN_SHALLOWS ? 1 : 0), 0);
    expect(shallows).toBeGreaterThanOrEqual(4);
    // Only water became shallows.
    for (let i = 0; i < W * W; i++) if (f.map.terrain[i] === TERRAIN_SHALLOWS) expect([8, 9, 10, 11]).toContain(i % W);
  });

  test('on land the path draws nothing and changes nothing', () => {
    const f = rmmFixture(W, W, 4);
    makeTribeConnections(f.m, f.stack, f.search, [2, 2], [17, 15]);
    expect(f.map.terrain.every((t) => t === 0)).toBe(true);
    expect(nextDraws(f.rng)).toEqual(nextDraws(afterDraws(4, 0)));
  });

  test('an impassable target changes nothing', () => {
    const f = strait(6);
    f.map.terrain[10 * W + 16] = 5;
    const before = Array.from(f.map.terrain);
    makeTribeConnections(f.m, f.stack, f.search, [3, 10], [16, 10]);
    expect(Array.from(f.map.terrain)).toEqual(before);
    expect(nextDraws(f.rng)).toEqual(nextDraws(afterDraws(6, 0)));
  });
});

describe('Shallows::generate (src/rmm_shal.cpp:17)', () => {
  test('each pair of points, then two random pairs of land tiles: 8 draws on an all-land map', () => {
    const f = rmmFixture(W, W, 8);
    generateShallows(f.m, f.stack, f.search, [
      [3, 3],
      [16, 16],
    ]);
    expect(nextDraws(f.rng)).toEqual(nextDraws(afterDraws(8, 8)));
  });

  test('the random land tiles are drawn again while they land on water', () => {
    const f = rmmFixture(W, W, 8, TERRAIN_WATER);
    f.map.terrain[0] = 0;
    // Every pick but (0, 0) is water: the generator keeps drawing until a draw pair gives x = y = 0.
    const rng = afterDraws(8, 0);
    let draws = 0;
    for (let picks = 0; picks < 4; picks++) {
      for (;;) {
        const x = Math.trunc((rng.rand() * (W - 1)) / 0x7fff);
        const y = Math.trunc((rng.rand() * (W - 1)) / 0x7fff);
        draws += 2;
        if (x === 0 && y === 0) break;
      }
    }
    generateShallows(f.m, f.stack, f.search, []);
    expect(nextDraws(f.rng)).toEqual(nextDraws(afterDraws(8, draws)));
  });

  test('a strait between the two land centres is forded', () => {
    const f = strait(21);
    generateShallows(f.m, f.stack, f.search, [
      [3, 10],
      [16, 10],
    ]);
    expect(walkable(f.map.terrain, [3, 10], [16, 10])).toBe(true);
  });
});
