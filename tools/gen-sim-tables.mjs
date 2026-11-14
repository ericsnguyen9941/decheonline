// Writes packages/sim/src/unit-data.ts (the sim's unit, tech and effect tables) from AOE1_DIR/data2/empires.dat.
// Usage: AOE1_DIR=<install> npm run gen:sim-tables. `units.golden.test.ts` fails when the file is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// @aoe/data imports extensionless ('./dat'); Node needs a hook to resolve them.
const hook = `export async function resolve(s, c, n) {
  try { return await n(s, c); } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && s.startsWith('.')) return n(s + '.ts', c);
    throw e;
  }
}`;
register('data:text/javascript,' + encodeURIComponent(hook), import.meta.url);

/**
 * Unit types the sim runs; the dead objects, projectiles and upgrade sources they reach are added. Villager task types,
 * Town Center, Barracks, House, Granary, Storage Pit, Clubman, Bowman, Scout, flare, spear, gazelle, elephant, mines,
 * forage, trees; what the Tool Age opens: Market, Archery Range, Stable, Small Wall, Watch Tower, Slinger, Farm.
 */
const ROOTS = [83, 118, 119, 120, 122, 123, 124, 251, 259, 109, 12, 70, 68, 103, 73, 4, 299, 112, 100, 65, 48, 66, 102, 59, 134, 141, 143, 84, 87, 101, 72, 79, 347, 50];

const dir = process.env.AOE1_DIR;
if (!dir) {
  console.error('usage: AOE1_DIR=<install> npm run gen:sim-tables');
  process.exit(1);
}
const root = join(import.meta.dirname, '..');
const { RuleSet, renderSimTables } = await import(pathToFileURL(join(root, 'packages', 'data', 'src', 'index.ts')).href);
const rules = RuleSet.fromFile(readFileSync(join(dir, 'data2', 'empires.dat')));
const out = join(root, 'packages', 'sim', 'src', 'unit-data.ts');
writeFileSync(out, renderSimTables(rules, ROOTS));
console.log(`wrote ${out}`);
