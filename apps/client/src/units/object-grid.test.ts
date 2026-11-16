import { expect, test } from 'vitest';
import type { Entity, World } from '@aoe/sim';
import { CHUNK, ObjectGrid } from './object-grid';

function scene() {
  const byId = new Map<number, Entity>();
  let next = 1;
  const world = {
    map: { width: 4 * CHUNK, height: 4 * CHUNK },
    entities: { get: (id: number) => byId.get(id), get nextEntityId() { return next; } },
  } as unknown as World;
  const add = (x: number, y: number, moves: boolean) => {
    const e = { id: next++, x, y, ...(moves ? { mover: {} } : {}) } as unknown as Entity;
    byId.set(e.id, e);
    return e;
  };
  const ids = (grid: ObjectGrid, col0: number, row0: number, col1: number, row1: number) => [...grid.objects({ col0, row0, col1, row1 })].map((e) => e.id).sort((a, b) => a - b);
  return { world, byId, add, ids };
}

test('the walk finds the objects on the chunks of the tiles asked for, not the others', () => {
  const { world, add, ids } = scene();
  const tree = add(1.5, 1.5, false);
  const far = add(3 * CHUNK + 0.5, 3 * CHUNK + 0.5, false);
  const grid = new ObjectGrid(world, (x, y) => ({ x, y }));
  expect(ids(grid, 0, 0, CHUNK - 1, CHUNK - 1)).toEqual([tree.id]);
  expect(ids(grid, 2 * CHUNK, 2 * CHUNK, 4 * CHUNK - 1, 4 * CHUNK - 1)).toEqual([far.id]);
  expect(ids(grid, 0, 0, 4 * CHUNK - 1, 4 * CHUNK - 1)).toEqual([tree.id, far.id]);
});

test('a mover changes chunk after a step, a new object is filed, a removed one leaves', () => {
  const { world, byId, add, ids } = scene();
  const unit = add(1, 1, true);
  const tree = add(2, 2, false);
  const grid = new ObjectGrid(world, (x, y) => ({ x, y }));
  unit.x = 2 * CHUNK + 1;
  const arrow = add(CHUNK + 1, 1, true);
  grid.update();
  expect(ids(grid, 0, 0, CHUNK - 1, CHUNK - 1)).toEqual([tree.id]);
  expect(ids(grid, CHUNK, 0, 3 * CHUNK - 1, CHUNK - 1)).toEqual([unit.id, arrow.id]);
  byId.delete(tree.id);
  byId.delete(arrow.id);
  grid.update();
  expect(ids(grid, 0, 0, 4 * CHUNK - 1, 4 * CHUNK - 1)).toEqual([unit.id]);
});
