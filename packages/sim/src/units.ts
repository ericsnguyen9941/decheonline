import { f32 } from './num';

/**
 * A dat sprite (graphic) as the sim reads it (docs/spec/sprites.md §1): frame count and timing for the animation
 * state the sim keeps (sprites.md §3), facets and base speed for movement (movement.md §2), and the flag bits.
 */
export interface SpriteInfo {
  /** Dat graphic id. */
  graphic: number;
  /** `frame_num`: frames per facet. */
  frames: number;
  /** Facets (angles) of the sprite: the graphic's angle count. */
  facets: number;
  /** Speed multiplier (`base_speed`); 0 means "use the unit's speed as is". */
  baseSpeed: number;
  /** Seconds per frame. */
  duration: number;
  /** `pause_between_loops`: seconds held on the last frame before looping. */
  pause: number;
  /** `flags` (the graphic's sequence type): 1 animated, 2 has facings, 4 random start frame, 8 play once. */
  flags: number;
  /** The sprite has facings (`flags & 2`). */
  hasFacings: boolean;
  /** Animated with a random start frame (`flags & 1` and `& 4`): each new active sprite of it draws one `rand()`. */
  randomStart: boolean;
}

/** One carried or owner-given amount (`attribute_type_held` / storage slots, economy.md §2.1). */
export interface Storage {
  type: number;
  amount: number;
  /** 0 the object's own starting load, 1/2 given to the owner on creation (2: taken back on removal), 4 when built. */
  flag: number;
}

/** `RGE_Task` (economy.md §2.1); sprites resolved from their graphic ids. */
export interface Task {
  actionType: number;
  /** `object_group`: target class, -1 none. */
  group: number;
  /** `object_id`: target master id, -1 none. */
  unitId: number;
  terrainId: number;
  /** `attribute_type`: type carried while doing the task. */
  resourceIn: number;
  /** `attribute_type2`: owner attribute that multiplies the take, -1 none. */
  resourceMultiplier: number;
  /** `attribute_type3`: owner attribute credited on drop-off, -1 the carried type. */
  resourceOut: number;
  workValue1: number;
  workRange: number;
  /** `combat_level` (the reader's `enableTargeting`). */
  combatLevel: number;
  /** `owner_type` (the reader's `targetDiplomacy`). */
  diplomacy: number;
  /** `holding_attr` (the reader's `carryCheck`): the target must hold something. */
  carryCheck: number;
  /** `state_building` (the reader's `pickForConstruction`). */
  building: number;
  moving: SpriteInfo | null;
  /** `work_sprite`. */
  proceeding: SpriteInfo | null;
  /** `work_sprite2`. */
  working: SpriteInfo | null;
  carrying: SpriteInfo | null;
}

export interface ActionInfo {
  workRate: number;
  /** `drop_site`, `backup_drop_site`. */
  dropSites: readonly [number, number];
  /** `task_by_group`; 0 none. */
  taskSwapGroup: number;
  tasks: readonly Task[];
}

export interface WeaponEntry {
  group: number;
  amount: number;
}

export interface CombatInfo {
  attacks: readonly WeaponEntry[];
  armours: readonly WeaponEntry[];
  baseArmour: number;
  /** `speed_of_attack`. */
  reloadTime: number;
  /** `weapon_range`. */
  range: number;
  minRange: number;
  /** `missile_id`, -1 melee. */
  projectileUnitId: number;
  /** `fire_missile_at_frame`. */
  frameDelay: number;
  /** `base_hit_chance`. */
  accuracy: number;
  /** `area_effect_range`. */
  blastWidth: number;
  /** `fight_sprite`. */
  attackSprite: SpriteInfo | null;
  /** Missile spawn offset (x, y, z). */
  displacement: readonly [number, number, number];
}

export interface MissileInfo {
  /** `missile_type`. */
  type: number;
  /** `targetting_type`: 1 leads a moving target. */
  targetting: number;
  /** `missile_hit_info`. */
  hitInfo: number;
  /** `ballistics_ratio`. */
  ballistics: number;
}

/**
 * The master-object fields the sim reads (docs/spec/movement.md §2, economy.md §2, combat.md §1). Values are copied
 * from the original `empires.dat` (civ 1 table for the villager types, Gaia's for the rest; the records are the same
 * for every civ) and checked against it by packages/data `units.golden.test.ts`. Float fields hold float32 values.
 */
