import type { QueueRecord, TrainAction } from './buildings';
import type { AttackAction, MissileAction } from './combat';
import type { WorkAction } from './gather';
import { copyMover, type Mover } from './movement';
import { f32 } from './num';
import type { MakeAction } from './make';
import type { ResearchAction } from './research';
import type { ActiveSprite } from './sprites';
import type { UnitAI } from './unit-ai';
import type { WonderAction } from './wonder';

/** `object_state` values (include/stat_obj.h). */
export const ObjectState = {
  Unbuilt: 0,
  Active: 2,
  Dying: 3,
  DeathAnimation: 4,
  Dead: 5,
  PendingRemoval: 7,
  ReadyToRemove: 8,
} as const;

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
  /** `object_state` (`ObjectState`); objects start active. */
  state: number;
  /** Carried or held resource: `attribute_type_held` (-1 none) and `attribute_amount_held` (float). */
  heldType: number;
  heldAmount: number;
  /** Footprint is in the obstruction map. */
  stamped: boolean;
  /** Main sprite and its animation state; null before setup shows one. */
  sprite: ActiveSprite | null;
  /** Movement state of a moving unit; absent for other objects. */
  mover?: Mover;
  /** Combat objects: reload timer (`attack_timer`). */
  attackTimer?: number;
  /** World time (s) of the last `turn_towards` facet turn. */
  turnTowardsTime?: number;
  /** Gather or hunt action at the top of the action list. */
  work?: WorkAction | null;
  /** Attack action: the unit's own, or a hunt's sub-action when `work` is set. */
  attack?: AttackAction | null;
  /** A missile's flight action. */
  missile?: MissileAction | null;
  /** Buildings: `build_pts`, float. */
  buildPoints?: number;
  /** Buildings: `facet`, the construction frame while unbuilt, then `building_facet`. */
  facet?: number;
  /** Buildings: the production queue (`production_queue`), one record per unit type, first trains first. */
  queue?: QueueRecord[];
  /** Buildings: the queue's train action (`production_queue_actions`), null when none. */
  train?: TrainAction | null;
  /** Buildings: a research, the building's only action while it lasts (`TRIBE_Action_Make_Tech`). */
  research?: ResearchAction | null;
  /** A Farm's food production (`RGE_Action_Make`), its default task while it is active. */
  make?: MakeAction | null;
  /** The Wonder's countdown (`TRIBE_Action_Wonder`, `wonder.ts`), from its creation. */
  wonder?: WonderAction | null;
  /** Combat objects: the unified visibility cell of its tile at its last update (`Unified_Map_Value`, visibility.md §4.1). */
  sighted?: number;
  /** Combat objects: the unit AI (`unitAIValue`), absent for groups without one. */
  ai?: UnitAI | null;
}

export type EntityInit = Pick<Entity, 'owner' | 'type' | 'x' | 'y' | 'z' | 'hp'> & Partial<Omit<Entity, 'id'>>;

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
      state: init.state ?? ObjectState.Active,
      heldType: init.heldType ?? -1,
      heldAmount: f32(init.heldAmount ?? 0),
      stamped: init.stamped ?? false,
      sprite: init.sprite ? { ...init.sprite } : null,
    };
    if (init.mover) e.mover = copyMover(init.mover);
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
    return { nextId: this.nextId, entities: [...this.byId.values()].map(copyEntity) };
  }

  static fromJSON(data: { nextId: number; entities: Entity[] }): EntityStore {
    const store = new EntityStore();
    const sorted = [...data.entities].sort((a, b) => a.id - b.id);
    for (const e of sorted) store.byId.set(e.id, copyEntity(e));
    store.nextId = data.nextId;
    return store;
  }
}

function copyEntity(e: Entity): Entity {
  const copy = { ...e, sprite: e.sprite && { ...e.sprite } };
  if (e.mover) copy.mover = copyMover(e.mover);
  if (e.work) copy.work = { ...e.work };
  if (e.attack) copy.attack = { ...e.attack };
  if (e.missile) copy.missile = { ...e.missile };
  if (e.queue) copy.queue = e.queue.map((r) => ({ ...r }));
  if (e.train) copy.train = { ...e.train };
  if (e.research) copy.research = { ...e.research };
  if (e.make) copy.make = { ...e.make };
  if (e.wonder) copy.wonder = { ...e.wonder };
  if (e.ai) {
    copy.ai = {
      ...e.ai,
      attackers: [...e.ai.attackers],
      notes: e.ai.notes.map((n) => ({ ...n })),
      orders: e.ai.orders.map((o) => ({ ...o })),
    };
  }
  return copy;
}
