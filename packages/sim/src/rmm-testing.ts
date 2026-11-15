/**
 * Test fixture for the random map modules: a map, the shared stack and search map, and an `RmmWorld` that keeps its
 * objects in a list. Creating an object draws once and reseeds with the draw, as `RGE_Static_Object` setup does
 * (src/stat_obj.cpp:169-179).
 */
import type { Entity } from './entities';
import { ObjectState } from './entities';
import { TileMap } from './map';
import { CrtRand } from './rng';
import { MapStack } from './rmm-base';
import { RmmMap, type RmmWorld } from './rmm-map';
import { UNIT_TYPES, unitType, type UnitType } from './units';

export class ListWorld implements RmmWorld {
  readonly objects: Entity[] = [];
  private nextId = 1;

  constructor(private readonly rng: CrtRand) {}

  master(_owner: number, type: number): UnitType | null {
    return UNIT_TYPES.get(type) ?? null;
  }

  create(owner: number, type: number, x: number, y: number): Entity {
    this.rng.srand(this.rng.rand());
    const e = { id: this.nextId++, owner, type, x, y, z: 0, state: ObjectState.Active } as unknown as Entity;
    this.objects.push(e);
    return e;
  }

  destroy(e: Entity): void {
    e.state = ObjectState.PendingRemoval;
  }

  remove(e: Entity): void {
    const i = this.objects.indexOf(e);
    if (i !== -1) this.objects.splice(i, 1);
  }

  complete(): void {}

  typeOf(e: Entity): UnitType {
    return unitType(e.type);
  }
}

export interface RmmFixture {
  rng: CrtRand;
  map: TileMap;
  world: ListWorld;
  m: RmmMap;
  stack: MapStack;
  search: Uint8Array;
}

/** A `width` x `height` map of `terrain` at height 0, the RNG seeded with `seed`. */
export function rmmFixture(width: number, height: number, seed: number, terrain = 0): RmmFixture {
  const rng = new CrtRand();
  rng.srand(seed);
  const map = new TileMap(width, height);
  map.terrain.fill(terrain);
  const world = new ListWorld(rng);
  return { rng, map, world, m: new RmmMap(map, rng, world), stack: new MapStack(width, height), search: new Uint8Array(width * height) };
}

/** A `CrtRand` that returns the given values in order (then 0). */
export function scriptedRand(values: readonly number[]): CrtRand & { used: number } {
  const r = new CrtRand() as CrtRand & { used: number };
  r.used = 0;
  r.rand = () => values[r.used++] ?? 0;
  return r;
}

/** A `CrtRand` seeded with `seed` and advanced `n` draws: compare its next draws to see how many a call used. */
export function afterDraws(seed: number, n: number): CrtRand {
  const r = new CrtRand();
  r.srand(seed);
  for (let i = 0; i < n; i++) r.rand();
  return r;
}

/** The next `n` draws of `rng` (advances it). */
export function nextDraws(rng: CrtRand, n = 4): number[] {
  return Array.from({ length: n }, () => rng.rand());
}
