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
 * Unit types the sim runs; the dead objects, projectiles and upgrade sources they reach are added. Villager task types
 * (the Repair_Man 156 among them), Town Center, Barracks, House, Granary, Storage Pit, Clubman, Bowman, Scout, flare, spear, gazelle, elephant, mines,
 * forage, trees; what the Tool Age opens: Market, Archery Range, Stable, Small Wall, Watch Tower, Slinger, Farm; the Wonder;
 * the other Barracks, Range, Stable and Academy units (Short/Broad/Long Swordsman, Legion; Improved/Composite Bowman,
 * Chariot Archer, Horse Archer, Heavy Horse Archer, Elephant Archer; Cavalry, Heavy Cavalry, Cataphract, Chariot, Scythe
 * Chariot, War/Armored Elephant; Hoplite, Phalanx, Centurion) and Academy, Government Center, Temple, Siege Workshop;
 * the Siege Workshop's units (Stone Thrower, Catapult, Heavy Catapult, Ballista, Helepolis); the Dock (Dock_1/2) and its
 * boats (Fishing Boat/Ship, Scout Ship, War Galley, Trireme, Catapult Trireme, Juggernaught, Fire Galley).
 */
const ROOTS = [83, 118, 119, 120, 122, 123, 124, 156, 251, 259, 109, 12, 70, 68, 103, 73, 4, 299, 112, 100, 65, 48, 66, 102, 59, 134, 141, 143, 84, 87, 101, 72, 79, 347, 50, 126, 1, 276,
  75, 76, 77, 282, 5, 6, 41, 39, 281, 25, 37, 38, 283, 40, 338, 339, 46, 345, 93, 94, 291, 0, 82, 104, 49,
  35, 36, 280, 11, 279, 125,
  45, 133, 13, 14, 19, 20, 21, 250, 277, 360];

const dir = process.env.AOE1_DIR;
if (!dir) {
  console.error('usage: AOE1_DIR=<install> npm run gen:sim-tables');
  process.exit(1);
}
const root = join(import.meta.dirname, '..');
const { RuleSet, renderSimTables } = await import(pathToFileURL(join(root, 'packages', 'data', 'src', 'index.ts')).href);
const rules = RuleSet.fromFile(readFileSync(join(dir, 'data2', 'empires.dat')));
const out = join(root, 'packages', 'sim', 'src', 'unit-data.ts');
// What the random map generator places: every map's object rows, every terrain's objects, the cliffs (264-273,
// rmm_clif.cpp) and the relics and ruins of TRIBE_World::new_game (159, 158). A type no civ has (364) is skipped.
const mapIds = rules.dat.randomMaps.maps.flatMap((m) => m.units.map((u) => u.unit));
const terrainIds = rules.dat.terrainBlock.terrains.flatMap((t) => t.terrainUnitIds.slice(0, t.terrainUnitsUsed));
const cliffs = [264, 265, 266, 267, 268, 269, 270, 271, 272, 273];
const placed = [...mapIds, ...terrainIds, ...cliffs, 158, 159].filter((id) => rules.findUnit(0, id) || rules.findUnit(1, id));
writeFileSync(out, renderSimTables(rules, [...ROOTS, ...placed]));
console.log(`wrote ${out}`);
