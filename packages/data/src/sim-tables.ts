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
    speed: f(u.speed ?? 0),
    radius: [f(u.collisionSize[0]!), f(u.collisionSize[1]!), f(u.collisionSize[2]!)],
    clearance: [f(u.clearanceSize[0]!), f(u.clearanceSize[1]!)],
    turnSpeed: f(u.movement?.rotationSpeed ?? 0),
    flying: u.flyMode === 1,
    terrainRestriction: u.terrainRestriction,
    combatLevel: u.combatLevel,
    canBeBuiltOn: u.canBeBuiltOn,
    elevationMode: u.hillMode,
    placementTerrain: [u.placementTerrain[0]!, u.placementTerrain[1]!],
    placementSideTerrain: [u.placementSideTerrain[0]!, u.placementSideTerrain[1]!],
    enabled: u.enabled !== 0,
    standing,
    walking: u.movement ? sprite(rules, u.movement.walkingGraphic) : null,
    dying: sprite(rules, u.dyingGraphic),
    deadUnitId: u.deadUnitId,
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

/** `ids` plus every type they spawn (dead objects, projectiles, on-build objects), ascending. */
export function simUnitClosure(rules: RuleSet, ids: readonly number[]): number[] {
  const seen = new Set<number>();
  const todo = [...ids];
  while (todo.length > 0) {
    const id = todo.pop()!;
    if (id < 0 || seen.has(id)) continue;
    seen.add(id);
    const u = rules.unit(simTableCiv(rules, id), id);
    todo.push(u.deadUnitId, u.combat?.projectileUnitId ?? -1, u.building?.stackUnitId ?? -1);
  }
  return [...seen].sort((a, b) => a - b);
}

/** TypeScript source of packages/sim/src/unit-data.ts for unit types `ids` (closed over spawned types). */
export function renderSimTables(rules: RuleSet, ids: readonly number[]): string {
  const all = simUnitClosure(rules, ids);
  const records = all.map((id) => simUnitRecord(rules, simTableCiv(rules, id), id));
  const rows = [...new Set(records.map((r) => r.terrainRestriction))].sort((a, b) => a - b);
  const techs = rules.dat.techs.map((t) => [t.requiredTechs, t.requiredTechCount, t.researchTime, t.effectId]);
  const effects = rules.dat.effects.map((e) => e.commands.map((c) => [c.type, c.a, c.b, c.c, f(c.d)]));
  const json = (v: unknown) => JSON.stringify(v);
  const out: string[] = [
    '// Generated by tools/gen-sim-tables.mjs from data2/empires.dat (civ 1, or Gaia for units civ 1 lacks); do not edit.',
    '// Regenerate: AOE1_DIR=<install> npm run gen:sim-tables. Checked by packages/data units.golden.test.ts.',
    "import type { SimUnitRecord } from './unit-record';",
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
    '/** Every tech: `[requiredTechs, requiredTechCount, researchTime, effectId]`. */',
    'export const TECH_RECORDS: readonly (readonly [readonly number[], number, number, number])[] = [',
    ...techs.map((t) => `  ${json(t)},`),
    '];',
    '',
    '/** Every effect: its commands as `[type, a, b, c, d]`. */',
    'export const EFFECT_RECORDS: readonly (readonly (readonly number[])[])[] = [',
    ...effects.map((e) => `  ${json(e)},`),
    '];',
    '',
  ];
  return out.join('\n');
}
