import { EFFECT_RECORDS, TECH_RECORDS, TERRAIN_ROWS, UNIT_RECORDS } from './unit-data';
import type { SimSprite, SimUnitRecord } from './unit-record';

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
 * The master-object fields the sim reads (docs/spec/movement.md §2, economy.md §2, combat.md §1). Values are generated
 * from the original `empires.dat` into `unit-data.ts` by tools/gen-sim-tables.mjs (civ 1's record, Gaia's for units
 * civ 1 lacks; every civ that has a unit has the same record) and checked against it by packages/data
 * `units.golden.test.ts`. Float fields hold float32 values.
 */
export interface UnitType {
  id: number;
  name: string;
  /** Dat object type: 10 static, 30 moving, 60 missile, 70 combat unit, 80 building, 90 tree. */
  masterType: number;
  /** Dat class (`object_group`). */
  group: number;
  hitPoints: number;
  /** `line_of_sight`, tiles: the unit AI's search radius. */
  los: number;
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
  /** Construction radius (`construction_radius_x/y`, the dat's clearance size): a building's placement footprint. */
  clearanceX: number;
  clearanceY: number;
  /** `can_be_built_on`: a foundation removes objects with this set (`check_destructables`). */
  canBeBuiltOn: number;
  /** `elevation_flag` (the dat's hill mode): 1 allows flat and some slope tiles, 2 flat tiles only. */
  elevationMode: number;
  /** `center_tile_req1/2` (the dat's placement terrain), -1 none. */
  placementTerrain: readonly [number, number];
  /** `tile_req1/2` (the dat's placement side terrain), -1 none. */
  placementSideTerrain: readonly [number, number];
  /** `available` at game start; techs enable or disable it per player. */
  enabled: boolean;
  creatable: CreatableInfo | null;
  building: BuildingInfo | null;
}

/** `TRIBE_Master_Combat_Object` creation fields (economy.md §2.1). */
export interface CreatableInfo {
  /** `build_inventory`: slots with a type, in slot order. Flag 0 is checked but not paid. */
  costs: readonly Storage[];
  /** `build_pts_required`: build points of a building, seconds of training at work rate 1 for a unit. */
  trainTime: number;
  /** `id_of_building_obj`. */
  trainLocationId: number;
}

/** `TRIBE_Master_Building_Object` fields (economy.md §4). */
export interface BuildingInfo {
  /** `construction_sprite`, shown while unbuilt. */
  construction: SpriteInfo | null;
  /** `building_facet`. */
  facet: number;
  /** `build_and_go_away`. */
  disappearsWhenBuilt: boolean;
  /** `on_build_make_obj`, -1 none. */
  makeObject: number;
  /** `on_build_make_tile`, -1 none. */
  makeTile: number;
  /** `on_build_make_tech`, -1 none. */
  techId: number;
}

export const VILLAGER = 83;
export const BUILDER = 118;
export const LUMBERJACK = 123;
export const HUNTER = 122;
export const FORAGER = 120;
export const MINER_STONE = 124;
export const MINER_GOLD = 251;
export const TOWN_CENTER = 109;
export const BARRACKS = 12;
export const HOUSE = 70;
export const GRANARY = 68;
export const STORAGE_PIT = 103;
export const CLUBMAN = 73;
export const BOWMAN = 4;
export const SCOUT = 299;
export const FLARE = 112;
export const GAZELLE = 65;
export const ELEPHANT = 48;
export const MINE_GOLD = 66;
export const MINE_STONE = 102;
export const FORAGE = 59;
/** Tree01 and Tree08 hold 75 wood (cap 75); Tree10 holds 40 (cap 75). */
export const TREES = [134, 141, 143] as const;

function sprite(s: SimSprite | null): SpriteInfo | null {
  if (!s) return null;
  const [graphic, frames, facets, baseSpeed, duration, pause, flags] = s;
  return { graphic, frames, facets, baseSpeed, duration, pause, flags, hasFacings: (flags & 2) !== 0, randomStart: (flags & 5) === 5 };
}

function task(k: readonly (number | SimSprite | null)[]): Task {
  const n = (i: number) => k[i] as number;
  const s = (i: number) => sprite(k[i] as SimSprite | null);
  return {
    actionType: n(0),
    group: n(1),
    unitId: n(2),
    terrainId: n(3),
    resourceIn: n(4),
    resourceMultiplier: n(5),
    resourceOut: n(6),
    workValue1: n(7),
    workRange: n(8),
    combatLevel: n(9),
    diplomacy: n(10),
    carryCheck: n(11),
    building: n(12),
    moving: s(13),
    proceeding: s(14),
    working: s(15),
    carrying: s(16),
  };
}

