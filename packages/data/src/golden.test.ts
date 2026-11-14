// Reads the real empires.dat from an AoE1 install (AOE1_DIR). Skipped when unset, as in
// CI, which has no Microsoft files. Run: AOE1_DIR=<install> npm run test:golden
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseDat, writeDat } from './dat';
import { RuleSet } from './rules';

const dir = process.env.AOE1_DIR;

describe.skipIf(!dir)('golden: data2/empires.dat', () => {
  const read = (): Uint8Array => readFileSync(join(dir ?? '', 'data2', 'empires.dat'));

  test('parses to the last byte and lists the 16 playable civilizations', () => {
    // parseDat throws unless the layout consumes every inflated byte.
    const rules = RuleSet.fromFile(read());
    const d = rules.dat;
    const civs = rules.playableCivs;
    console.log(
      [
        `${d.version}: ${d.terrainRestrictions.length} terrain restrictions, ${d.sounds.length} sounds, ` +
          `${d.graphics.filter(Boolean).length}/${d.graphics.length} graphics, ${d.terrainsUsed} terrains, ` +
          `${d.randomMaps.maps.length} random maps, ${d.effects.length} effects, ${d.techs.length} techs, ` +
          `${d.civs[0]!.units.filter(Boolean).length} units (Gaia)`,
        `${civs.length} playable civilizations:`,
        ...civs.map((c, i) => `  ${i + 1}. ${c.name}`),
      ].join('\n'),
    );
    expect(civs).toHaveLength(16);
  });

  test('re-reads its own output unchanged', () => {
    const dat = parseDat(read());
    expect(parseDat(writeDat(dat))).toEqual(dat);
  });
});
