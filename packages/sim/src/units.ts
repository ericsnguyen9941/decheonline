import { f32 } from './num';

/** A dat sprite (graphic) as movement reads it: `facet_num`, `base_speed` and `flags & 2` (docs/spec/movement.md §2). */
export interface SpriteInfo {
  /** Dat graphic id. */
  graphic: number;
  /** Facets (angles) of the sprite: the graphic's angle count. */
  facets: number;
  /** Speed multiplier (`base_speed`); 0 means "use the unit's speed as is". */
  baseSpeed: number;
  /** The sprite has facings (`flags & 2`). */
  hasFacings: boolean;
}

/**
 * The master-object fields the sim reads for a moving unit (docs/spec/movement.md §2). Values are copied from the
 * original `empires.dat` (civ 1 table; the Villager record is the same for every civ) and checked against it by
 * packages/data `units.golden.test.ts`. Float fields hold float32 values.
 */
export interface UnitType {
  id: number;
  name: string;
  hitPoints: number;
  /** Tiles per second. */
  speed: number;
  radiusX: number;
  radiusY: number;
  /** <= 0: never collides, straight-line path. */
  radiusZ: number;
  /** Seconds per facet; 0 turns instantly. */
  turnSpeed: number;
  /** Terrain restriction table index. */
  terrainRestriction: number;
  /** The restriction row: per terrain id, > 0 passable (and the speed multiplier). */
  terrainTable: readonly number[];
  standing: SpriteInfo;
  /** `move_sprite`; null means the standing sprite is used for walking too. */
  walking: SpriteInfo | null;
}

export const VILLAGER = 83;

/** Terrain restriction 7 ("land units"), first 23 terrains of the real dat. */
const LAND_TERRAINS = [1, 0, 1, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0].map(f32);

export const UNIT_TYPES: ReadonlyMap<number, UnitType> = new Map([
  [
    VILLAGER,
    {
      id: VILLAGER,
      name: 'Man',
      hitPoints: 25,
      speed: f32(1.1),
      radiusX: f32(0.2),
      radiusY: f32(0.2),
      radiusZ: f32(1.7),
      turnSpeed: 0,
      terrainRestriction: 7,
      terrainTable: LAND_TERRAINS,
      standing: { graphic: 285, facets: 8, baseSpeed: 0, hasFacings: true },
      walking: { graphic: 665, facets: 8, baseSpeed: 1, hasFacings: true },
    },
  ],
]);

export function unitType(id: number): UnitType {
  const t = UNIT_TYPES.get(id);
  if (!t) throw new Error(`unit type ${id} is not in the sim's table`);
  return t;
}
