import type { Entity } from './entities';
import type { MoveContext } from './movement';

/** What object updates and actions need from the world during a step. */
export interface GameContext extends MoveContext {
  /** Player attributes (resources and counters), float32, indexed `[player][attribute]`. */
  attributes: number[][];
  /** `world_time` in ms. */
  worldTime: number;
  /** `make_new_obj`: create and set up an object (its setup draws from the RNG). */
  create(owner: number, type: number, x: number, y: number, z: number): Entity;
  /** `set_sleep_flag(0)`: a sleeping object joins its owner's updated list, at the front. */
  wake(e: Entity): void;
  /** The owner's updated objects in list order (newest or most recently woken first). */
  objectsOf(owner: number): Entity[];
}
