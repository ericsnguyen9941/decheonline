/**
 * Per-player master objects (`RGE_Player::master_objects`, techs.md §4.2): each player owns a copy of its civ's unit
 * records, objects read their owner's copy, and tech effects change only that player's copies.
 */
import { civUnitTypes, copyUnitType, type UnitType } from './units';

/** Each player's masters by unit id, `[player][id]`. */
export interface PlayerMasters {
  masters: Record<number, UnitType>[];
}

/** A player's masters at creation: copies of civ `civ`'s records. */
export function newMasters(civ: number): Record<number, UnitType> {
  return Object.fromEntries(Object.values(civUnitTypes(civ)).map((t) => [t.id, copyUnitType(t)]));
}

/** Player `owner`'s master `id`. */
export function master(p: PlayerMasters, owner: number, id: number): UnitType {
  const t = p.masters[owner]?.[id];
  if (!t) throw new Error(`unit type ${id} is not in the sim's table`);
  return t;
}

/** Player `owner` has master `id` (`master_objects[id] != 0`). */
export function hasMaster(p: PlayerMasters, owner: number, id: number): boolean {
  return p.masters[owner]?.[id] !== undefined;
}

/** The master an object reads: its owner's copy of its type. */
export function typeOf(p: PlayerMasters, e: { owner: number; type: number }): UnitType {
  return master(p, e.owner, e.type);
}

/** A deep copy of every player's masters (snapshots). */
export function copyMasters(masters: readonly Record<number, UnitType>[]): Record<number, UnitType>[] {
  return masters.map((m) => Object.fromEntries(Object.values(m).map((t) => [t.id, copyUnitType(t)])));
}
