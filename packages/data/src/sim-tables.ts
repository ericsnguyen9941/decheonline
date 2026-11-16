// The sim's rule tables (packages/sim/src/unit-data.ts) built from empires.dat. `tools/gen-sim-tables.mjs` writes the
// file with `renderSimTables`; `units.golden.test.ts` regenerates it from the real dat and compares.
import type { RuleSet } from './rules';
import type { Unit, UnitTask } from './types';
import type { SimSprite, SimStorage, SimUnitRecord } from '@aoe/sim';

const f = Math.fround;

function sprite(rules: RuleSet, graphic: number): SimSprite | null {
  if (graphic < 0) return null;
  const g = rules.graphic(graphic);
  return [graphic, g.frameCount, g.angleCount, f(g.speedMultiplier), f(g.frameDuration), f(g.replayDelay), g.sequenceType];
}

function task(rules: RuleSet, k: UnitTask): (number | SimSprite | null)[] {
  return [
    k.actionType,
    k.classId,
    k.unitId,
    k.terrainId,
    k.resourceIn,
    k.resourceMultiplier,
    k.resourceOut,
    f(k.workValue1),
    f(k.workRange),
    k.enableTargeting,
    k.targetDiplomacy,
    k.carryCheck,
    k.pickForConstruction,
    sprite(rules, k.movingGraphicId),
    sprite(rules, k.proceedingGraphicId),
    sprite(rules, k.workingGraphicId),
    sprite(rules, k.carryingGraphicId),
    k.isDefault,
    k.gatherType,
    f(k.workValue2),
  ];
}

/** The sim's record of unit `id` as civ `civ` has it. */
export function simUnitRecord(rules: RuleSet, civ: number, id: number): SimUnitRecord {
  const u: Unit = rules.unit(civ, id);
  const storages = (list: { type: number; amount: number; flag: number }[]): SimStorage[] =>
    list.filter((s) => s.type >= 0).map((s) => [s.type, f(s.amount), s.flag]);
  const standing = sprite(rules, u.standingGraphic)!;
  return {
    id: u.id,
    name: u.name,
    masterType: u.type,
    group: u.class,
    hitPoints: u.hitPoints,
    los: f(u.lineOfSight),
    fogFlag: u.fogVisibility,
    speed: f(u.speed ?? 0),
    radius: [f(u.collisionSize[0]!), f(u.collisionSize[1]!), f(u.collisionSize[2]!)],
    clearance: [f(u.clearanceSize[0]!), f(u.clearanceSize[1]!)],
    turnSpeed: f(u.movement?.rotationSpeed ?? 0),
    flying: u.flyMode === 1,
    terrainRestriction: u.terrainRestriction,
    combatLevel: u.combatLevel,
    blastDefense: u.blastDefenseLevel,
    canBeBuiltOn: u.canBeBuiltOn,
    objMax: u.garrisonCapacity,
    unitLevel: u.interfaceKind,
    trackAsResource: u.enableAutoGather,
    resourceGroup: u.resourceGatherGroup,
    elevationMode: u.hillMode,
    placementTerrain: [u.placementTerrain[0]!, u.placementTerrain[1]!],
    placementSideTerrain: [u.placementSideTerrain[0]!, u.placementSideTerrain[1]!],
    enabled: u.enabled !== 0,
    standing,
    walking: u.movement ? sprite(rules, u.movement.walkingGraphic) : null,
    dying: sprite(rules, u.dyingGraphic),
    deadUnitId: u.deadUnitId,
    // The game reads the entry's second field as two bytes into `damage_percent` and `flag`, then its third, one byte,
    // over `flag` (src/m_s_obj.cpp:239-241): the percent is the low byte.
    damage: u.damageGraphics.map((g) => [sprite(rules, g.graphicId), g.damagePercent & 0xff, g.applyMode]),
    storages: storages(u.resourceStorages),
    resourceCapacity: u.resourceCapacity,
    resourceDecay: f(u.resourceDecay),
    action: u.action
      ? {
          workRate: f(u.action.workRate),
          dropSites: [u.action.dropSites[0]!, u.action.dropSites[1]!],
          taskSwapGroup: u.action.taskSwapGroup,
          tasks: u.action.tasks.map((k) => task(rules, k)),
        }
      : null,
    combat: u.combat
      ? {
          attacks: u.combat.attacks.map((a) => [a.class, a.amount]),
          armours: u.combat.armours.map((a) => [a.class, a.amount]),
          baseArmour: u.combat.baseArmour,
          reloadTime: f(u.combat.reloadTime),
          range: f(u.combat.maxRange),
          minRange: f(u.combat.minRange),
          projectileUnitId: u.combat.projectileUnitId,
          frameDelay: u.combat.frameDelay,
          accuracy: u.combat.accuracyPercent,
          blastWidth: f(u.combat.blastWidth),
          blastLevel: u.combat.blastAttackLevel,
          attackSprite: sprite(rules, u.combat.attackGraphic),
          displacement: [f(u.combat.graphicDisplacement[0]!), f(u.combat.graphicDisplacement[1]!), f(u.combat.graphicDisplacement[2]!)],
        }
      : null,
    missile: u.projectile
      ? { type: u.projectile.projectileType, targetting: u.projectile.smartMode, hitInfo: u.projectile.hitMode, ballistics: f(u.projectile.projectileArc) }
      : null,
    creatable: u.creatable ? { costs: storages(u.creatable.costs), trainTime: u.creatable.trainTime, trainLocationId: u.creatable.trainLocationId } : null,
    building: u.building
      ? {
          construction: sprite(rules, u.building.constructionGraphicId),
          facet: u.building.graphicsAngle,
          connect: u.building.adjacentMode !== 0,
          disappearsWhenBuilt: u.building.disappearsWhenBuilt !== 0,
          makeObject: u.building.stackUnitId,
          makeTile: u.building.foundationTerrainId,
          techId: u.building.techId,
        }
      : null,
  };
}

