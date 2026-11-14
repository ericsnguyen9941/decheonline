import { expect, test } from 'vitest';
import { mapPixelSize, pixelToTileCoords, tileAtPixel, tileCoordsToPixel, tileOrigin, tileTouches, visibleRange } from './iso';

const W = 48;
const H = 40;

test('tiles tile the plane: neighbours are half a tile apart on both axes', () => {
  const a = tileOrigin(10, 10, W);
  expect(tileOrigin(11, 10, W)).toEqual({ x: a.x + 32, y: a.y - 16 });
  expect(tileOrigin(10, 11, W)).toEqual({ x: a.x + 32, y: a.y + 16 });
});

test('the map bounding box starts at the origin and ends at the far corners', () => {
  expect(tileOrigin(0, 0, W).x).toBe(0);
  expect(tileOrigin(W - 1, 0, W).y).toBe(0);
  const { w, h } = mapPixelSize(W, H);
  expect(tileOrigin(W - 1, H - 1, W).x + 64).toBe(w);
  expect(tileOrigin(0, H - 1, W).y + 32).toBe(h);
});

test('tileAtPixel inverts tileOrigin at tile centres and rejects pixels off the map', () => {
  for (const [col, row] of [[0, 0], [5, 17], [W - 1, H - 1], [W - 1, 0], [0, H - 1]] as const) {
    const o = tileOrigin(col, row, W);
    expect(tileAtPixel(o.x + 32, o.y + 16, W, H)).toEqual({ col, row });
    expect(tileAtPixel(o.x + 33, o.y + 16, W, H)).toEqual({ col, row });
  }
  expect(tileAtPixel(-40, 10, W, H)).toBeNull();
});

test('visibleRange covers exactly the tiles whose frames touch the view', () => {
  const views = [
    { x: 0, y: 0, w: 800, h: 450 },
    { x: 1000, y: 500, w: 800, h: 450 },
    { x: 2500, y: 900, w: 800, h: 450 },
  ];
  for (const view of views) {
    const range = visibleRange(view, W, H);
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const inRange = !!range && col >= range.col0 && col <= range.col1 && row >= range.row0 && row <= range.row1;
        if (tileTouches(view, col, row, W)) expect(inRange).toBe(true);
      }
    }
  }
  expect(visibleRange({ x: 100000, y: 0, w: 800, h: 450 }, W, H)).toBeNull();
});

test('tile coordinates and map pixels convert both ways', () => {
  const p = tileCoordsToPixel(12.25, 30.5, W);
  const t = pixelToTileCoords(p.x, p.y, W);
  expect(t.col).toBeCloseTo(12.25);
  expect(t.row).toBeCloseTo(30.5);
  // The middle of tile (c, r) is the box origin plus half a tile.
  const o = tileOrigin(7, 9, W);
  expect(tileCoordsToPixel(7.5, 9.5, W)).toEqual({ x: o.x + 32, y: o.y + 16 });
});
