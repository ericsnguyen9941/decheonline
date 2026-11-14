import { parseDat } from './dat';
import type { Civ, DatFile, Effect, Graphic, RandomMap, Sound, Tech, Terrain, TerrainRestriction, Unit } from './types';

function at<T>(list: readonly T[], id: number, what: string): T {
  const v = Number.isInteger(id) ? list[id] : undefined;
  if (v === undefined) throw new Error(`${what} ${id} does not exist`);
  return v;
}

/** Read-only lookups over a parsed DatFile, by the ids other records use. */
export class RuleSet {
  constructor(readonly dat: DatFile) {}

  /** Parses empires.dat as stored on disk. */
  static fromFile(file: Uint8Array): RuleSet {
    return new RuleSet(parseDat(file));
  }

  /** Civilizations a player can pick: every civ after Gaia (index 0). */
  get playableCivs(): Civ[] {
    return this.dat.civs.slice(1);
  }

  civ(id: number): Civ {
    return at(this.dat.civs, id, 'civ');
  }

  /** A civ's version of a unit; throws when the civ has no unit with that id. */
  unit(civId: number, unitId: number): Unit {
    const u = at(this.civ(civId).units, unitId, 'unit');
    if (u === null) throw new Error(`unit ${unitId} does not exist for civ ${civId}`);
    return u;
  }

  /** Like unit(), but null for an empty slot or an id past the table. */
  findUnit(civId: number, unitId: number): Unit | null {
    return this.civ(civId).units[unitId] ?? null;
  }

  tech(id: number): Tech {
    return at(this.dat.techs, id, 'tech');
  }

  effect(id: number): Effect {
    return at(this.dat.effects, id, 'effect');
  }

  graphic(id: number): Graphic {
    const g = at(this.dat.graphics, id, 'graphic');
    if (g === null) throw new Error(`graphic ${id} does not exist`);
    return g;
  }

  sound(id: number): Sound {
    return at(this.dat.sounds, id, 'sound');
  }

  /** Terrains in use; the block has more slots than terrainsUsed. */
  terrain(id: number): Terrain {
    return at(this.dat.terrainBlock.terrains.slice(0, this.dat.terrainsUsed), id, 'terrain');
  }

  terrainRestriction(id: number): TerrainRestriction {
    return at(this.dat.terrainRestrictions, id, 'terrain restriction');
  }

  /** Random map parameters by map id (the id stored in the record, not the index). */
  randomMap(id: number): RandomMap {
    const m = this.dat.randomMaps.maps.find((map) => map.id === id);
    if (!m) throw new Error(`random map ${id} does not exist`);
    return m;
  }
}
