import { expect, test } from 'vitest';
import { ObjectState, TILE_BLACK, TILE_FOGGED, TILE_VISIBLE, type Entity, type World } from '@aoe/sim';
import { Doppelgangers, fogDraw } from './fog-objects';

test('fog_flag picks what a fogged tile shows; a visible tile shows all, an unexplored one only low layers', () => {
  const { Active, Dying } = ObjectState;
  expect(fogDraw(0, Active, TILE_VISIBLE, 20, false)).toBe('plain');
  expect(fogDraw(0, Active, TILE_FOGGED, 20, false)).toBe('hidden');
  expect(fogDraw(1, Active, TILE_FOGGED, 20, false)).toBe('fogged');
  expect(fogDraw(2, Active, TILE_FOGGED, 20, false)).toBe('fogged');
  expect(fogDraw(2, Dying, TILE_FOGGED, 20, false)).toBe('hidden');
  expect(fogDraw(4, Active, TILE_FOGGED, 20, true)).toBe('hidden');
  expect(fogDraw(4, Active, TILE_FOGGED, 20, false)).toBe('fogged');
  expect(fogDraw(1, Active, TILE_BLACK, 20, false)).toBe('hidden');
  expect(fogDraw(0, Active, TILE_BLACK, 5, false)).toBe('fogged');
});

const TREE = 134;
const MINE = 66;

function scene() {
  const entities = new Map<number, Entity>();
  const tiles = new Map<string, number>();
  const world = {
    entities: { all: () => entities.values() },
    tileVisibility: (_p: number, c: number, r: number) => tiles.get(`${c},${r}`) ?? TILE_VISIBLE,
  } as unknown as World;
  const add = (id: number, type: number, x: number) =>
    entities.set(id, { id, type, owner: 0, x, y: 2.5, z: 0, state: ObjectState.Active, sprite: { graphic: type, frame: 0 } } as unknown as Entity);
  const dopples = new Doppelgangers(1, (type) => (type === TREE ? 2 : type === MINE ? 1 : 0));
  return { entities, tiles, world, add, dopples };
}

test('a tree cut down out of sight stays as it was; seeing its tile again forgets it', () => {
  const { entities, tiles, world, add, dopples } = scene();
  add(1, TREE, 3.5);
  dopples.update(world);
  tiles.set('3,2', TILE_FOGGED);
  dopples.update(world);
  expect(dopples.copies.size).toBe(0);
  entities.get(1)!.state = ObjectState.Dying;
  entities.get(1)!.sprite!.graphic = 999;
  dopples.update(world);
  expect(dopples.copies.get(1)).toMatchObject({ type: TREE, graphic: 999, x: 3.5 });
  expect(dopples.onTile(3, 2)).toBe(true);
  tiles.set('3,2', TILE_VISIBLE);
  dopples.update(world);
  expect(dopples.copies.size).toBe(0);
});

test('a dying tree whose tile goes out of sight is remembered; a mine is remembered when it is removed unseen', () => {
  const { entities, tiles, world, add, dopples } = scene();
  add(1, TREE, 3.5);
  add(2, MINE, 6.5);
  dopples.update(world);
  entities.get(1)!.state = ObjectState.Dying;
  dopples.update(world);
  expect(dopples.copies.size).toBe(0);
  tiles.set('3,2', TILE_FOGGED);
  dopples.update(world);
  expect(dopples.copies.has(1)).toBe(true);
  tiles.set('6,2', TILE_FOGGED);
  dopples.update(world);
  entities.delete(2);
  dopples.update(world);
  expect(dopples.copies.get(2)).toMatchObject({ type: MINE, x: 6.5 });
  // A tile the player never explored keeps nothing.
  add(3, MINE, 9.5);
  tiles.set('9,2', TILE_BLACK);
  dopples.update(world);
  entities.delete(3);
  dopples.update(world);
  expect(dopples.copies.has(3)).toBe(false);
});
