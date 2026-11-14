/**
 * The shape of one generated unit record (`unit-data.ts`, written by tools/gen-sim-tables.mjs from empires.dat).
 * `units.ts` turns records into `UnitType`s.
 */
/** A sprite as the sim reads it: `[graphic, frames, facets, baseSpeed, duration, pause, flags]`. */
export type SimSprite = [number, number, number, number, number, number, number];
/** `[type, amount, flag]`. */
export type SimStorage = [number, number, number];

/** One unit type in the generated table: the fields of the sim's `UnitType`, sprites as `SimSprite` tuples. */
export interface SimUnitRecord {
  id: number;
  name: string;
  masterType: number;
  group: number;
  hitPoints: number;
  /** `line_of_sight`, tiles. */
  los: number;
  speed: number;
  radius: [number, number, number];
  clearance: [number, number];
  turnSpeed: number;
  flying: boolean;
  terrainRestriction: number;
  combatLevel: number;
  canBeBuiltOn: number;
  elevationMode: number;
  placementTerrain: [number, number];
  placementSideTerrain: [number, number];
  enabled: boolean;
  standing: SimSprite;
  walking: SimSprite | null;
  dying: SimSprite | null;
  deadUnitId: number;
  storages: SimStorage[];
  resourceCapacity: number;
  resourceDecay: number;
  action: {
    workRate: number;
    dropSites: [number, number];
    taskSwapGroup: number;
    tasks: (number | SimSprite | null)[][];
  } | null;
  combat: {
    attacks: [number, number][];
    armours: [number, number][];
    baseArmour: number;
    reloadTime: number;
    range: number;
    minRange: number;
    projectileUnitId: number;
    frameDelay: number;
    accuracy: number;
    blastWidth: number;
    attackSprite: SimSprite | null;
    displacement: [number, number, number];
  } | null;
  missile: { type: number; targetting: number; hitInfo: number; ballistics: number } | null;
  creatable: { costs: SimStorage[]; trainTime: number; trainLocationId: number } | null;
  building: {
    construction: SimSprite | null;
    facet: number;
    disappearsWhenBuilt: boolean;
    makeObject: number;
    makeTile: number;
    techId: number;
  } | null;
}

/** One civ in the generated table (`CIV_RECORDS`). */
export interface SimCivRecord {
  name: string;
  /** `tribe_effect`: the civ's tech-tree effect run at game start, -1 none. */
  effect: number;
  /** Starting player attributes, float32. */
  resources: number[];
  /** By unit id: the civ's record fields that differ from `UNIT_RECORDS`. */
  diffs: Record<number, Partial<SimUnitRecord>>;
}