export interface UnitType {
  id: number;
  name: string;
  /** Dat object type: 10 static, 30 moving, 60 missile, 70 combat unit, 80 building, 90 tree. */
  masterType: number;
  /** Dat class (`object_group`). */
  group: number;
  hitPoints: number;
  /** Tiles per second. */
  speed: number;
  radiusX: number;
  radiusY: number;
  /** <= 0: never collides, straight-line path. */
  radiusZ: number;
  /** Seconds per facet; 0 turns instantly. */
  turnSpeed: number;
  /** `movement_type` 1: z only rises to the ground (missiles). */
  flying: boolean;
  /** Terrain restriction table index. */
  terrainRestriction: number;
  /** The restriction row: per terrain id, > 0 passable (and the speed multiplier). */
  terrainTable: readonly number[];
  combatLevel: number;
  standing: SpriteInfo;
  /** `move_sprite`; null means the standing sprite is used for walking too. */
  walking: SpriteInfo | null;
  /** `death_sprite`. */
  dying: SpriteInfo | null;
  /** Object spawned when this one is removed (`spawn_death_obj`), -1 none. */
  deadUnitId: number;
  /** Storage slots with a type. */
  storages: readonly Storage[];
  /** `attribute_max_amount`: carry limit, and the clamp on a resource object. */
  resourceCapacity: number;
  /** `attribute_rot`: held amount lost per second while dying or dead. */
  resourceDecay: number;
  action: ActionInfo | null;
  combat: CombatInfo | null;
  missile: MissileInfo | null;
}

export const VILLAGER = 83;
export const LUMBERJACK = 123;
export const HUNTER = 122;
export const FORAGER = 120;
export const MINER_STONE = 124;
export const MINER_GOLD = 251;
export const TOWN_CENTER = 109;
export const GAZELLE = 65;
export const ELEPHANT = 48;
export const MINE_GOLD = 66;
export const MINE_STONE = 102;
export const FORAGE = 59;
/** Tree01 and Tree08 hold 75 wood (cap 75); Tree10 holds 40 (cap 75). */
export const TREES = [134, 141, 143] as const;

