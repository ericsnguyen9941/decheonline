// The sim's generated tables (packages/sim/src/unit-data.ts) must equal what the original empires.dat (AOE1_DIR) gives.
// The unit records are civ 1's (Egyptians), or Gaia's for units civ 1 lacks; every civ's own record (the Greek Granary's
// graphics, for one) is what `civUnitTypes` gives that civ's players. Skipped when unset.
// Run: AOE1_DIR=<install> npm run test:golden
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { CIVS, civUnitTypes, toUnitType, UNIT_TYPES } from '@aoe/sim';
import { RuleSet } from './rules';
import { renderSimTables, simTableCiv, simUnitRecord } from './sim-tables';

const dir = process.env.AOE1_DIR;

describe.skipIf(!dir)('golden: sim unit table vs data2/empires.dat', () => {
  let parsed: RuleSet | undefined;
  const load = (): RuleSet => (parsed ??= RuleSet.fromFile(readFileSync(join(dir ?? '', 'data2', 'empires.dat'))));

  test('unit-data.ts is what tools/gen-sim-tables.mjs writes from the dat (units, techs, effects)', () => {
    const committed = readFileSync(join(import.meta.dirname, '..', '..', 'sim', 'src', 'unit-data.ts'), 'utf8');
    expect(renderSimTables(load(), [...UNIT_TYPES.keys()])).toBe(committed);
  });

  for (const t of UNIT_TYPES.values()) {
    test(`unit ${t.id} (${t.name}) matches the dat record`, () => {
      const rules = load();
      expect(toUnitType(simUnitRecord(rules, simTableCiv(rules, t.id), t.id))).toEqual(t);
    });
  }

  CIVS.forEach((civ, i) => {
    test(`civ ${i} (${civ.name}): its masters are its own dat records, its effect and starting attributes the dat's`, () => {
      const rules = load();
      const c = rules.dat.civs[i]!;
      expect([civ.name, civ.effect, civ.resources]).toEqual([c.name, c.techTreeId, c.resources.map(Math.fround)]);
      for (const t of Object.values(civUnitTypes(i))) {
        const own = rules.findUnit(i, t.id) ? i : simTableCiv(rules, t.id);
        expect(toUnitType(simUnitRecord(rules, own, t.id)), `unit ${t.id}`).toEqual(t);
      }
    });
  });
});
