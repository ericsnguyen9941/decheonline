// The sim's unit table must equal the original empires.dat (AOE1_DIR). Skipped when unset.
// Run: AOE1_DIR=<install> npm run test:golden
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { UNIT_TYPES } from '@aoe/sim';
import { RuleSet } from './rules';

const dir = process.env.AOE1_DIR;

describe.skipIf(!dir)('golden: sim unit table vs data2/empires.dat', () => {
  let parsed: RuleSet | undefined;
  const load = (): RuleSet => (parsed ??= RuleSet.fromFile(readFileSync(join(dir ?? '', 'data2', 'empires.dat'))));
  const sprite = (rules: RuleSet, graphic: number) => {
    const g = rules.graphic(graphic);
    // Sprite flags are the graphic's sequence type; bit 2 means "has facings".
    return { graphic, facets: g.angleCount, baseSpeed: Math.fround(g.speedMultiplier), hasFacings: (g.sequenceType & 2) !== 0 };
  };

  for (const t of UNIT_TYPES.values()) {
    test(`unit ${t.id} (${t.name}) matches every civ's record`, () => {
      const rules = load();
      for (let civ = 0; civ < rules.dat.civs.length; civ++) {
        const u = rules.unit(civ, t.id);
        const walking = u.movement!.walkingGraphic;
        expect({
          id: u.id,
          name: u.name,
          hitPoints: u.hitPoints,
          speed: Math.fround(u.speed!),
          radiusX: Math.fround(u.collisionSize[0]!),
          radiusY: Math.fround(u.collisionSize[1]!),
          radiusZ: Math.fround(u.collisionSize[2]!),
          turnSpeed: Math.fround(u.movement!.rotationSpeed),
          terrainRestriction: u.terrainRestriction,
          terrainTable: rules.terrainRestriction(u.terrainRestriction).accessible.map(Math.fround),
          standing: sprite(rules, u.standingGraphic),
          walking: walking < 0 ? null : sprite(rules, walking),
        }).toEqual({ ...t, terrainTable: [...t.terrainTable] });
      }
    });
  }
});