/** Terrain restriction rows used by the types below, first 23 terrains of the real dat. */
const TERRAINS: Record<number, readonly number[]> = {
  0: [1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1],
  1: [1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0],
  4: [0.2, 0, 0, 0, 0, 0.2, 0.2, 0, 0, 0, 0.2, 0.2, 0, 0.2, 0, 0, 0, 0, 0.2, 0.2, 0.2, 0.2, 0],
  7: [1, 0, 1, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0],
  8: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

function terrains(row: number): readonly number[] {
  return TERRAINS[row]!.map(f32);
}

function S(graphic: number, frames: number, facets: number, baseSpeed: number, duration: number, pause: number, flags: number): SpriteInfo {
  return { graphic, frames, facets, baseSpeed, duration, pause, flags, hasFacings: (flags & 2) !== 0, randomStart: (flags & 5) === 5 };
}

function T(
  actionType: number,
  group: number,
  unitId: number,
  terrainId: number,
  resourceIn: number,
  resourceMultiplier: number,
  resourceOut: number,
  workValue1: number,
  workRange: number,
  combatLevel: number,
  diplomacy: number,
  carryCheck: number,
  building: number,
  moving: SpriteInfo | null,
  proceeding: SpriteInfo | null,
  working: SpriteInfo | null,
  carrying: SpriteInfo | null,
): Task {
  return {
    actionType,
    group,
    unitId,
    terrainId,
    resourceIn,
    resourceMultiplier,
    resourceOut,
    workValue1,
    workRange,
    combatLevel,
    diplomacy,
    carryCheck,
    building,
    moving,
    proceeding,
    working,
    carrying,
  };
}

const TYPES: UnitType[] = [
  {
    id: 83, name: "Man", masterType: 70, group: 4, hitPoints: 25,
    speed: f32(1.10000002), radiusX: f32(0.200000003), radiusY: f32(0.200000003), radiusZ: f32(1.70000005), turnSpeed: 0,
    flying: false, terrainRestriction: 7, terrainTable: terrains(7), combatLevel: 3,
    standing: S(285, 6, 8, 0, 1, 3, 7), walking: S(665, 15, 8, 1, f32(0.0700000003), 0, 3), dying: S(196, 10, 8, 0, f32(0.100000001), 0, 11), deadUnitId: 43,
    storages: [{ type: 4, amount: -1, flag: 2 }, { type: 11, amount: 1, flag: 2 }, { type: 19, amount: 1, flag: 1 }], resourceCapacity: 0, resourceDecay: 5,
    action: {
      workRate: 1, dropSites: [109, -1], taskSwapGroup: 1,
      tasks: [
        T(7, -1, -1, -1, -1, -1, -1, 0, 0, 1, 2, 0, 0, null, null, null, null),
        T(3, 20, -1, -1, -1, -1, -1, 0, 1, 0, 4, 0, 0, null, null, null, null),
        T(109, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, null, null, null, null),
      ],
    },
    combat: {
      attacks: [{ group: 4, amount: 3 }, { group: 10, amount: -150 }], armours: [{ group: 12, amount: 0 }], baseArmour: 0,
      reloadTime: f32(1.5), range: 0, minRange: 0, projectileUnitId: -1, frameDelay: 0, accuracy: 100,
      blastWidth: 0, attackSprite: S(465, 15, 8, 0, f32(0.0700000003), 0, 3), displacement: [0, 0, f32(0.5)],
    },
    missile: null,
  },
  {
    id: 118, name: "Builder", masterType: 70, group: 4, hitPoints: 25,
    speed: f32(1.10000002), radiusX: f32(0.200000003), radiusY: f32(0.200000003), radiusZ: f32(1.70000005), turnSpeed: 0,
    flying: false, terrainRestriction: 7, terrainTable: terrains(7), combatLevel: 3,
    standing: S(286, 6, 8, 0, 1, 3, 7), walking: S(666, 15, 8, 1, f32(0.0700000003), 0, 3), dying: S(177, 10, 8, 0, f32(0.100000001), 0, 11), deadUnitId: 256,
    storages: [{ type: 4, amount: -1, flag: 2 }, { type: 11, amount: 1, flag: 2 }, { type: 19, amount: 1, flag: 1 }], resourceCapacity: 10, resourceDecay: 10,
    action: {
      workRate: 1, dropSites: [109, -1], taskSwapGroup: 1,
      tasks: [
        T(101, -1, -1, -1, -1, -1, -1, 1, 0, 0, 4, 0, 1, null, S(466, 16, 8, 0, f32(0.0350000001), f32(0.200000003), 3), null, null),
        T(3, 20, -1, -1, -1, -1, -1, 0, 1, 0, 4, 0, 0, null, null, null, null),
        T(109, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, null, null, null, null),
      ],
    },
    combat: {
      attacks: [], armours: [{ group: 12, amount: 0 }], baseArmour: 0,
      reloadTime: 1, range: 0, minRange: 0, projectileUnitId: -1, frameDelay: 0, accuracy: 0,
      blastWidth: 0, attackSprite: null, displacement: [0, 0, f32(0.5)],
    },
    missile: null,
  },
  {
    id: 119, name: "Fisherman", masterType: 70, group: 4, hitPoints: 25,
    speed: f32(1.10000002), radiusX: f32(0.200000003), radiusY: f32(0.200000003), radiusZ: f32(1.89999998), turnSpeed: 0,
    flying: false, terrainRestriction: 7, terrainTable: terrains(7), combatLevel: 3,
    standing: S(299, 6, 8, 0, 1, 3, 7), walking: S(680, 15, 8, 1, f32(0.0799999982), 0, 3), dying: S(185, 10, 8, 0, f32(0.100000001), 0, 11), deadUnitId: 253,
    storages: [{ type: 4, amount: -1, flag: 2 }, { type: 11, amount: 1, flag: 2 }, { type: 19, amount: 1, flag: 1 }], resourceCapacity: 10, resourceDecay: 5,
    action: {
      workRate: f32(0.600000024), dropSites: [103, 109], taskSwapGroup: 1,
      tasks: [
        T(5, 5, -1, -1, 17, -1, 0, 1, f32(0.600000024), 0, 3, 1, 0, null, S(469, 16, 8, 0, f32(0.100000001), 2, 3), null, S(89, 15, 8, 1, f32(0.0465000011), 0, 3)),
        T(3, 20, -1, -1, -1, -1, -1, 0, 1, 0, 4, 0, 0, null, null, null, null),
        T(109, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, null, null, null, null),
      ],
    },
    combat: {
      attacks: [{ group: 4, amount: 3 }], armours: [{ group: 12, amount: 0 }], baseArmour: 0,
      reloadTime: 1, range: 0, minRange: 0, projectileUnitId: -1, frameDelay: 0, accuracy: 0,
      blastWidth: 0, attackSprite: null, displacement: [0, 0, f32(0.5)],
    },
    missile: null,
  },
  {
    id: 120, name: "Forager", masterType: 70, group: 4, hitPoints: 25,
    speed: f32(1.10000002), radiusX: f32(0.200000003), radiusY: f32(0.200000003), radiusZ: f32(1.89999998), turnSpeed: 0,
    flying: false, terrainRestriction: 7, terrainTable: terrains(7), combatLevel: 3,
    standing: S(300, 10, 8, 0, 1, 3, 7), walking: S(681, 15, 8, 1, f32(0.0799999982), 0, 3), dying: S(186, 10, 8, 0, f32(0.100000001), 0, 11), deadUnitId: 258,
    storages: [{ type: 4, amount: -1, flag: 2 }, { type: 11, amount: 1, flag: 2 }, { type: 19, amount: 1, flag: 1 }], resourceCapacity: 10, resourceDecay: 5,
    action: {
      workRate: f32(0.449999988), dropSites: [109, 68], taskSwapGroup: 1,
      tasks: [
        T(5, 7, -1, -1, 16, -1, 0, 1, 0, 0, 3, 1, 0, null, S(470, 27, 8, 0, f32(0.119999997), 0, 3), null, S(681, 15, 8, 1, f32(0.0799999982), 0, 3)),
        T(3, 20, -1, -1, -1, -1, -1, 0, 1, 0, 4, 0, 0, null, null, null, null),
        T(109, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, null, null, null, null),
      ],
    },
    combat: {
      attacks: [{ group: 4, amount: 3 }], armours: [{ group: 12, amount: 0 }], baseArmour: 0,
      reloadTime: 1, range: 0, minRange: 0, projectileUnitId: -1, frameDelay: 0, accuracy: 0,
      blastWidth: 0, attackSprite: null, displacement: [0, 0, f32(0.5)],
    },
    missile: null,
  },
  {
    id: 122, name: "Hunter", masterType: 70, group: 4, hitPoints: 25,
    speed: f32(1.10000002), radiusX: f32(0.200000003), radiusY: f32(0.200000003), radiusZ: f32(1.70000005), turnSpeed: 0,
    flying: false, terrainRestriction: 7, terrainTable: terrains(7), combatLevel: 3,
    standing: S(303, 6, 8, 0, 1, 3, 7), walking: S(685, 15, 8, 1, f32(0.0799999982), 0, 3), dying: S(189, 10, 8, 0, f32(0.100000001), 0, 11), deadUnitId: 255,
    storages: [{ type: 4, amount: -1, flag: 2 }, { type: 11, amount: 1, flag: 2 }, { type: 19, amount: 1, flag: 1 }], resourceCapacity: 10, resourceDecay: 5,
    action: {
      workRate: f32(0.449999988), dropSites: [109, 103], taskSwapGroup: 1,
      tasks: [
        T(110, 9, -1, -1, 15, -1, 0, 1, 0, 0, 3, 1, 0, S(685, 15, 8, 1, f32(0.0799999982), 0, 3), S(471, 23, 8, 0, f32(0.0649999976), 0, 3), S(472, 12, 8, 0, f32(0.100000001), 0, 3), S(92, 15, 8, 1, f32(0.0465000011), 0, 3)),
        T(110, 10, -1, -1, 15, -1, 0, 1, 0, 0, 3, 0, 0, S(685, 15, 8, 1, f32(0.0799999982), 0, 3), S(471, 23, 8, 0, f32(0.0649999976), 0, 3), S(472, 12, 8, 0, f32(0.100000001), 0, 3), S(92, 15, 8, 1, f32(0.0465000011), 0, 3)),
        T(3, 20, -1, -1, -1, -1, -1, 0, 1, 0, 4, 0, 0, null, null, null, null),
        T(109, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, null, null, null, null),
      ],
    },
    combat: {
      attacks: [{ group: 4, amount: 4 }], armours: [{ group: 12, amount: 0 }], baseArmour: 0,
      reloadTime: f32(1.5), range: 4, minRange: 0, projectileUnitId: 100, frameDelay: 5, accuracy: 80,
      blastWidth: 0, attackSprite: S(471, 23, 8, 0, f32(0.0649999976), 0, 3), displacement: [0, f32(0.5), 2],
    },
    missile: null,
  },
  {
    id: 123, name: "Lumberjack", masterType: 70, group: 4, hitPoints: 25,
    speed: f32(1.10000002), radiusX: f32(0.200000003), radiusY: f32(0.200000003), radiusZ: f32(1.89999998), turnSpeed: 0,
    flying: false, terrainRestriction: 7, terrainTable: terrains(7), combatLevel: 3,
    standing: S(310, 6, 8, 0, 1, 3, 7), walking: S(692, 15, 8, 1, f32(0.0799999982), 0, 3), dying: S(194, 10, 8, 0, f32(0.100000001), 0, 11), deadUnitId: 252,
    storages: [{ type: 4, amount: -1, flag: 2 }, { type: 11, amount: 1, flag: 2 }, { type: 19, amount: 1, flag: 1 }], resourceCapacity: 10, resourceDecay: 5,
    action: {
      workRate: f32(0.550000012), dropSites: [109, 103], taskSwapGroup: 1,
      tasks: [
        T(110, 15, -1, -1, 1, -1, -1, 1, 0, 0, 3, 1, 0, null, S(473, 11, 8, 0, f32(0.119999997), 0, 3), S(467, 15, 8, 0, f32(0.100000001), 0, 3), S(93, 15, 8, 1, f32(0.0465000011), 0, 3)),
        T(3, 20, -1, -1, -1, -1, -1, 0, 1, 0, 4, 0, 0, null, null, null, null),
        T(109, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, null, null, null, null),
      ],
    },
    combat: {
      attacks: [{ group: 4, amount: 3 }], armours: [{ group: 12, amount: 0 }], baseArmour: 0,
      reloadTime: 1, range: 0, minRange: 0, projectileUnitId: -1, frameDelay: 0, accuracy: 100,
      blastWidth: 0, attackSprite: null, displacement: [0, 0, f32(0.5)],
    },
    missile: null,
  },
  {
    id: 124, name: "Miner-Stone", masterType: 70, group: 4, hitPoints: 25,
    speed: f32(1.10000002), radiusX: f32(0.200000003), radiusY: f32(0.200000003), radiusZ: f32(1.89999998), turnSpeed: 0,
    flying: false, terrainRestriction: 7, terrainTable: terrains(7), combatLevel: 3,
    standing: S(311, 6, 5, 0, 1, 3, 7), walking: S(693, 15, 8, 1, f32(0.0799999982), 0, 3), dying: S(195, 10, 8, 0, f32(0.100000001), 0, 11), deadUnitId: 254,
    storages: [{ type: 4, amount: -1, flag: 2 }, { type: 11, amount: 1, flag: 2 }, { type: 19, amount: 1, flag: 1 }], resourceCapacity: 10, resourceDecay: 5,
    action: {
      workRate: f32(0.449999988), dropSites: [109, 103], taskSwapGroup: 1,
      tasks: [
        T(5, -1, 102, -1, 2, -1, -1, 1, 0, 0, 3, 1, 0, null, S(474, 13, 8, 0, f32(0.119999997), 0, 3), null, S(94, 15, 8, 1, f32(0.0465000011), 0, 3)),
        T(3, 20, -1, -1, -1, -1, -1, 0, 1, 0, 4, 0, 0, null, null, null, null),
        T(109, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, null, null, null, null),
      ],
    },
    combat: {
      attacks: [{ group: 4, amount: 3 }], armours: [{ group: 12, amount: 0 }], baseArmour: 0,
      reloadTime: 1, range: 0, minRange: 0, projectileUnitId: -1, frameDelay: 0, accuracy: 100,
      blastWidth: 0, attackSprite: null, displacement: [0, 0, 0],
    },
    missile: null,
  },
  {
    id: 251, name: "Miner-Gold", masterType: 70, group: 4, hitPoints: 25,
    speed: f32(1.10000002), radiusX: f32(0.200000003), radiusY: f32(0.200000003), radiusZ: f32(1.89999998), turnSpeed: 0,
    flying: false, terrainRestriction: 7, terrainTable: terrains(7), combatLevel: 3,
    standing: S(301, 6, 5, 0, f32(0.150000006), 2, 7), walking: S(682, 15, 8, 1, f32(0.0799999982), 0, 3), dying: S(195, 10, 8, 0, f32(0.100000001), 0, 11), deadUnitId: 254,
    storages: [{ type: 4, amount: -1, flag: 2 }, { type: 11, amount: 1, flag: 2 }, { type: 19, amount: 1, flag: 1 }], resourceCapacity: 10, resourceDecay: 5,
    action: {
      workRate: f32(0.449999988), dropSites: [109, 103], taskSwapGroup: 1,
      tasks: [
        T(5, -1, 66, -1, 3, 47, -1, 1, 0, 0, 3, 1, 0, null, S(474, 13, 8, 0, f32(0.119999997), 0, 3), null, S(91, 15, 8, 1, f32(0.0465000011), 0, 3)),
        T(3, 20, -1, -1, -1, -1, -1, 0, 1, 0, 4, 0, 0, null, null, null, null),
        T(109, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, null, null, null, null),
      ],
    },
    combat: {
      attacks: [{ group: 4, amount: 3 }], armours: [{ group: 12, amount: 0 }], baseArmour: 0,
      reloadTime: 1, range: 0, minRange: 0, projectileUnitId: -1, frameDelay: 0, accuracy: 0,
      blastWidth: 0, attackSprite: null, displacement: [0, 0, f32(0.5)],
    },
    missile: null,
  },
  {
    id: 259, name: "Farmer", masterType: 70, group: 4, hitPoints: 25,
    speed: f32(1.10000002), radiusX: f32(0.200000003), radiusY: f32(0.200000003), radiusZ: f32(1.89999998), turnSpeed: 0,
    flying: false, terrainRestriction: 7, terrainTable: terrains(7), combatLevel: 3,
    standing: S(298, 6, 8, 0, 1, 3, 7), walking: S(679, 15, 8, 1, f32(0.0799999982), 0, 3), dying: S(184, 10, 8, 0, f32(0.100000001), 0, 11), deadUnitId: 257,
    storages: [{ type: 4, amount: -1, flag: 2 }, { type: 11, amount: 1, flag: 2 }, { type: 19, amount: 1, flag: 1 }], resourceCapacity: 10, resourceDecay: 5,
    action: {
      workRate: f32(0.449999988), dropSites: [109, 68], taskSwapGroup: 1,
      tasks: [
        T(5, -1, 50, -1, 16, -1, 0, 1, 0, 0, 1, 0, 0, null, S(468, 29, 8, 0, f32(0.119999997), 0, 3), null, S(829, 15, 8, 1, f32(0.0465000011), 0, 3)),
        T(3, 20, -1, -1, -1, -1, -1, 0, 1, 0, 4, 0, 0, null, null, null, null),
        T(109, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, null, null, null, null),
      ],
    },
    combat: {
      attacks: [], armours: [{ group: 12, amount: 0 }], baseArmour: 0,
      reloadTime: 1, range: 0, minRange: 0, projectileUnitId: -1, frameDelay: 0, accuracy: 0,
      blastWidth: 0, attackSprite: null, displacement: [0, 0, f32(0.5)],
    },
    missile: null,
  },
  {
    id: 109, name: "Town_Center1", masterType: 80, group: 3, hitPoints: 600,
    speed: 0, radiusX: f32(1.5), radiusY: f32(1.5), radiusZ: 2, turnSpeed: 0,
    flying: false, terrainRestriction: 4, terrainTable: terrains(4), combatLevel: 2,
    standing: S(598, 1, 3, 0, f32(0.100000001), 0, 1), walking: S(598, 1, 3, 0, f32(0.100000001), 0, 1), dying: S(492, 10, 1, 0, f32(0.0465000011), 0, 9), deadUnitId: 328,
    storages: [{ type: 4, amount: 4, flag: 4 }, { type: 30, amount: -1, flag: 2 }], resourceCapacity: 0, resourceDecay: 0,
    action: {
      workRate: 1, dropSites: [-1, -1], taskSwapGroup: 0,
      tasks: [
      ],
    },
    combat: {
      attacks: [], armours: [{ group: 6, amount: -140 }, { group: 4, amount: 0 }], baseArmour: 0,
      reloadTime: 0, range: 0, minRange: 0, projectileUnitId: -1, frameDelay: 0, accuracy: 0,
      blastWidth: 0, attackSprite: null, displacement: [0, 0, 0],
    },
    missile: null,
  },
  {
    id: 100, name: "Missle-Spear", masterType: 60, group: 11, hitPoints: 1,
    speed: 6, radiusX: f32(0.100000001), radiusY: f32(0.100000001), radiusZ: 0, turnSpeed: 0,
    flying: true, terrainRestriction: 0, terrainTable: terrains(0), combatLevel: 0,
    standing: S(513, 1, 32, 0, 0, 0, 2), walking: S(513, 1, 32, 0, 0, 0, 2), dying: S(513, 1, 32, 0, 0, 0, 2), deadUnitId: -1,
    storages: [], resourceCapacity: 0, resourceDecay: 0,
    action: {
      workRate: 1, dropSites: [-1, -1], taskSwapGroup: 0,
      tasks: [
      ],
    },
    combat: {
      attacks: [{ group: 4, amount: 10 }], armours: [], baseArmour: 0,
      reloadTime: 0, range: 20, minRange: 0, projectileUnitId: -1, frameDelay: 0, accuracy: 100,
      blastWidth: 0, attackSprite: S(513, 1, 32, 0, 0, 0, 2), displacement: [0, 0, 0],
    },
    missile: { type: 0, targetting: 1, hitInfo: 0, ballistics: f32(0.100000001) },
  },
  {
    id: 65, name: "Gazelle", masterType: 70, group: 9, hitPoints: 8,
    speed: f32(1.10000002), radiusX: f32(0.200000003), radiusY: f32(0.200000003), radiusZ: 1, turnSpeed: 0,
    flying: false, terrainRestriction: 1, terrainTable: terrains(1), combatLevel: 1,
    standing: S(397, 12, 8, 0, f32(0.200000003), 0, 3), walking: S(399, 10, 8, 1, f32(0.0465000011), 0, 3), dying: S(396, 10, 8, 0, f32(0.0465000011), 0, 11), deadUnitId: 262,
    storages: [{ type: 0, amount: 150, flag: 0 }], resourceCapacity: 150, resourceDecay: f32(0.300000012),
    action: {
      workRate: 1, dropSites: [-1, -1], taskSwapGroup: 0,
      tasks: [
        T(6, -1, -1, -1, -1, -1, -1, 20, 0, 0, 0, 0, 0, null, S(397, 12, 8, 0, f32(0.200000003), 0, 3), null, null),
        T(7, -1, -1, -1, -1, -1, -1, 0, 0, 1, 0, 0, 0, null, null, null, null),
      ],
    },
    combat: {
      attacks: [{ group: 4, amount: 3 }], armours: [{ group: 12, amount: 2 }], baseArmour: 0,
      reloadTime: 1, range: 0, minRange: 0, projectileUnitId: -1, frameDelay: 0, accuracy: 100,
      blastWidth: 0, attackSprite: S(397, 12, 8, 0, f32(0.200000003), 0, 3), displacement: [0, 0, 0],
    },
    missile: null,
  },
  {
    id: 48, name: "Elephant", masterType: 70, group: 10, hitPoints: 45,
    speed: 1, radiusX: f32(0.5), radiusY: f32(0.5), radiusZ: 2, turnSpeed: 0,
    flying: false, terrainRestriction: 1, terrainTable: terrains(1), combatLevel: 1,
    standing: S(297, 10, 8, 0, f32(0.119999997), f32(0.5), 7), walking: S(678, 8, 8, 1, f32(0.119999997), 0, 3), dying: S(183, 12, 8, 0, f32(0.100000001), 0, 11), deadUnitId: 335,
    storages: [{ type: 0, amount: 300, flag: 0 }], resourceCapacity: 300, resourceDecay: f32(0.200000003),
    action: {
      workRate: 1, dropSites: [-1, -1], taskSwapGroup: 0,
      tasks: [
        T(6, -1, -1, -1, -1, -1, -1, 20, 0, 0, 0, 0, 0, null, S(297, 10, 8, 0, f32(0.119999997), f32(0.5), 7), null, null),
        T(7, -1, -1, -1, -1, -1, -1, 0, 0, 1, 0, 0, 0, null, null, null, null),
      ],
    },
    combat: {
      attacks: [{ group: 4, amount: 10 }, { group: 10, amount: 0 }], armours: [], baseArmour: 0,
      reloadTime: 1, range: 0, minRange: 0, projectileUnitId: -1, frameDelay: 0, accuracy: 100,
      blastWidth: 0, attackSprite: S(29, 10, 8, 0, f32(0.100000001), 0, 3), displacement: [0, 0, 0],
    },
    missile: null,
  },
  {
    id: 66, name: "Mine-Gold", masterType: 30, group: 32, hitPoints: 0,
    speed: 0, radiusX: f32(0.5), radiusY: f32(0.5), radiusZ: 1, turnSpeed: 0,
    flying: false, terrainRestriction: 8, terrainTable: terrains(8), combatLevel: 0,
    standing: S(477, 1, 7, 0, 0, 0, 2), walking: S(477, 1, 7, 0, 0, 0, 2), dying: null, deadUnitId: -1,
    storages: [{ type: 3, amount: 400, flag: 0 }], resourceCapacity: 400, resourceDecay: 0,
    action: null,
    combat: null,
    missile: null,
  },
  {
    id: 102, name: "Mine-Stone", masterType: 30, group: 8, hitPoints: 0,
    speed: 0, radiusX: f32(0.5), radiusY: f32(0.5), radiusZ: 1, turnSpeed: 0,
    flying: false, terrainRestriction: 8, terrainTable: terrains(8), combatLevel: 0,
    standing: S(478, 1, 7, 0, 0, 0, 2), walking: S(478, 1, 7, 0, 0, 0, 2), dying: null, deadUnitId: -1,
    storages: [{ type: 2, amount: 250, flag: 0 }], resourceCapacity: 250, resourceDecay: 0,
    action: null,
    combat: null,
    missile: null,
  },
  {
    id: 59, name: "Forage-Fruit", masterType: 10, group: 7, hitPoints: 0,
    speed: 0, radiusX: f32(0.200000003), radiusY: f32(0.200000003), radiusZ: f32(0.200000003), turnSpeed: 0,
    flying: false, terrainRestriction: 8, terrainTable: terrains(8), combatLevel: 0,
    standing: S(333, 1, 1, 0, 0, 0, 0), walking: null, dying: S(333, 1, 1, 0, 0, 0, 0), deadUnitId: -1,
    storages: [{ type: 0, amount: 150, flag: 0 }], resourceCapacity: 150, resourceDecay: 0,
    action: null,
    combat: null,
    missile: null,
  },
  {
    id: 134, name: "Tree01", masterType: 90, group: 15, hitPoints: 25,
    speed: 0, radiusX: f32(0.300000012), radiusY: f32(0.300000012), radiusZ: 2, turnSpeed: 0,
    flying: false, terrainRestriction: 4, terrainTable: terrains(4), combatLevel: 0,
    standing: S(601, 1, 1, 0, 0, 0, 0), walking: null, dying: S(636, 1, 1, 0, f32(0.100000001), 0, 0), deadUnitId: 115,
    storages: [{ type: 1, amount: 75, flag: 0 }], resourceCapacity: 75, resourceDecay: 0,
    action: null,
    combat: null,
    missile: null,
  },
  {
    id: 141, name: "Tree08", masterType: 90, group: 15, hitPoints: 25,
    speed: 0, radiusX: f32(0.300000012), radiusY: f32(0.300000012), radiusZ: 2, turnSpeed: 0,
    flying: false, terrainRestriction: 4, terrainTable: terrains(4), combatLevel: 0,
    standing: S(608, 1, 1, 0, 0, 0, 0), walking: null, dying: S(636, 1, 1, 0, f32(0.100000001), 0, 0), deadUnitId: 115,
    storages: [{ type: 1, amount: 75, flag: 0 }], resourceCapacity: 75, resourceDecay: 0,
    action: null,
    combat: null,
    missile: null,
  },
  {
    id: 143, name: "Tree10", masterType: 90, group: 15, hitPoints: 25,
    speed: 0, radiusX: f32(0.5), radiusY: f32(0.5), radiusZ: 2, turnSpeed: 0,
    flying: false, terrainRestriction: 4, terrainTable: terrains(4), combatLevel: 0,
    standing: S(610, 1, 1, 0, 0, 0, 0), walking: null, dying: S(636, 1, 1, 0, f32(0.100000001), 0, 0), deadUnitId: 130,
    storages: [{ type: 1, amount: 40, flag: 0 }], resourceCapacity: 75, resourceDecay: 0,
    action: null,
    combat: null,
    missile: null,
  },
  {
    id: 115, name: "Tree_Stump1", masterType: 30, group: 16, hitPoints: 30,
    speed: 0, radiusX: 0, radiusY: 0, radiusZ: 0, turnSpeed: 0,
    flying: false, terrainRestriction: 4, terrainTable: terrains(4), combatLevel: 0,
    standing: S(600, 1, 4, 0, 0, 0, 6), walking: S(600, 1, 4, 0, 0, 0, 6), dying: S(600, 1, 4, 0, 0, 0, 6), deadUnitId: -1,
    storages: [], resourceCapacity: 0, resourceDecay: 0,
    action: null,
    combat: null,
    missile: null,
  },
  {
    id: 130, name: "Tree_Stump2", masterType: 30, group: 16, hitPoints: 30,
    speed: 0, radiusX: 0, radiusY: 0, radiusZ: 0, turnSpeed: 0,
    flying: false, terrainRestriction: 4, terrainTable: terrains(4), combatLevel: 0,
    standing: S(600, 1, 4, 0, 0, 0, 6), walking: S(600, 1, 4, 0, 0, 0, 6), dying: S(600, 1, 4, 0, 0, 0, 6), deadUnitId: -1,
    storages: [], resourceCapacity: 0, resourceDecay: 0,
    action: null,
    combat: null,
    missile: null,
  },
  {
    id: 262, name: "Dead_Gazelle", masterType: 30, group: 11, hitPoints: 0,
    speed: 0, radiusX: 0, radiusY: 0, radiusZ: 0, turnSpeed: 0,
    flying: false, terrainRestriction: 1, terrainTable: terrains(1), combatLevel: 0,
    standing: S(395, 4, 8, 0, 10, 0, 11), walking: null, dying: null, deadUnitId: -1,
    storages: [{ type: 12, amount: 300, flag: 0 }], resourceCapacity: 300, resourceDecay: 1,
    action: null,
    combat: null,
    missile: null,
  },
  {
    id: 335, name: "Dead_Elephant", masterType: 30, group: 11, hitPoints: 0,
    speed: 0, radiusX: 0, radiusY: 0, radiusZ: 0, turnSpeed: 0,
    flying: false, terrainRestriction: 0, terrainTable: terrains(0), combatLevel: 0,
    standing: S(147, 4, 8, 0, 15, 0, 11), walking: null, dying: null, deadUnitId: -1,
    storages: [{ type: 12, amount: 400, flag: 0 }], resourceCapacity: 400, resourceDecay: 1,
    action: null,
    combat: null,
    missile: null,
  },
];

export const UNIT_TYPES: ReadonlyMap<number, UnitType> = new Map(TYPES.map((t) => [t.id, t]));

/** Every sprite the types above use, by graphic id. */
const SPRITES = new Map<number, SpriteInfo>();
for (const t of TYPES) {
  const tasks = t.action?.tasks.flatMap((k) => [k.moving, k.proceeding, k.working, k.carrying]) ?? [];
  for (const s of [t.standing, t.walking, t.dying, t.combat?.attackSprite ?? null, ...tasks]) if (s) SPRITES.set(s.graphic, s);
}

export function spriteInfo(graphic: number): SpriteInfo {
  const s = SPRITES.get(graphic);
  if (!s) throw new Error(`graphic ${graphic} is not in the sim's table`);
  return s;
}

export function unitType(id: number): UnitType {
  const t = UNIT_TYPES.get(id);
  if (!t) throw new Error(`unit type ${id} is not in the sim's table`);
  return t;
}