/** Civ a record is read from: civ 1 (Egyptians) when it has the unit, else Gaia. */
export function simTableCiv(rules: RuleSet, id: number): number {
  return rules.findUnit(1, id) ? 1 : 0;
}

/**
 * `ids` plus every type they spawn (dead objects, projectiles, on-build objects) and every upgrade source (effect type 3,
 * `copy_obj(dest, source)`, of a tech or civ effect) of a type already in the set, ascending.
 */
export function simUnitClosure(rules: RuleSet, ids: readonly number[]): number[] {
  // Effects a game can run: the techs' and the civs' (cheat and scenario effects are not).
  const used = new Set([...rules.dat.techs.map((t) => t.effectId), ...rules.dat.civs.map((c) => c.techTreeId)]);
  const effects = rules.dat.effects.filter((_, i) => used.has(i));
  const upgrades = effects.flatMap((e) => e.commands.filter((c) => c.type === 3).map((c) => [c.a, c.b] as const));
  const seen = new Set<number>();
  const todo = [...ids];
  while (todo.length > 0) {
    const id = todo.pop()!;
    // A reference to a type no civ has (Missle-Bolt's dead object 202, for one) spawns nothing in the original.
    if (id < 0 || seen.has(id) || !rules.findUnit(simTableCiv(rules, id), id)) continue;
    seen.add(id);
    const u = rules.unit(simTableCiv(rules, id), id);
    todo.push(u.deadUnitId, u.combat?.projectileUnitId ?? -1, u.building?.stackUnitId ?? -1);
    for (const [dest, source] of upgrades) if (dest === id) todo.push(source);
  }
  return [...seen].sort((a, b) => a - b);
}

/** The top-level fields of civ `civ`'s record of `id` that differ from the table's record; null when the civ lacks it. */
export function simCivDiff(rules: RuleSet, civ: number, id: number): Partial<SimUnitRecord> | null {
  if (!rules.findUnit(civ, id)) return null;
  const base = simUnitRecord(rules, simTableCiv(rules, id), id);
  const own = simUnitRecord(rules, civ, id);
  const diff: Partial<Record<keyof SimUnitRecord, unknown>> = {};
  for (const k of Object.keys(base) as (keyof SimUnitRecord)[]) if (JSON.stringify(base[k]) !== JSON.stringify(own[k])) diff[k] = own[k];
  return diff as Partial<SimUnitRecord>;
}

