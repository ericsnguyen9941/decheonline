// The sim's generated tables (packages/sim/src/unit-data.ts) must equal what the original empires.dat (AOE1_DIR) gives.
// The unit records are civ 1's (Egyptians), or Gaia's for units civ 1 lacks. Other civs differ in some building
// graphics (the Greek Granary, for one); the sim has no per-civ masters yet. Skipped when unset.
// Run: AOE1_DIR=<install> npm run test:golden
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { toUnitType, UNIT_TYPES } from '@aoe/sim';
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
});
