import { f32 } from './num';

/** Simulation object. Float fields hold float32 values (`f32`); ids and integers are 32-bit. */
export interface Entity {
  readonly id: number;
  /** Player index; 0 is Gaia (src/world.cpp:1274). */
  owner: number;
  /** Master object id from empires.dat. */
  type: number;
  x: number;
  y: number;
  z: number;
  hp: number;
}

export type EntityInit = Omit<Entity, 'id'>;

/**
 * All live entities. Ids are handed out in increasing order and never reused, and iteration is
 * always in id order, so every peer visits entities in the same sequence.
 */
export class EntityStore {
  private readonly byId = new Map<number, Entity>();
  private nextId = 1;

  get size(): number {
    return this.byId.size;
  }

  get nextEntityId(): number {
    return this.nextId;
  }

  create(init: EntityInit): Entity {
    const e: Entity = {
      id: this.nextId++,
      owner: init.owner | 0,
      type: init.type | 0,
      x: f32(init.x),
      y: f32(init.y),
      z: f32(init.z),
      hp: f32(init.hp),
    };
    this.byId.set(e.id, e);
    return e;
  }

  get(id: number): Entity | undefined {
    return this.byId.get(id);
  }

  remove(id: number): boolean {
    return this.byId.delete(id);
  }

  /** Entities in id order. Map keeps insertion order and ids only grow, so that is id order. */
  all(): IterableIterator<Entity> {
    return this.byId.values();
  }

  *ofPlayer(owner: number): Generator<Entity> {
    for (const e of this.byId.values()) if (e.owner === owner) yield e;
  }

  toJSON(): { nextId: number; entities: Entity[] } {
    return { nextId: this.nextId, entities: [...this.byId.values()].map((e) => ({ ...e })) };
  }

  static fromJSON(data: { nextId: number; entities: Entity[] }): EntityStore {
    const store = new EntityStore();
    const sorted = [...data.entities].sort((a, b) => a.id - b.id);
    for (const e of sorted) store.byId.set(e.id, { ...e });
    store.nextId = data.nextId;
    return store;
  }
}
