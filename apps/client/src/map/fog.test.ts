import { expect, test } from 'vitest';
import { EDGE_NUMBER, edgeNumber, FOG_W, fogPixels, PLAIN_EDGES, TILE_BLACK, TILE_FOGGED, TILE_VISIBLE } from './fog';

test('the 256 neighbour masks map to the 47 edges of the tile edge files', () => {
  expect(new Set(EDGE_NUMBER).size).toBe(47);
  expect(Math.max(...EDGE_NUMBER)).toBe(46);
  expect(EDGE_NUMBER[0]).toBe(0);
  // A corner next to a hidden side adds nothing: up (0x80) with up-left (0x01) or up-right (0x08) is up alone.
  expect(EDGE_NUMBER[0x81]).toBe(EDGE_NUMBER[0x80]);
  expect(EDGE_NUMBER[0x88]).toBe(EDGE_NUMBER[0x80]);
  expect(EDGE_NUMBER[0x01]).not.toBe(EDGE_NUMBER[0x80]);
});

test('the edge number reads the 8 neighbours; off the map counts as seen', () => {
  const hidden = new Set(['5,4']);
  const seen = (c: number, r: number) => !hidden.has(`${c},${r}`);
  expect(edgeNumber(seen, 5, 5, 10, 10)).toBe(EDGE_NUMBER[0x80]);
  expect(edgeNumber(seen, 4, 5, 10, 10)).toBe(EDGE_NUMBER[0x08]);
  expect(edgeNumber(seen, 0, 0, 10, 10)).toBe(0);
});

test('a fogged tile is a checkerboard of black dots inside the diamond; a visible tile with seen neighbours has no fog', () => {
  expect(fogPixels(PLAIN_EDGES, TILE_VISIBLE, 0, 0, 0)).toBeNull();
  const even = fogPixels(PLAIN_EDGES, TILE_FOGGED, 0, 0, 0)!;
  const odd = fogPixels(PLAIN_EDGES, TILE_FOGGED, 0, 0, 1)!;
  // Row 16 spans the whole width: dots on odd x + y, the other parity on the others.
  expect([...even.slice(16 * FOG_W, 16 * FOG_W + 4)]).toEqual([0, 255, 0, 255]);
  expect([...odd.slice(16 * FOG_W, 16 * FOG_W + 4)]).toEqual([255, 0, 255, 0]);
  // Outside the diamond (top-left corner) nothing is drawn.
  expect(even[0]).toBe(0);
});

test('black edge spans are left black over the fog and the plain part', () => {
  const edges = { ...PLAIN_EDGES, black: PLAIN_EDGES.black.map((s, i) => (i === 1 ? [[16, 0, 3] as [number, number, number]] : s)) };
  const visible = fogPixels(edges, TILE_VISIBLE, 0, 1, 0)!;
  expect([...visible.slice(16 * FOG_W, 16 * FOG_W + 6)]).toEqual([255, 255, 255, 255, 0, 0]);
  const fogged = fogPixels(edges, TILE_FOGGED, 0, 1, 0)!;
  expect([...fogged.slice(16 * FOG_W, 16 * FOG_W + 6)]).toEqual([255, 255, 255, 255, 0, 255]);
});

test('an unexplored tile is black over its whole diamond, so the low objects under the overlay do not show there', () => {
  const black = fogPixels(PLAIN_EDGES, TILE_BLACK, 0, 0, 0)!;
  expect([...black.slice(16 * FOG_W, 16 * FOG_W + 4)]).toEqual([255, 255, 255, 255]);
  expect(black[32]).toBe(255);
  // Outside the diamond (top-left corner) the neighbours' terrain is left alone.
  expect(black[0]).toBe(0);
});
