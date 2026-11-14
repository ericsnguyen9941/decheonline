import { expect, test } from 'vitest';
import { minimapGeometry, objectPoint, pickTile, plainMinimapShape, tileRect, viewRect } from './minimap-geometry';

const shape = plainMinimapShape();

test('a small map gives every diagonal its own lines and every tile its pixels, whose middle picks it back', () => {
  const g = minimapGeometry(shape, 40, 40);
  expect(g.tileDrawHeight).toBe(2);
  for (let row = 0; row < 40; row += 3) {
    for (let col = 0; col < 40; col += 3) {
      const r = tileRect(g, col, row)!;
      expect(r).not.toBeNull();
      expect(pickTile(g, r.x + Math.floor(r.w / 2), r.y)).toEqual({ col, row });
    }
  }
});

test('the top corner is the last column of row 0, the bottom the first column of the last row (as the main view)', () => {
  const g = minimapGeometry(shape, 40, 40);
  // Lines 0 and 1 both map to diagonal 0; the later one wins (set_world).
  expect(objectPoint(g, 39, 0).y).toBe(shape.startY + 1);
  expect(objectPoint(g, 38, 0).y).toBeGreaterThan(objectPoint(g, 39, 0).y);
  expect(objectPoint(g, 0, 39).y).toBeGreaterThan(objectPoint(g, 20, 20).y);
  expect(objectPoint(g, 0, 0).x).toBeLessThan(objectPoint(g, 39, 39).x);
});

test('a map with more diagonals than lines leaves some rows undrawn, as set_world does', () => {
  const g = minimapGeometry(shape, 120, 120);
  expect(g.tileDrawHeight).toBe(1);
  const undrawn = g.rows.filter((r) => !r.draw).length;
  expect(undrawn).toBe(g.rows.length - new Set(g.lineRows).size);
  expect(pickTile(g, 0, 0)).toBeNull();
});

test('the view frame is centred on its tile and grows with the view', () => {
  const g = minimapGeometry(shape, 40, 40);
  const p = objectPoint(g, 20, 20);
  const r = viewRect(g, 20, 20, 16, 20)!;
  expect(r.left).toBeLessThan(p.x);
  expect(r.right).toBeGreaterThan(p.x);
  expect(r.top).toBeLessThan(p.y);
  expect(r.bottom).toBeGreaterThan(p.y);
  expect(viewRect(g, 40, 20, 16, 20)).toBeNull();
});
