import type { Entity } from './entities';
import type { MoveContext } from './movement';
import type { TechContext } from './techs';

/** What object updates and actions need from the world during a step. */
export interface GameContext extends MoveContext, TechContext {
  /** `world_time` in ms. */
  worldTime: number;
  /** `make_new_obj`: create and set up an object (its setup draws from the RNG). */
  create(owner: number, type: number, x: number, y: number, z: number): Entity;
  /** `set_sleep_flag(0)`: a sleeping object joins its owner's updated list, at the front. */
  wake(e: Entity): void;
  /** The owner's updated objects in list order (newest or most recently woken first). */
  objectsOf(owner: number): Entity[];
  /** `change_ownership`: the object becomes `owner`'s (artifacts only in the sim). */
  changeOwnership(e: Entity, owner: number): void;
  /** The player whose turn it is (`is_player_turn`): only its units run their unit AI this step. */
  playerTurn: number;
  /** Per player, ms accumulated since its last turn (`get_accum_time_delta`). */
  playerTimeDelta: readonly number[];
  /** Per player, seconds left before another under-attack alert (`TRIBE_Player::update_count`). */
  alertCooldown: number[];
  /** Per player, `GAME_NOTIFY_OBJECT_DEPLETED` notifications so far (a farm used up); the client plays farmdie.wav. */
  depleted: number[];
}