/** TypeScript source of packages/sim/src/unit-data.ts for unit types `ids` (closed over spawned types). */
export function renderSimTables(rules: RuleSet, ids: readonly number[]): string {
  const all = simUnitClosure(rules, ids);
  const records = all.map((id) => simUnitRecord(rules, simTableCiv(rules, id), id));
  const techs = rules.dat.techs.map((t) => {
    const costs = t.costs.filter((c) => c.type >= 0).map((c) => [c.type, c.amount, c.flag]);
    return [t.requiredTechs, t.requiredTechCount, t.researchTime, t.effectId, costs, t.locationId];
  });
  const civs = rules.dat.civs.map((c, civ) => {
    const diffs: Record<number, Partial<SimUnitRecord>> = {};
    for (const id of all) {
      const d = simCivDiff(rules, civ, id);
      if (d && Object.keys(d).length > 0) diffs[id] = d;
    }
    return { name: c.name, effect: c.techTreeId, resources: c.resources.map(f), diffs };
  });
  const restrictions = [...records, ...civs.flatMap((c) => Object.values(c.diffs))].map((r) => r.terrainRestriction ?? -1);
  const rows = [...new Set(restrictions)].filter((r) => r >= 0).sort((a, b) => a - b);
  const effects = rules.dat.effects.map((e) => e.commands.map((c) => [c.type, c.a, c.b, c.c, f(c.d)]));
  const json = (v: unknown) => JSON.stringify(v);
  // The random map generator reads the maps by their position in the file (rmm_dbct.cpp:162, `maps[map_type]`).
  const maps = rules.dat.randomMaps.maps.map((m) => ({
    edges: [m.body.borderSouthWest, m.body.borderNorthWest, m.body.borderNorthEast, m.body.borderSouthEast],
    fade: m.body.borderUsage,
    placementEdge: m.body.waterShape,
    baseTerrain: m.body.baseTerrain,
    landPercent: m.body.landCoverage,
    lands: m.lands.map((l) => [l.landId, l.terrain, l.landSpacing, l.baseSize, l.zone, l.placementType, l.baseX, l.baseY, l.landProportion, l.byPlayerFlag, l.startAreaRadius, l.terrainEdgeFade, l.clumpiness]),
    terrains: m.terrains.map((t) => [t.proportion, t.terrain, t.clumpCount, t.edgeSpacing, t.placementTerrain, t.clumpiness]),
    objects: m.units.map((u) => [u.unit, u.hostTerrain, u.groupPlacing, u.scaleFlag, u.objectsPerGroup, u.fluctuation, u.groupsPerPlayer, u.groupArea, u.playerId, u.setPlaceForAllPlayers, u.minDistanceToPlayers, u.maxDistanceToPlayers]),
  }));
  const terrainObjects = rules.dat.terrainBlock.terrains.map((t) => {
    const n = t.terrainUnitsUsed;
    return [t.terrainUnitIds.slice(0, n), t.terrainUnitDensities.slice(0, n), t.terrainUnitCentering.slice(0, n)];
  });
  const out: string[] = [
    '// Generated by tools/gen-sim-tables.mjs from data2/empires.dat (civ 1, or Gaia for units civ 1 lacks; every civ\'s',
    '// own fields in CIV_RECORDS); do not edit.',
    '// Regenerate: AOE1_DIR=<install> npm run gen:sim-tables. Checked by packages/data units.golden.test.ts.',
    "import type { SimCivRecord, SimRandomMap, SimUnitRecord } from './unit-record';",
    '',
    '/** Terrain restriction rows used by the types below: per terrain id, > 0 passable. */',
    'export const TERRAIN_ROWS: Record<number, readonly number[]> = {',
    ...rows.map((r) => `  ${r}: ${json(rules.terrainRestriction(r).accessible.map(f))},`),
    '};',
    '',
    'export const UNIT_RECORDS: readonly SimUnitRecord[] = [',
    ...records.map((r) => `  ${json(r)},`),
    '];',
    '',
    '/** Every tech: `[requiredTechs, requiredTechCount, researchTime, effectId, costs [type, amount, flag][], locationId]`. */',
    'export const TECH_RECORDS: readonly (readonly [readonly number[], number, number, number, readonly (readonly number[])[], number])[] = [',
    ...techs.map((t) => `  ${json(t)},`),
    '];',
    '',
    '/** Every effect: its commands as `[type, a, b, c, d]`. */',
    'export const EFFECT_RECORDS: readonly (readonly (readonly number[])[])[] = [',
    ...effects.map((e) => `  ${json(e)},`),
    '];',
    '',
    '/** Every civ (0 Gaia): its tech-tree effect, starting resources and its own record fields. */',
    'export const CIV_RECORDS: readonly SimCivRecord[] = [',
    ...civs.map((c) => `  ${json(c)},`),
    '];',
    '',
    '/** The random maps in file order (the map type is the index). */',
    'export const RANDOM_MAPS: readonly SimRandomMap[] = [',
    ...maps.map((m) => `  ${json(m)},`),
    '];',
    '',
    '/** Every terrain: the objects its tiles get on a random map, `[ids, densities per 1000 tiles, centered flags]`. */',
    'export const TERRAIN_OBJECTS: readonly (readonly (readonly number[])[])[] = [',
    ...terrainObjects.map((t) => `  ${json(t)},`),
    '];',
    '',
    '/** Every terrain\'s `impassable_terrain` (the terrain its blocked twin is), by terrain id. */',
    `export const TERRAIN_IMPASSABLE: readonly number[] = ${json(rules.dat.terrainBlock.terrains.map((t) => t.impassableTerrain))};`,
    '',
  ];
  return out.join('\n');
}