const storage = ([type, amount, flag]: readonly number[]): Storage => ({ type: type!, amount: amount!, flag: flag! });

/** A generated record (`unit-data.ts`) as the sim's `UnitType`. */
export function toUnitType(r: SimUnitRecord): UnitType {
  const c = r.combat;
  const b = r.building;
  return {
    id: r.id,
    name: r.name,
    masterType: r.masterType,
    group: r.group,
    hitPoints: r.hitPoints,
    los: r.los,
    speed: r.speed,
    radiusX: r.radius[0],
    radiusY: r.radius[1],
    radiusZ: r.radius[2],
    turnSpeed: r.turnSpeed,
    flying: r.flying,
    terrainRestriction: r.terrainRestriction,
    terrainTable: TERRAIN_ROWS[r.terrainRestriction]!,
    combatLevel: r.combatLevel,
    standing: sprite(r.standing)!,
    walking: sprite(r.walking),
    dying: sprite(r.dying),
    deadUnitId: r.deadUnitId,
    storages: r.storages.map(storage),
    resourceCapacity: r.resourceCapacity,
    resourceDecay: r.resourceDecay,
    action: r.action && { workRate: r.action.workRate, dropSites: r.action.dropSites, taskSwapGroup: r.action.taskSwapGroup, tasks: r.action.tasks.map(task) },
    combat: c && {
      attacks: c.attacks.map(([group, amount]) => ({ group, amount })),
      armours: c.armours.map(([group, amount]) => ({ group, amount })),
      baseArmour: c.baseArmour,
      reloadTime: c.reloadTime,
      range: c.range,
      minRange: c.minRange,
      projectileUnitId: c.projectileUnitId,
      frameDelay: c.frameDelay,
      accuracy: c.accuracy,
      blastWidth: c.blastWidth,
      attackSprite: sprite(c.attackSprite),
      displacement: c.displacement,
    },
    missile: r.missile,
    clearanceX: r.clearance[0],
    clearanceY: r.clearance[1],
    canBeBuiltOn: r.canBeBuiltOn,
    elevationMode: r.elevationMode,
    placementTerrain: r.placementTerrain,
    placementSideTerrain: r.placementSideTerrain,
    enabled: r.enabled,
    creatable: r.creatable && { costs: r.creatable.costs.map(storage), trainTime: r.creatable.trainTime, trainLocationId: r.creatable.trainLocationId },
    building: b && {
      construction: sprite(b.construction),
      facet: b.facet,
      disappearsWhenBuilt: b.disappearsWhenBuilt,
      makeObject: b.makeObject,
      makeTile: b.makeTile,
      techId: b.techId,
    },
  };
}

const TYPES = UNIT_RECORDS.map(toUnitType);

export const UNIT_TYPES: ReadonlyMap<number, UnitType> = new Map(TYPES.map((t) => [t.id, t]));

/** Every sprite the types above use, by graphic id. */
const SPRITES = new Map<number, SpriteInfo>();
for (const t of TYPES) {
  const tasks = t.action?.tasks.flatMap((k) => [k.moving, k.proceeding, k.working, k.carrying]) ?? [];
  const sprites = [t.standing, t.walking, t.dying, t.combat?.attackSprite ?? null, t.building?.construction ?? null, ...tasks];
  for (const s of sprites) if (s) SPRITES.set(s.graphic, s);
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

/** A tech record (`Tech_Tree`, techs.md §2.1). */
export interface TechInfo {
  /** `pre_reqs`: tech ids, -1 none (0 is tech 0, not "none"). */
  requires: readonly number[];
  /** `pre_reqs_required`. */
  required: number;
  /** `research` time in seconds. */
  researchTime: number;
  /** Effect run on completion, -1 none. */
  effect: number;
}

/** Every tech of the dat, by id. */
export const TECHS: readonly TechInfo[] = TECH_RECORDS.map(([requires, required, researchTime, effect]) => ({ requires, required, researchTime, effect }));

/** One effect command (techs.md §2.2). */
export interface EffectCommand {
  type: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Every effect of the dat, by id: its commands in list order. */
export const EFFECTS: readonly (readonly EffectCommand[])[] = EFFECT_RECORDS.map((e) => e.map(([type, a, b, c, d]) => ({ type: type!, a: a!, b: b!, c: c!, d: d! })));
